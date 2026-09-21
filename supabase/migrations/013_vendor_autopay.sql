-- 013_vendor_autopay.sql
--
-- Scheduled vendor payment: on one chosen day each month, every outstanding
-- vendor bill is settled. Mirrors the salary auto-pay switch.
--
-- Unlike the payroll agent this runs entirely inside Postgres, called directly
-- by pg_cron. The payroll agent goes cron -> pg_net -> Edge Function -> REST,
-- which means a service-role key pasted into a cron job body and a deploy step
-- that can drift from the code in this repo. There is nothing in this job that
-- needs to leave the database, so it doesn't.

-- ---------------------------------------------------------------------------
-- Settings. Two switches, matching the payroll pair:
--   agent_vendor_pay_enabled - master switch (Settings > AI > Agents)
--   auto_vendor_pay_enabled  - the user-facing toggle on the Vendor Auto-Pay tab
-- Both must be true. Default off: this moves real money.
-- ---------------------------------------------------------------------------
insert into public.app_settings (setting_key, setting_value) values
  ('agent_vendor_pay_enabled', 'false'),
  ('auto_vendor_pay_enabled',  'false'),
  ('auto_vendor_pay_day',      '1')
on conflict (setting_key) do nothing;

-- ---------------------------------------------------------------------------
-- The run itself.
--
-- p_force skips the enabled/payday checks for a manual "Run now" from the UI.
-- It does NOT skip the settlement rules; it only answers "should this run at
-- all right now", never "which bills are eligible".
-- ---------------------------------------------------------------------------
create or replace function public.run_vendor_autopay(
  p_trigger text default 'schedule',
  p_force   boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
declare
  v_enabled_agent text;
  v_enabled_auto  text;
  v_day_setting   text;
  v_days_in_month integer;
  v_pay_day       integer;
  v_today         integer;
  v_count         integer := 0;
  v_total         numeric := 0;
  v_now           timestamptz := now();
  v_summary       jsonb;
  v_note          text;
  v_owner         uuid;
begin
  select setting_value into v_enabled_agent from app_settings where setting_key = 'agent_vendor_pay_enabled';
  select setting_value into v_enabled_auto  from app_settings where setting_key = 'auto_vendor_pay_enabled';
  select setting_value into v_day_setting   from app_settings where setting_key = 'auto_vendor_pay_day';

  -- Day is clamped into the month so "31st" still pays in February rather
  -- than silently skipping the month entirely.
  v_days_in_month := extract(day from (date_trunc('month', current_date) + interval '1 month - 1 day'));
  v_pay_day := least(greatest(coalesce(nullif(v_day_setting, '')::integer, 1), 1), v_days_in_month);
  v_today   := extract(day from current_date);

  if not p_force then
    if coalesce(v_enabled_agent, 'false') <> 'true' then
      v_note := 'vendor-pay agent disabled';
    elsif coalesce(v_enabled_auto, 'false') <> 'true' then
      v_note := 'vendor auto-pay disabled';
    elsif v_today <> v_pay_day then
      v_note := 'not vendor payday';
    end if;

    if v_note is not null then
      v_summary := jsonb_build_object(
        'done', 0, 'skipped', 0, 'errors', '[]'::jsonb,
        'note', v_note, 'today', v_today, 'pay_day', v_pay_day
      );
      insert into agent_runs (run_type, trigger_source, summary)
      values ('vendor_pay', p_trigger, v_summary);
      return v_summary;
    end if;
  end if;

  -- Settle every outstanding bill. paid_at only: payment and delivery are
  -- different events, and a bill can legitimately be paid before it arrives.
  --
  -- SECURITY DEFINER bypasses RLS, so the tenant filter is applied by hand.
  -- A call from a signed-in user settles only their own bills; the cron job
  -- has no auth.uid() and sweeps every tenant, which is what a scheduled
  -- system job should do. Without this an owner clicking "settle now" would
  -- pay every other owner's vendors too.
  v_owner := current_owner_id();

  with settled as (
    update restock_orders
       set paid_at = v_now
     where paid_at is null
       and (v_owner is null or owner_id = v_owner)
     returning total_cost
  )
  select count(*), coalesce(sum(total_cost), 0) into v_count, v_total from settled;

  v_summary := jsonb_build_object(
    'done', v_count, 'skipped', 0, 'errors', '[]'::jsonb,
    'total_amount', round(v_total),
    'pay_day', v_pay_day, 'forced', p_force
  );

  insert into agent_runs (run_type, trigger_source, summary)
  values ('vendor_pay', p_trigger, v_summary);

  return v_summary;
end;
$fnbody$;

comment on function public.run_vendor_autopay(text, boolean) is
'Settles all outstanding vendor bills when vendor auto-pay is enabled and today is the configured pay day. p_force bypasses those two checks for a manual run.';

-- What a run would do right now, so the UI can show the amount before
-- anyone commits to it.
create or replace function public.vendor_autopay_preview()
returns table (
  enabled       boolean,
  pay_day       integer,
  today         integer,
  days_in_month integer,
  due_orders    bigint,
  due_amount    numeric,
  next_run      date
)
language sql
stable
security definer
set search_path to 'public'
as $fnbody$
  with s as (
    select
      coalesce((select setting_value from app_settings where setting_key = 'agent_vendor_pay_enabled'), 'false') = 'true'
      and
      coalesce((select setting_value from app_settings where setting_key = 'auto_vendor_pay_enabled'), 'false') = 'true'
        as is_on,
      coalesce(nullif((select setting_value from app_settings where setting_key = 'auto_vendor_pay_day'), ''), '1')::int as raw_day
  ),
  d as (
    select
      s.is_on,
      extract(day from (date_trunc('month', current_date) + interval '1 month - 1 day'))::int as dim,
      s.raw_day
    from s
  )
  select
    d.is_on,
    least(greatest(d.raw_day, 1), d.dim),
    extract(day from current_date)::int,
    d.dim,
    (select count(*) from restock_orders where paid_at is null)::bigint,
    (select coalesce(round(sum(total_cost)), 0) from restock_orders where paid_at is null),
    -- This month's pay day if it is still ahead, otherwise next month's.
    case
      when extract(day from current_date)::int <= least(greatest(d.raw_day, 1), d.dim)
        then (date_trunc('month', current_date) + make_interval(days => least(greatest(d.raw_day, 1), d.dim) - 1))::date
      else (date_trunc('month', current_date) + interval '1 month'
            + make_interval(days => least(greatest(d.raw_day, 1),
                extract(day from (date_trunc('month', current_date) + interval '2 month - 1 day'))::int) - 1))::date
    end
  from d;
$fnbody$;

comment on function public.vendor_autopay_preview() is
'What vendor auto-pay would settle right now, plus the next scheduled run date.';

-- Postgres grants EXECUTE on a new function to PUBLIC by default, and anon
-- inherits it. A bare GRANT TO authenticated therefore restricts nothing —
-- verified the hard way: an unauthenticated POST to /rpc/run_vendor_autopay
-- settled every bill. PUBLIC must be revoked explicitly, and the revoke has
-- to name the argument types or it silently misses the overload.
revoke execute on function public.run_vendor_autopay(text, boolean) from public;
revoke execute on function public.run_vendor_autopay(text, boolean) from anon;
grant  execute on function public.run_vendor_autopay(text, boolean) to authenticated;

-- Preview is read-only, so PUBLIC is fine here.
grant execute on function public.vendor_autopay_preview() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Schedule. Runs daily and is a no-op except on the configured day, so
-- changing the pay day in Settings takes effect without touching cron.
--
-- The command is a plain quoted string rather than a $$ block: the Supabase
-- Management API mangles dollar-quoting, and there is nothing here that needs
-- it. Note the job calls SQL directly -- no pg_net, no service-role key
-- embedded in a cron body, nothing to deploy.
-- ---------------------------------------------------------------------------
select cron.unschedule('agent-vendor-pay-daily')
 where exists (select 1 from cron.job where jobname = 'agent-vendor-pay-daily');

select cron.schedule(
  'agent-vendor-pay-daily',
  '0 10 * * *',
  'select public.run_vendor_autopay(''schedule'')'
);
