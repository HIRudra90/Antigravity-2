-- 018_receive_restock_orders.sql
--
-- The missing receiving step, and the cancelled-order expense leak.
--
-- THE BUG
-- -------
-- Nothing in this system ever added stock back. Marking an order "Delivered"
-- (Restock.tsx updateStatus, Payment.tsx confirmDelivery) set `status` and
-- `paid_at` and nothing else, and no trigger on restock_orders touched
-- inventory. So a product that sold out stayed below its reorder level
-- permanently, the restock agent re-ordered it on every single run, and
-- nothing ever closed the loop.
--
-- The result, measured before this migration: 3,779 pending orders collapsing
-- to just 235 distinct vendor+item+cost combinations, the largest identical
-- group being 129 copies of one order, 2,498 of them raised in a single day
-- across 69 agent runs. $47.8M of "payable" for roughly 241 real orders.
--
-- Fixing the symptom (cancelling the backlog) without this would refill the
-- queue within a day.
--
-- MATCHING
-- --------
-- Order items carry {sku, quantity, unit_cost, product_name} and no
-- product_id, so receiving resolves by name within the order's own owner.
-- Measured against live data: 75 distinct item names, 66 resolve to exactly
-- one product, 9 match nothing (products since renamed or deleted), 0 are
-- ambiguous. Unmatched lines are skipped and counted in a NOTICE rather than
-- raising — a delivery must not fail because one discontinued line cannot be
-- matched.

create or replace function public.receive_restock_order()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
declare
  it          jsonb;
  v_name      text;
  v_qty       numeric;
  v_matched   int := 0;
  v_unmatched int := 0;
begin
  -- Only on the transition INTO Delivered. Without this guard, any later
  -- update of an already-delivered row (settling the bill, editing a note)
  -- would add the same quantities to stock a second time.
  if new.status is distinct from 'Delivered'
     or old.status is not distinct from 'Delivered' then
    return new;
  end if;

  for it in select * from jsonb_array_elements(coalesce(new.items, '[]'::jsonb))
  loop
    v_name := nullif(trim(it->>'product_name'), '');
    v_qty  := coalesce((it->>'quantity')::numeric, 0);

    if v_name is null or v_qty <= 0 then
      continue;
    end if;

    update inventory i
       set current_stock = coalesce(i.current_stock, 0) + v_qty::int,
           last_updated  = now()
      from products p
     where p.name = v_name
       and i.product_id = p.id
       -- Receiving must never cross tenants. new.owner_id can be null on
       -- older rows, in which case the product/inventory pairing is the only
       -- constraint available.
       and (new.owner_id is null or p.owner_id = new.owner_id)
       and (new.owner_id is null or i.owner_id = new.owner_id);

    if found then
      v_matched := v_matched + 1;
    else
      v_unmatched := v_unmatched + 1;
    end if;
  end loop;

  if v_unmatched > 0 then
    raise notice 'Order %: received % line(s), % unmatched product name(s) skipped',
      new.id, v_matched, v_unmatched;
  end if;

  return new;
end;
$fnbody$;

drop trigger if exists trg_receive_restock_order on public.restock_orders;
create trigger trg_receive_restock_order
  after update of status on public.restock_orders
  for each row execute function public.receive_restock_order();

comment on function public.receive_restock_order() is
'Adds a purchase order''s quantities to inventory when it first becomes Delivered. Matches items by product_name within the order''s owner.';

-- ---------------------------------------------------------------------------
-- Cancelled orders must stop counting as money spent.
--
-- get_procurement_overview and get_vendor_payment_summary already exclude
-- Cancelled; get_expense_overview did not, so a cancelled order still showed
-- up in Total Expenses. Cancelling the agent's duplicate backlog would have
-- left tens of millions sitting in the expense figure with no payable behind
-- it.
-- ---------------------------------------------------------------------------
create or replace function public.get_expense_overview()
returns table (
  opened_at       timestamptz,
  procurement     numeric,
  shipping        numeric,
  payroll_paid    numeric,
  total_expenses  numeric,
  excluded_before numeric
)
language sql
stable
set search_path to 'public'
as $fnbody$
  with e as (select books_opened_at() as t)
  select
    (select t from e),
    (select coalesce(round(sum(total_cost)), 0) from restock_orders, e
      where ordered_at >= e.t and status is distinct from 'Cancelled'),
    (select coalesce(round(sum(price)), 0) from shipments, e
      where created_at >= e.t),
    (select coalesce(round(sum(amount)), 0) from salary_payments, e
      where paid_at is not null and paid_at >= e.t),
    (select coalesce(round(sum(total_cost)), 0) from restock_orders, e
      where ordered_at >= e.t and status is distinct from 'Cancelled')
    + (select coalesce(round(sum(price)), 0) from shipments, e where created_at >= e.t)
    + (select coalesce(round(sum(amount)), 0) from salary_payments, e
        where paid_at is not null and paid_at >= e.t),
    (select coalesce(round(sum(total_cost)), 0) from restock_orders, e
      where ordered_at < e.t and status is distinct from 'Cancelled')
    + (select coalesce(round(sum(price)), 0) from shipments, e where created_at < e.t)
    + (select coalesce(round(sum(amount)), 0) from salary_payments, e
        where paid_at is not null and paid_at < e.t);
$fnbody$;

-- ---------------------------------------------------------------------------
-- The vendor auto-pay agent must not pay cancelled orders.
--
-- run_vendor_autopay selected on `paid_at is null` with no status filter, and
-- a cancelled order is still unpaid. Without this the Oct 1 run would settle
-- the entire cancelled backlog and quietly undo the cleanup.
--
-- Only the WHERE clause changes; the rest is the deployed definition.
-- ---------------------------------------------------------------------------
create or replace function public.run_vendor_autopay(
  p_trigger text default 'schedule'::text,
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
       and status is distinct from 'Cancelled'   -- <- the fix
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

revoke execute on function public.run_vendor_autopay(text, boolean) from public;
revoke execute on function public.run_vendor_autopay(text, boolean) from anon;
grant  execute on function public.run_vendor_autopay(text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Make the preview agree with the run.
--
-- The preview counted every unpaid order; the run only settles orders from the
-- accounting epoch onward, and now only non-cancelled ones. So the panel
-- advertised 3,788 orders / $47.8M while the agent would actually have paid
-- 2,498 / $12.2M. A preview that does not predict the write is worse than none.
-- ---------------------------------------------------------------------------
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
  ),
  e as (select books_opened_at() as t)
  select
    d.is_on,
    least(greatest(d.raw_day, 1), d.dim),
    extract(day from current_date)::int,
    d.dim,
    (select count(*) from restock_orders, e
      where paid_at is null
        and status is distinct from 'Cancelled'
        and ordered_at >= e.t)::bigint,
    (select coalesce(round(sum(total_cost)), 0) from restock_orders, e
      where paid_at is null
        and status is distinct from 'Cancelled'
        and ordered_at >= e.t),
    case
      when extract(day from current_date)::int <= least(greatest(d.raw_day, 1), d.dim)
        then (date_trunc('month', current_date) + make_interval(days => least(greatest(d.raw_day, 1), d.dim) - 1))::date
      else (date_trunc('month', current_date) + interval '1 month'
            + make_interval(days => least(greatest(d.raw_day, 1),
                extract(day from (date_trunc('month', current_date) + interval '2 month - 1 day'))::int) - 1))::date
    end
  from d;
$fnbody$;

revoke execute on function public.vendor_autopay_preview() from public;
revoke execute on function public.vendor_autopay_preview() from anon;
grant  execute on function public.vendor_autopay_preview() to authenticated;
