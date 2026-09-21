-- 014_payroll_autopay.sql
--
-- Gives the Salary / Auto-Pay page the same live figures and manual run the
-- Vendor Auto-Pay page has: how many salaries are due, how much, when the next
-- scheduled run lands, and a "pay all due now" action.
--
-- The SCHEDULED payroll run still belongs to the existing agent-payroll Edge
-- Function (cron job 'agent-payroll-daily'). This migration deliberately does
-- not add a second cron job for payroll -- two schedulers racing over the same
-- rows is how people get paid twice. run_payroll_autopay is for the manual
-- button and mirrors the Edge Function's rules exactly.

-- ---------------------------------------------------------------------------
-- Preview: what a run would do right now.
-- ---------------------------------------------------------------------------
create or replace function public.payroll_autopay_preview()
returns table (
  enabled        boolean,
  pay_day        integer,
  today          integer,
  days_in_month  integer,
  due_count      bigint,
  due_amount     numeric,
  paid_count     bigint,
  paid_amount    numeric,
  active_staff   bigint,
  next_run       date
)
language sql
stable
security definer
set search_path to 'public'
as $fnbody$
  with s as (
    select
      coalesce((select setting_value from app_settings where setting_key = 'agent_payroll_enabled'), 'false') = 'true'
      and
      coalesce((select setting_value from app_settings where setting_key = 'auto_pay_enabled'), 'false') = 'true'
        as is_on,
      coalesce(nullif((select setting_value from app_settings where setting_key = 'auto_pay_day'), ''), '1')::int as raw_day
  ),
  d as (
    select s.is_on, s.raw_day,
           extract(day from (date_trunc('month', current_date) + interval '1 month - 1 day'))::int as dim
    from s
  ),
  -- Active staff only, matching every other payroll figure in the app.
  rows_now as (
    select p.status, p.amount
      from salary_payments p
      join employees e on e.id = p.employee_id
     where p.payment_month = extract(month from current_date)
       and p.payment_year  = extract(year  from current_date)
       and lower(trim(e.status)) = 'active'
  )
  select
    d.is_on,
    least(greatest(d.raw_day, 1), d.dim),
    extract(day from current_date)::int,
    d.dim,
    (select count(*) from rows_now where status <> 'Paid')::bigint,
    (select coalesce(round(sum(amount)), 0) from rows_now where status <> 'Paid'),
    (select count(*) from rows_now where status = 'Paid')::bigint,
    (select coalesce(round(sum(amount)), 0) from rows_now where status = 'Paid'),
    (select count(*) from employees where lower(trim(status)) = 'active')::bigint,
    case
      when extract(day from current_date)::int <= least(greatest(d.raw_day, 1), d.dim)
        then (date_trunc('month', current_date) + make_interval(days => least(greatest(d.raw_day, 1), d.dim) - 1))::date
      else (date_trunc('month', current_date) + interval '1 month'
            + make_interval(days => least(greatest(d.raw_day, 1),
                extract(day from (date_trunc('month', current_date) + interval '2 month - 1 day'))::int) - 1))::date
    end
  from d;
$fnbody$;

comment on function public.payroll_autopay_preview() is
'Salaries due/paid this month for Active staff, plus the next scheduled payroll date.';

-- ---------------------------------------------------------------------------
-- Manual run. Same rules as the agent-payroll Edge Function:
-- Active staff only, current month, raise any missing row, then settle.
-- ---------------------------------------------------------------------------
create or replace function public.run_payroll_autopay(
  p_trigger text default 'manual',
  p_force   boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
declare
  v_on_agent text;
  v_on_auto  text;
  v_day      text;
  v_dim      integer;
  v_pay_day  integer;
  v_today    integer;
  v_month    integer := extract(month from current_date);
  v_year     integer := extract(year  from current_date);
  v_count    integer := 0;
  v_total    numeric := 0;
  v_raised   integer := 0;
  v_now      timestamptz := now();
  v_summary  jsonb;
  v_note     text;
begin
  select setting_value into v_on_agent from app_settings where setting_key = 'agent_payroll_enabled';
  select setting_value into v_on_auto  from app_settings where setting_key = 'auto_pay_enabled';
  select setting_value into v_day      from app_settings where setting_key = 'auto_pay_day';

  v_dim     := extract(day from (date_trunc('month', current_date) + interval '1 month - 1 day'));
  v_pay_day := least(greatest(coalesce(nullif(v_day, '')::integer, 1), 1), v_dim);
  v_today   := extract(day from current_date);

  if not p_force then
    if coalesce(v_on_agent, 'false') <> 'true' then
      v_note := 'payroll agent disabled';
    elsif coalesce(v_on_auto, 'false') <> 'true' then
      v_note := 'auto-pay disabled';
    elsif v_today <> v_pay_day then
      v_note := 'not payday';
    end if;

    if v_note is not null then
      v_summary := jsonb_build_object(
        'done', 0, 'skipped', 0, 'errors', '[]'::jsonb,
        'note', v_note, 'today', v_today, 'pay_day', v_pay_day
      );
      insert into agent_runs (run_type, trigger_source, summary)
      values ('payroll', p_trigger, v_summary);
      return v_summary;
    end if;
  end if;

  -- Raise a row for any Active employee who has none this month. Inactive and
  -- On Leave staff never get one, so they can never be swept into a run.
  with missing as (
    insert into salary_payments (employee_id, amount, payment_month, payment_year, status)
    select e.id, e.monthly_salary, v_month, v_year, 'Due'
      from employees e
     where lower(trim(e.status)) = 'active'
       and not exists (
         select 1 from salary_payments p
          where p.employee_id = e.id
            and p.payment_month = v_month
            and p.payment_year  = v_year
       )
    returning 1
  )
  select count(*) into v_raised from missing;

  -- Settle. Restricted to Active staff: a row raised before someone went On
  -- Leave stays Due rather than being paid out.
  with settled as (
    update salary_payments p
       set status = 'Paid', paid_at = v_now
      from employees e
     where e.id = p.employee_id
       and p.payment_month = v_month
       and p.payment_year  = v_year
       and p.status <> 'Paid'
       and lower(trim(e.status)) = 'active'
     returning p.amount
  )
  select count(*), coalesce(sum(amount), 0) into v_count, v_total from settled;

  v_summary := jsonb_build_object(
    'done', v_count, 'skipped', 0, 'errors', '[]'::jsonb,
    'total_amount', round(v_total), 'rows_raised', v_raised,
    'pay_day', v_pay_day, 'forced', p_force
  );

  insert into agent_runs (run_type, trigger_source, summary)
  values ('payroll', p_trigger, v_summary);

  return v_summary;
end;
$fnbody$;

comment on function public.run_payroll_autopay(text, boolean) is
'Pays all due salaries for Active staff. p_force bypasses the enabled/payday checks for a manual run. Scheduling stays with the agent-payroll Edge Function.';

-- Postgres grants EXECUTE to PUBLIC by default and anon inherits it, so a
-- write function must revoke it explicitly or anyone holding the publishable
-- key can run payroll. (Learned from run_vendor_autopay, migration 013.)
revoke execute on function public.run_payroll_autopay(text, boolean) from public;
revoke execute on function public.run_payroll_autopay(text, boolean) from anon;
grant  execute on function public.run_payroll_autopay(text, boolean) to authenticated;

-- Preview is read-only.
grant execute on function public.payroll_autopay_preview() to anon, authenticated;
