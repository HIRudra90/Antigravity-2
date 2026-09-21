-- 033_on_order_inventory.sql
--
-- Stock was being credited twice per restock, and the write that did it was
-- not safe to run concurrently. Both come from the same mistake: application
-- code moving inventory.
--
-- agent-restock/index.ts did:
--
--     .update({ current_stock: item.current_stock + suggestQty })
--
-- `item.current_stock` came from a snapshot read at the top of the run, so the
-- write is a stale ABSOLUTE value, not an increment. Two overlapping runs each
-- write their own snapshot + delta and the later one silently discards the
-- earlier. That is why 1,404 orders claimed 2.4M units while stock moved by
-- ~200k. src/lib/restock.ts has the identical pattern for manual orders.
--
-- Then migration 018's receive_restock_order() adds the same quantity AGAIN on
-- delivery, so every completed restock counted twice.
--
-- The obvious fix -- stop crediting at order time -- breaks something else.
-- That premature credit is the only reason an ordered item drops out of the
-- low-stock queue; without it the agent re-orders the same product on every
-- run, which is exactly how 3,779 duplicate orders were produced.
--
-- So the queue needs to distinguish "stock I have" from "stock that is coming",
-- which is what on_order is. Ordering reserves, delivery converts:
--
--     order raised      current_stock  --        on_order  + qty
--     order delivered   current_stock  + qty     on_order  - qty
--     order cancelled   current_stock  --        on_order  - qty
--
-- and the low-stock test becomes current_stock + on_order <= reorder_level.
-- An item with goods in transit is not low, without pretending they arrived.
--
-- Every adjustment below is RELATIVE (on_order = on_order + x), evaluated by
-- the database inside the statement, so concurrent runs compose instead of
-- clobbering. Application code no longer touches inventory at all.

alter table public.inventory
  add column if not exists on_order integer not null default 0;

comment on column public.inventory.on_order is
'Units ordered from a vendor but not yet received. Maintained only by the restock_orders triggers in migration 033.';

-- ---------------------------------------------------------------------------
-- Cutover.
--
-- The 136 orders currently sitting in Pending were raised by the old code, so
-- their units are ALREADY inside current_stock. If the receiving trigger
-- credited them on delivery they would be counted twice all over again. Rather
-- than cancelling real rows, receiving skips the stock credit for anything
-- raised before this moment; only orders raised under the new rules get it.
-- Same non-destructive shape as books_opened_at().
-- ---------------------------------------------------------------------------
insert into public.app_settings (setting_key, setting_value)
values ('inventory_cutover_at', now()::text)
on conflict (setting_key) do nothing;

create or replace function public.inventory_cutover_at()
returns timestamptz
language sql
stable
set search_path to 'public'
as $fnbody$
  select coalesce(
    (select setting_value::timestamptz from app_settings where setting_key = 'inventory_cutover_at'),
    '-infinity'::timestamptz
  );
$fnbody$;

-- ---------------------------------------------------------------------------
-- One place that applies an order's lines to inventory.
--
-- Products are matched by name, the same way receive_restock_order() already
-- did, because that is what the items jsonb carries. greatest(0, ...) guards
-- against a negative from a double-cancel or hand-edited row.
-- ---------------------------------------------------------------------------
create or replace function public.adjust_inventory_for_order(
  p_items        jsonb,
  p_owner        uuid,
  p_stock_mult   integer,   -- +1 receive, 0 otherwise
  p_onorder_mult integer    -- +1 reserve, -1 release
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
declare
  it     jsonb;
  v_name text;
  v_qty  numeric;
begin
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_name := nullif(trim(it->>'product_name'), '');
    v_qty  := coalesce((it->>'quantity')::numeric, 0);
    if v_name is null or v_qty <= 0 then
      continue;
    end if;

    update inventory i
       set current_stock = greatest(0, coalesce(i.current_stock, 0) + (v_qty * p_stock_mult)::int),
           on_order      = greatest(0, coalesce(i.on_order, 0)      + (v_qty * p_onorder_mult)::int),
           last_updated  = now()
      from products p
     where p.name = v_name
       and i.product_id = p.id
       -- Never cross tenants. owner_id can be null on older rows, in which
       -- case the product/inventory pairing is the only constraint available.
       and (p_owner is null or p.owner_id = p_owner)
       and (p_owner is null or i.owner_id = p_owner);
  end loop;
end;
$fnbody$;

-- ---------------------------------------------------------------------------
-- 1. Raising an order reserves the units.
-- ---------------------------------------------------------------------------
create or replace function public.reserve_on_order()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
begin
  -- An order created already closed reserves nothing. A row inserted straight
  -- as Delivered is handled here too, since its AFTER UPDATE trigger will
  -- never fire.
  if lower(coalesce(new.status, '')) = 'cancelled' then
    return new;
  end if;

  if new.status is not distinct from 'Delivered' then
    perform adjust_inventory_for_order(new.items, new.owner_id, 1, 0);
    return new;
  end if;

  perform adjust_inventory_for_order(new.items, new.owner_id, 0, 1);
  return new;
end;
$fnbody$;

drop trigger if exists trg_reserve_on_order on public.restock_orders;
create trigger trg_reserve_on_order
  after insert on public.restock_orders
  for each row execute function public.reserve_on_order();

-- ---------------------------------------------------------------------------
-- 2. Delivery converts reserved units into real stock.
-- ---------------------------------------------------------------------------
create or replace function public.receive_restock_order()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
begin
  -- Only on the transition INTO Delivered. Without this guard, any later
  -- update of an already-delivered row (settling the bill, editing a note)
  -- would add the same quantities to stock a second time.
  if new.status is distinct from 'Delivered'
     or old.status is not distinct from 'Delivered' then
    return new;
  end if;

  if new.ordered_at >= inventory_cutover_at() then
    -- Raised under the new rules: the units were reserved, never added.
    perform adjust_inventory_for_order(new.items, new.owner_id, 1, -1);
  else
    -- Pre-cutover: the old code already put these units into current_stock at
    -- order time. Crediting again is the double-count this migration exists to
    -- end. Release whatever reservation exists and add nothing.
    perform adjust_inventory_for_order(new.items, new.owner_id, 0, -1);
  end if;

  return new;
end;
$fnbody$;

-- ---------------------------------------------------------------------------
-- 3. Cancelling releases the reservation.
--
-- Folded into the existing cancel trigger from migration 025 so both effects
-- of a cancellation live in one function.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_notifications_on_cancel()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
begin
  if lower(coalesce(new.status, '')) <> 'cancelled'
     or lower(coalesce(old.status, '')) = 'cancelled' then
    return new;
  end if;

  -- Goods that will never arrive are not on order.
  perform adjust_inventory_for_order(new.items, new.owner_id, 0, -1);

  update notifications
     set resolved_at = coalesce(resolved_at, now())
   where category = 'procurement'
     and entity_id = new.id::text
     and resolved_at is null;

  return new;
end;
$fnbody$;

-- ---------------------------------------------------------------------------
-- on_order starts at 0 everywhere, deliberately.
--
-- Backfilling it from the 136 open Pending orders would be wrong: those units
-- are already sitting in current_stock, so counting them again as "arriving"
-- would tell the agent there is twice as much coming as there is.
-- ---------------------------------------------------------------------------
update public.inventory set on_order = 0 where on_order is distinct from 0;

revoke all on function public.adjust_inventory_for_order(jsonb, uuid, integer, integer) from public;
revoke all on function public.adjust_inventory_for_order(jsonb, uuid, integer, integer) from anon;
grant execute on function public.inventory_cutover_at() to authenticated, anon;
