-- 030_reminders.sql
--
-- A reminder calendar behind the clock in the top bar: pick a date and time,
-- write a note, and get it as a notification when it comes due.
--
-- Delivery is a scheduled database job, not a browser timer. A setTimeout in
-- the page only fires while that tab is open, and a reminder you receive only
-- if you happen to be looking at the app is not a reminder. This matches how
-- every other notification in this system is produced (migration 016): raised
-- by the database, so the event happens whether or not anyone is watching.
--
-- remind_at is timestamptz — an absolute instant. The UI collects a wall-clock
-- time in whichever timezone Settings is set to and converts it before saving,
-- so a reminder set for "9:00 AM" stays 9:00 AM in that zone regardless of
-- where the server or the database session happens to be.

create table if not exists public.reminders (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid,
  title       text not null,
  note        text,
  remind_at   timestamptz not null,
  created_at  timestamptz not null default now(),
  -- Set once the notification has been raised. Doubles as the "don't fire
  -- twice" guard, so the scheduled job is safe to run every minute.
  notified_at timestamptz,
  -- Ticked off by hand. A done reminder never fires.
  done_at     timestamptz
);

comment on table public.reminders is
'User-created reminders. fire_due_reminders() turns them into notifications when due.';

-- The job''s lookup: only ever scans what is still pending.
create index if not exists reminders_due_idx
  on public.reminders (remind_at)
  where notified_at is null and done_at is null;

create index if not exists reminders_calendar_idx
  on public.reminders (remind_at desc);

-- ---------------------------------------------------------------------------
-- Reminders are a fifth notification category.
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_category_check;
alter table public.notifications add constraint notifications_category_check
  check (category in ('inventory','procurement','payment','agent','reminder'));

insert into public.app_settings (setting_key, setting_value)
values ('notif_reminder', 'true')
on conflict (setting_key) do nothing;

-- ---------------------------------------------------------------------------
-- The delivery job.
--
-- Claims each due reminder by stamping notified_at in the same statement that
-- selects it, so two overlapping runs cannot both raise the same one.
-- ---------------------------------------------------------------------------
create or replace function public.fire_due_reminders()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    update reminders
       set notified_at = now()
     where id in (
       select id from reminders
        where notified_at is null
          and done_at is null
          and remind_at <= now()
        order by remind_at
        limit 200
        for update skip locked
     )
    returning id, owner_id, title, note, remind_at
  loop
    perform raise_notification(
      r.owner_id,
      'reminder',
      'info',
      r.title,
      coalesce(nullif(r.note, ''), 'Reminder'),
      '/owner/alerts',
      'reminder', r.id::text,
      'rem-' || r.id
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$fnbody$;

-- ---------------------------------------------------------------------------
-- Every minute. A reminder set for 9:00 should not arrive at 9:59.
-- ---------------------------------------------------------------------------
select cron.unschedule('fire-due-reminders')
 where exists (select 1 from cron.job where jobname = 'fire-due-reminders');

select cron.schedule('fire-due-reminders', '* * * * *',
  $cronbody$ select public.fire_due_reminders(); $cronbody$);

-- ---------------------------------------------------------------------------
-- RLS — same tenant shape as notifications.
-- ---------------------------------------------------------------------------
alter table public.reminders enable row level security;

drop policy if exists reminders_read on public.reminders;
create policy reminders_read on public.reminders
  for select to authenticated, anon using (true);

drop policy if exists reminders_write on public.reminders;
create policy reminders_write on public.reminders
  for all to authenticated, anon using (true) with check (true);

-- Live delivery, so a reminder added in one tab shows in another.
do $fnbody$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reminders'
  ) then
    alter publication supabase_realtime add table public.reminders;
  end if;
end;
$fnbody$;

revoke all on function public.fire_due_reminders() from public;
revoke all on function public.fire_due_reminders() from anon;
grant execute on function public.fire_due_reminders() to authenticated;
