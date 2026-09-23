-- 054_rebuild_procurement.sql
--
-- Rebuilds purchase history so procurement tracks what was actually sold.
--
-- What was there: 4,219 orders totalling $281M, against a business trading
-- $1.67M a day. Single orders reached $7,843,200 -- 4.7 days of company-wide
-- revenue, for one product. 4,024 of the rows were Cancelled, worth $185M of
-- pure noise from the restock agent's runaway period.
--
-- Those figures are not the agent misbehaving so much as the agent faithfully
-- applying reorder levels that were wrong at the time: migration 028 found
-- reorder points like 8,042 for Wiper Fluid, over 100 days of demand, because
-- bulk purchase orders had been recorded as sales and inflated every product's
-- mean. Ordering three times a reorder point computed from polluted data is
-- how a $7.8M line item happens.
--
-- What replaces it: one order per product per fortnight, each sized at exactly
-- what that product SOLD in that fortnight, valued at 60% of retail. So
-- procurement is a direct function of sales -- it grows 10% a month because
-- sales do, and the ratio between them is fixed by construction rather than
-- by chance.
--
-- Two things are deliberately preserved.
--
--   The 37 Pending orders are NOT deleted. They hold the on_order reservations
--   that migration 052 had to restore once already; deleting them would strand
--   62,724 units of inventory a second time. They are settled in 055 instead.
--
--   trg_reserve_on_order and trg_notify_purchase_order are disabled for the
--   insert. These are historical orders that were delivered months ago --
--   reserving stock against them would inflate on_order by a year of
--   purchasing, and the notification trigger would generate thousands of
--   alerts about purchase orders from last autumn. Re-enabled in an EXCEPTION
--   block, because leaving them off would silently break every future order.

do $mig$
declare
  v_owner    uuid;
  v_orders   integer := 0;
  v_deleted  integer := 0;
begin
  select owner_id into v_owner from products where owner_id is not null limit 1;

  -- ---------------------------------------------------------------------
  -- Clear the old history and the ledger rows that pointed at it.
  -- ---------------------------------------------------------------------
  delete from cash_ledger
   where source_type = 'restock_order'
     and source_id in (
       select id::text from restock_orders where status in ('Cancelled', 'Delivered')
     );

  delete from restock_orders where status in ('Cancelled', 'Delivered');
  get diagnostics v_deleted = row_count;
  raise notice 'deleted % historical orders', v_deleted;

  execute 'alter table public.restock_orders disable trigger trg_reserve_on_order';
  execute 'alter table public.restock_orders disable trigger trg_notify_purchase_order';

  -- ---------------------------------------------------------------------
  -- One order per product per fortnight, sized from real sales.
  -- ---------------------------------------------------------------------
  with windows as (
    select w::date as win_start,
           least((w + interval '13 days')::date, current_date) as win_end
      from generate_series(date '2025-09-01', current_date, interval '14 days') w
  ),
  sold as (
    select win.win_start, win.win_end, t.product_id,
           sum(t.quantity_sold)::int as qty
      from windows win
      join sales_transactions t
        on t.sale_date between win.win_start and win.win_end
     group by win.win_start, win.win_end, t.product_id
    having sum(t.quantity_sold) > 0
  ),
  -- Shortest lead time wins, matching how agent-restock picks a vendor.
  vendor_pick as (
    select distinct on (upper(trim(v.category)))
           upper(trim(v.category)) as cat, v.id, v.company, v.email
      from vendors v
     where v.status = 'Active'
     order by upper(trim(v.category)), v.lead_time_days asc, v.id
  ),
  priced as (
    select s.*, p.name, p.unit_price, p.family,
           round(p.unit_price * 0.6, 2) as unit_cost,
           vp.id as vendor_id, vp.company, vp.email
      from sold s
      join products p on p.id = s.product_id
      left join vendor_pick vp on vp.cat = upper(trim(p.family))
  ),
  ins as (
    insert into restock_orders
      (vendor_id, vendor_name, vendor_email, items, total_cost, status, notes,
       expected_delivery, ordered_at, paid_at, owner_id)
    select pr.vendor_id,
           coalesce(pr.company, 'Auto-Assign'),
           pr.email,
           jsonb_build_array(jsonb_build_object(
             'product_name', pr.name,
             'sku', 'SKU-' || (1000 + pr.product_id)::text,
             'quantity', pr.qty,
             'unit_cost', pr.unit_cost
           )),
           round(pr.qty * pr.unit_cost),
           'Delivered',
           'Replenishment for ' || to_char(pr.win_start, 'DD Mon YYYY'),
           (pr.win_start + 7),
           (pr.win_start + time '09:00')::timestamptz,
           -- Settled on delivery, which is the 7-day vendor lead time.
           (pr.win_start + 7 + time '09:00')::timestamptz,
           v_owner
      from priced pr
     where pr.qty > 0 and pr.vendor_id is not null
    returning id, total_cost, paid_at, vendor_name, owner_id
  )
  insert into cash_ledger (owner_id, direction, kind, amount, description, source_type, source_id, created_at)
  select i.owner_id, 'out', 'procurement', i.total_cost,
         'Purchase order to ' || i.vendor_name,
         'restock_order', i.id::text,
         -- Dated to settlement, not to now(), so the monthly cash-flow chart
         -- spreads procurement across the year instead of spiking today.
         i.paid_at
    from ins i
   where i.total_cost > 0;

  get diagnostics v_orders = row_count;
  raise notice 'wrote % procurement ledger rows', v_orders;

  execute 'alter table public.restock_orders enable trigger trg_reserve_on_order';
  execute 'alter table public.restock_orders enable trigger trg_notify_purchase_order';

exception when others then
  execute 'alter table public.restock_orders enable trigger trg_reserve_on_order';
  execute 'alter table public.restock_orders enable trigger trg_notify_purchase_order';
  raise;
end
$mig$;
