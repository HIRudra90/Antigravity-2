-- 021_fix_cash_trigger_upserts.sql
--
-- Two defects in 020's automatic cash triggers, both of which made the
-- underlying write fail outright rather than just skipping a ledger entry.
--
-- 1. cash_ledger_source_idx is a PARTIAL unique index (it only covers rows
--    that actually have a source). A bare `on conflict (source_type, source_id)`
--    cannot match a partial index — Postgres needs the index predicate
--    restated in the ON CONFLICT clause, or it raises "no unique or exclusion
--    constraint matching the ON CONFLICT specification". Every one of the four
--    triggers had the bare form, so marking a salary paid, settling a vendor
--    bill, booking a shipment or recording a sale would have failed.
--
-- 2. cash_ledger.amount is CHECK (amount > 0), but the vendor and salary
--    triggers passed the source amount straight through. Two restock_orders
--    carry total_cost = 0, so settling either would have violated the check
--    and failed the payment. A zero-value event is not a cash movement, so it
--    is now skipped rather than forced into the ledger.

create or replace function public.cash_on_vendor_payment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
begin
  if new.paid_at is null or old.paid_at is not null then
    return new;
  end if;
  if lower(coalesce(new.status, '')) = 'cancelled' then
    return new;
  end if;
  -- A zero-cost order moves no money; forcing it through would trip the
  -- amount > 0 check and fail the payment itself.
  if coalesce(new.total_cost, 0) <= 0 then
    return new;
  end if;

  insert into cash_ledger (owner_id, direction, kind, amount, description, source_type, source_id)
  values (new.owner_id, 'out', 'procurement', new.total_cost,
          'Vendor payment — ' || coalesce(new.vendor_name, 'vendor'),
          'restock_order', new.id::text)
  on conflict (source_type, source_id)
    where source_type is not null and source_id is not null
    do nothing;

  return new;
end;
$fnbody$;

create or replace function public.cash_on_salary_payment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
declare v_name text;
begin
  if new.paid_at is null or old.paid_at is not null then
    return new;
  end if;
  if coalesce(new.amount, 0) <= 0 then
    return new;
  end if;

  select name into v_name from employees where id = new.employee_id;

  insert into cash_ledger (owner_id, direction, kind, amount, description, source_type, source_id)
  values (null, 'out', 'payroll', new.amount,
          'Salary — ' || coalesce(v_name, 'employee'),
          'salary_payment', new.id::text)
  on conflict (source_type, source_id)
    where source_type is not null and source_id is not null
    do nothing;

  return new;
end;
$fnbody$;

create or replace function public.cash_on_shipment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
begin
  if coalesce(new.price, 0) <= 0 then
    return new;
  end if;

  insert into cash_ledger (owner_id, direction, kind, amount, description, source_type, source_id)
  values (null, 'out', 'shipping', new.price,
          'Shipping — ' || coalesce(new.carrier, 'courier'),
          'shipment', new.id::text)
  on conflict (source_type, source_id)
    where source_type is not null and source_id is not null
    do nothing;

  return new;
end;
$fnbody$;

create or replace function public.cash_on_sale()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
declare
  v_price numeric;
  v_name  text;
  v_value numeric;
begin
  select unit_price, name into v_price, v_name from products where id = new.product_id;
  v_value := coalesce(v_price, 0) * coalesce(new.quantity_sold, 0);

  if v_value <= 0 then
    return new;
  end if;

  insert into cash_ledger (owner_id, direction, kind, amount, description, source_type, source_id)
  values (new.owner_id, 'in', 'revenue', v_value,
          'Sale — ' || coalesce(v_name, 'product'),
          'sale', new.id::text)
  on conflict (source_type, source_id)
    where source_type is not null and source_id is not null
    do nothing;

  return new;
end;
$fnbody$;
