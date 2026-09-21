-- 025_alerts_resolution.sql
--
-- The Alerts page could not resolve anything, for three separate reasons.
--
-- 1. There was nowhere to record it. `notifications` has read_at ("I saw it")
--    but nothing for "this is dealt with". The page kept resolution in React
--    state, so the realtime subscription rebuilt the list from scratch on the
--    next tick and every resolve silently reverted.
--
-- 2. The page was not reading this table at all. It merged live `inventory`
--    rows with five hardcoded mock alerts (a TechStart payment failure, a FedEx
--    customs delay) while the bell read `notifications`. Two feeds, no shared
--    state -- the bell could show 2,588 unread beside an Alerts page showing 5.
--
-- 3. Volume. 2,591 procurement notifications exist, 2,498 of which point at
--    restock_orders already cancelled as runaway-agent junk. No resolve button
--    is usable against a backlog that size.
--
-- This migration adds the missing state, clears the junk, and stops alerts
-- accumulating that way again.

-- ---------------------------------------------------------------------------
-- 1. Resolution state.
--
-- Kept separate from read_at because they answer different questions: read_at
-- is "this reached a human" (drives the bell badge), resolved_at is "the
-- underlying condition is handled" (drives the Alerts page). Resolving implies
-- reading -- you cannot deal with something you never saw -- so the app sets
-- both, and resolved items drop out of the bell automatically.
-- ---------------------------------------------------------------------------
alter table public.notifications
  add column if not exists resolved_at timestamptz;

comment on column public.notifications.resolved_at is
'Non-null once the underlying condition is handled. Independent of read_at: read = seen, resolved = dealt with.';

create index if not exists notifications_open_idx
  on public.notifications (resolved_at, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Retire the junk backlog.
--
-- These announce purchase orders that were themselves cancelled as agent junk.
-- The event is real and stays in the table for the record, but an alert about
-- a cancelled order is not something anyone can action, so it is closed rather
-- than deleted.
-- ---------------------------------------------------------------------------
update public.notifications n
   set resolved_at = coalesce(n.resolved_at, now()),
       read_at     = coalesce(n.read_at, now())
  from public.restock_orders r
 where r.id::text = n.entity_id
   and n.category = 'procurement'
   and n.resolved_at is null
   and lower(coalesce(r.status, '')) = 'cancelled';

-- ---------------------------------------------------------------------------
-- 3. Stop a bulk run producing one notification per line.
--
-- The dedupe key was 'po-<order id>' -- unique by construction, so it collapsed
-- nothing. Buying the whole catalogue raised 65 near-identical rows in a
-- second. Keyed per vendor per day instead, a bulk run becomes one row whose
-- body carries the running count, which is what a human actually wants to know.
--
-- raise_notification returns null when it deduped OR when the category is
-- switched off in settings. The follow-up UPDATE is keyed on dedupe_key, so in
-- the switched-off case it simply matches nothing.
-- ---------------------------------------------------------------------------
create or replace function public.notify_purchase_order()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
declare
  v_vendor text := coalesce(new.vendor_name, 'vendor');
  v_key    text;
  v_count  int;
  v_total  numeric;
begin
  v_key := 'po-' || lower(v_vendor) || '-' || to_char(current_date, 'YYYYMMDD');

  perform raise_notification(
    new.owner_id,
    'procurement',
    'info',
    'Purchase order raised — ' || v_vendor,
    coalesce(new.items->0->>'product_name', 'Order')
      || case when coalesce(jsonb_array_length(new.items), 0) > 1
              then ' +' || (jsonb_array_length(new.items) - 1) || ' more' else '' end
      || ' · ' || round(coalesce(new.total_cost, 0))::text,
    '/owner/restock',
    'restock_order', new.id::text,
    v_key
  );

  -- Refresh the collapsed row so it reports the day's running total for this
  -- vendor rather than only the first order's line.
  select count(*), coalesce(sum(total_cost), 0)
    into v_count, v_total
    from restock_orders
   where lower(coalesce(vendor_name, 'vendor')) = lower(v_vendor)
     and ordered_at >= current_date
     and lower(coalesce(status, '')) <> 'cancelled';

  if v_count > 1 then
    update notifications
       set title = 'Purchase orders raised — ' || v_vendor,
           body  = v_count || ' orders today · ' || round(v_total)::text
     where dedupe_key = v_key;
  end if;

  return new;
end;
$fnbody$;

-- ---------------------------------------------------------------------------
-- 4. Close a procurement alert when its order is cancelled.
--
-- Without this, cancelling an order leaves its alert open forever -- which is
-- how the 2,498 above came to exist.
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

  update notifications
     set resolved_at = coalesce(resolved_at, now())
   where category = 'procurement'
     and entity_id = new.id::text
     and resolved_at is null;

  return new;
end;
$fnbody$;

drop trigger if exists trg_resolve_notifications_on_cancel on public.restock_orders;
create trigger trg_resolve_notifications_on_cancel
  after update of status on public.restock_orders
  for each row execute function public.resolve_notifications_on_cancel();

-- ---------------------------------------------------------------------------
-- 5. Close a stock alert when the stock actually comes back.
--
-- This is the half of "fix the issue" the UI could never deliver on its own:
-- restocking a product is the fix, so the alert should close itself when that
-- happens rather than waiting to be dismissed by hand. Folded into the existing
-- low-stock trigger so both directions of the same crossing live together.
-- ---------------------------------------------------------------------------
create or replace function public.notify_inventory_low()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
declare
  v_name text;
  v_crossed boolean;
begin
  -- Recovered: stock is back above the reorder level, so any open alert for
  -- this product is now stale.
  if new.current_stock > new.reorder_level then
    update notifications
       set resolved_at = coalesce(resolved_at, now())
     where category = 'inventory'
       and entity_id = new.product_id::text
       and resolved_at is null;
    return new;
  end if;

  v_crossed := new.current_stock <= new.reorder_level
               and (old.current_stock is null or old.current_stock > old.reorder_level);
  if not v_crossed then
    return new;
  end if;

  select name into v_name from products where id = new.product_id;
  v_name := coalesce(v_name, 'Product ' || new.product_id);

  perform raise_notification(
    new.owner_id,
    'inventory',
    case when new.current_stock = 0 then 'critical' else 'warning' end,
    case when new.current_stock = 0
         then v_name || ' is out of stock'
         else v_name || ' is low on stock' end,
    'Stock is ' || new.current_stock || ', at or below the reorder level of ' || new.reorder_level || '.',
    '/owner/restock',
    'inventory', new.product_id::text,
    'inv-' || new.product_id || '-' || to_char(current_date, 'YYYYMMDD')
  );
  return new;
end;
$fnbody$;

-- ---------------------------------------------------------------------------
-- 6. Backfill: close stock alerts for products that are already back in stock.
-- ---------------------------------------------------------------------------
update public.notifications n
   set resolved_at = coalesce(n.resolved_at, now())
  from public.inventory i
 where i.product_id::text = n.entity_id
   and n.category = 'inventory'
   and n.resolved_at is null
   and i.current_stock > i.reorder_level;
