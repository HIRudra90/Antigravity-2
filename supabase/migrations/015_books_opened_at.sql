-- 015_books_opened_at.sql
--
-- Resets the expense side of the books to zero without deleting anything.
--
-- `books_opened_at` is an accounting epoch: every expense figure counts only
-- activity at or after it. Setting it to now() makes Total Expenses read 0,
-- and everything recorded from this moment accumulates normally.
--
-- Why not just DELETE the rows? The $42.59M sits in 1,327 restock_orders,
-- which are also the vendor order history, the outstanding balances, the
-- Payments Made feed and the Restock page's PO list. Deleting them would take
-- all of that with it, irreversibly, to move one number. An epoch moves the
-- same number, keeps the history, and is undone by editing one setting.
--
-- To restore the full history:  update app_settings
--                                  set setting_value = '1970-01-01T00:00:00Z'
--                                where setting_key = 'books_opened_at';

insert into public.app_settings (setting_key, setting_value)
values ('books_opened_at', now()::text)
on conflict (setting_key) do update set setting_value = excluded.setting_value;

-- Shared accessor so every expense function agrees on the cutoff.
create or replace function public.books_opened_at()
returns timestamptz
language sql
stable
security definer
set search_path to 'public'
as $fnbody$
  select coalesce(
    nullif((select setting_value from app_settings where setting_key = 'books_opened_at'), '')::timestamptz,
    '1970-01-01T00:00:00Z'::timestamptz
  );
$fnbody$;

comment on function public.books_opened_at() is
'Accounting epoch. Expense totals count only activity at or after this instant; earlier rows are retained but excluded.';

-- ---------------------------------------------------------------------------
-- Procurement figures, now scoped to the epoch.
-- ---------------------------------------------------------------------------
drop function if exists public.get_procurement_overview();

create or replace function public.get_procurement_overview()
returns table (
  total_orders      bigint,
  total_committed   numeric,
  paid_orders       bigint,
  paid_amount       numeric,
  open_orders       bigint,
  outstanding       numeric,
  in_transit_orders bigint,
  paid_today        numeric,
  paid_this_month   numeric,
  paid_last_month   numeric
)
language sql
stable
security invoker
set search_path to 'public'
as $fnbody$
  with epoch as (select books_opened_at() as t),
  r as (
    select * from restock_orders, epoch
     where ordered_at >= epoch.t
  )
  select
    count(*)::bigint,
    coalesce(round(sum(total_cost)), 0),
    count(*) filter (where paid_at is not null)::bigint,
    coalesce(round(sum(total_cost) filter (where paid_at is not null)), 0),
    count(*) filter (where paid_at is null)::bigint,
    coalesce(round(sum(total_cost) filter (where paid_at is null)), 0),
    count(*) filter (where lower(coalesce(status, '')) not in ('delivered', 'cancelled'))::bigint,
    coalesce(round(sum(total_cost) filter (where paid_at::date = current_date)), 0),
    coalesce(round(sum(total_cost) filter (where paid_at >= date_trunc('month', current_date))), 0),
    coalesce(round(sum(total_cost) filter (
      where paid_at >= date_trunc('month', current_date) - interval '1 month'
        and paid_at <  date_trunc('month', current_date))), 0)
  from r;
$fnbody$;

drop function if exists public.get_vendor_payment_summary();

create or replace function public.get_vendor_payment_summary()
returns table (
  vendor_id   uuid,
  order_count bigint,
  paid_amount numeric,
  outstanding numeric,
  in_transit  bigint,
  last_order  timestamptz
)
language sql
stable
security invoker
set search_path to 'public'
as $fnbody$
  select
    r.vendor_id,
    count(*)::bigint,
    coalesce(round(sum(r.total_cost) filter (where r.paid_at is not null)), 0),
    coalesce(round(sum(r.total_cost) filter (where r.paid_at is null)), 0),
    count(*) filter (where lower(coalesce(r.status, '')) not in ('delivered', 'cancelled'))::bigint,
    max(r.ordered_at)
  from restock_orders r
  where r.vendor_id is not null
    and r.ordered_at >= books_opened_at()
  group by r.vendor_id;
$fnbody$;

drop function if exists public.get_vendor_payments(integer);

create or replace function public.get_vendor_payments(p_limit integer default 50)
returns table (
  order_id    uuid,
  vendor_id   uuid,
  vendor_name text,
  amount      numeric,
  paid_at     timestamptz,
  ordered_at  timestamptz,
  item_label  text,
  item_count  integer
)
language sql
stable
security invoker
set search_path to 'public'
as $fnbody$
  select
    r.id, r.vendor_id, coalesce(r.vendor_name, 'Vendor'),
    round(coalesce(r.total_cost, 0)), r.paid_at, r.ordered_at,
    coalesce(r.items->0->>'product_name', 'Purchase order'),
    coalesce(jsonb_array_length(r.items), 0)
  from restock_orders r
  where r.paid_at is not null
    and r.ordered_at >= books_opened_at()
  order by r.paid_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 500));
$fnbody$;

-- ---------------------------------------------------------------------------
-- Expense totals for the Overview cards, computed server-side so the cards
-- stop summing a truncated page of rows.
--
-- Payroll counts salaries actually PAID since the epoch, not the monthly
-- headcount cost. An unpaid salary is a commitment, not an incurred expense,
-- and counting it made Total Expenses non-zero the moment the books opened.
-- ---------------------------------------------------------------------------
create or replace function public.get_expense_overview()
returns table (
  opened_at        timestamptz,
  procurement      numeric,
  shipping         numeric,
  payroll_paid     numeric,
  total_expenses   numeric,
  excluded_before  numeric
)
language sql
stable
security invoker
set search_path to 'public'
as $fnbody$
  with e as (select books_opened_at() as t)
  select
    (select t from e),
    (select coalesce(round(sum(total_cost)), 0) from restock_orders, e
      where ordered_at >= e.t),
    (select coalesce(round(sum(price)), 0) from shipments, e
      where created_at >= e.t),
    (select coalesce(round(sum(amount)), 0) from salary_payments, e
      where paid_at is not null and paid_at >= e.t),
    (select coalesce(round(sum(total_cost)), 0) from restock_orders, e
      where ordered_at >= e.t)
    + (select coalesce(round(sum(price)), 0) from shipments, e where created_at >= e.t)
    + (select coalesce(round(sum(amount)), 0) from salary_payments, e
        where paid_at is not null and paid_at >= e.t),
    -- What the epoch is holding back, so the number is never simply lost.
    (select coalesce(round(sum(total_cost)), 0) from restock_orders, e
      where ordered_at < e.t)
    + (select coalesce(round(sum(price)), 0) from shipments, e where created_at < e.t)
    + (select coalesce(round(sum(amount)), 0) from salary_payments, e
        where paid_at is not null and paid_at < e.t);
$fnbody$;

comment on function public.get_expense_overview() is
'Expense totals counted from books_opened_at, plus the amount excluded by that cutoff.';

-- Auto-pay must not reach back past the epoch either: those bills are no
-- longer counted as outstanding, so settling them would spend money the books
-- say is not owed.
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

  v_owner := current_owner_id();

  with settled as (
    update restock_orders
       set paid_at = v_now
     where paid_at is null
       and (v_owner is null or owner_id = v_owner)
       and ordered_at >= books_opened_at()
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

-- EXECUTE defaults to PUBLIC on a re-created function, so the revoke has to
-- be repeated every time this one is replaced.
revoke execute on function public.run_vendor_autopay(text, boolean) from public;
revoke execute on function public.run_vendor_autopay(text, boolean) from anon;
grant  execute on function public.run_vendor_autopay(text, boolean) to authenticated;

grant execute on function public.books_opened_at()                to anon, authenticated;
grant execute on function public.get_expense_overview()           to anon, authenticated;
grant execute on function public.get_procurement_overview()       to anon, authenticated;
grant execute on function public.get_vendor_payment_summary()     to anon, authenticated;
grant execute on function public.get_vendor_payments(integer)     to anon, authenticated;
