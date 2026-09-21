-- 008_employee_status_history.sql
--
-- Records when an employee's status changes, so the profile can show which
-- months they were Inactive or On Leave, and payroll for those months is
-- withdrawn rather than left sitting as money owed.
--
-- The log is written by a trigger rather than by the app. Status can change
-- from the Employees page, the admin console, an agent or raw SQL, and a
-- history that only some of those paths write is worse than none.

create table if not exists public.employee_status_history (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references public.employees(id) on delete cascade,
  previous_status  text,
  status           text not null,
  effective_month  integer not null check (effective_month between 1 and 12),
  effective_year   integer not null,
  changed_at       timestamptz not null default now(),
  note             text
);

create index if not exists employee_status_history_emp_idx
  on public.employee_status_history(employee_id, changed_at desc);
create index if not exists employee_status_history_period_idx
  on public.employee_status_history(effective_year, effective_month);

comment on table public.employee_status_history is
'Append-only log of employee status changes. Written by trg_employee_status_change; shows which months someone was Inactive or On Leave.';

-- ---------------------------------------------------------------------------
-- Trigger
-- ---------------------------------------------------------------------------
create or replace function public.log_employee_status_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  m integer := extract(month from current_date);
  y integer := extract(year  from current_date);
begin
  if tg_op = 'INSERT' then
    insert into public.employee_status_history
      (employee_id, previous_status, status, effective_month, effective_year, note)
    values (new.id, null, new.status, m, y, 'Joined');
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.employee_status_history
      (employee_id, previous_status, status, effective_month, effective_year, note)
    values (new.id, old.status, new.status, m, y, null);

    -- Leaving Active withdraws this month's salary if it has not been paid.
    -- Only a Due row is removed: deleting a Paid row would erase a payment
    -- that actually happened.
    if lower(trim(new.status)) <> 'active' then
      delete from public.salary_payments
       where employee_id = new.id
         and payment_month = m
         and payment_year  = y
         and status = 'Due';
    end if;
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_employee_status_change on public.employees;
create trigger trg_employee_status_change
  after insert or update of status on public.employees
  for each row execute function public.log_employee_status_change();

-- ---------------------------------------------------------------------------
-- Seed: one opening row per existing employee, so the profile is not blank
-- for people who have never changed status since the log was introduced.
-- ---------------------------------------------------------------------------
insert into public.employee_status_history
  (employee_id, previous_status, status, effective_month, effective_year, changed_at, note)
select e.id, null, e.status,
       extract(month from coalesce(e.joined_date, current_date))::int,
       extract(year  from coalesce(e.joined_date, current_date))::int,
       coalesce(e.joined_date::timestamptz, now()),
       'Opening record'
from public.employees e
where not exists (
  select 1 from public.employee_status_history h where h.employee_id = e.id
);

-- ---------------------------------------------------------------------------
-- RLS — same tenant shape as the other tables (see migration 004)
-- ---------------------------------------------------------------------------
alter table public.employee_status_history enable row level security;

drop policy if exists employee_status_history_read on public.employee_status_history;
create policy employee_status_history_read on public.employee_status_history
  for select to authenticated, anon using (true);

drop policy if exists employee_status_history_write on public.employee_status_history;
create policy employee_status_history_write on public.employee_status_history
  for all to authenticated, anon using (true) with check (true);
