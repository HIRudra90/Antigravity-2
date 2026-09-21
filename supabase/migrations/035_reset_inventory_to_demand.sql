-- 035_reset_inventory_to_demand.sql
--
-- Phase 2: put inventory back on a footing that matches real demand.
--
-- Stock cannot be repaired by arithmetic, so it is being set deliberately.
-- The damage came from two mechanisms that have since been fixed:
--
--   * every restock credited its units twice, once at order time in
--     application code and again on delivery in receive_restock_order()
--   * a webhook (trg_low_stock) fires the restock agent on every crossing into
--     low stock, so one bulk sale started 66 concurrent runs, each ordering
--     against the same 66-product list
--
-- An attempt to reverse-compute the true figure from the surviving order rows
-- returned NEGATIVE 2,069,543 units, because the agent's stale absolute writes
-- mean the orders do not account for the stock they claim. There is no
-- arithmetic path back, so the only honest option is to choose a level.
--
-- Target: 30 days of cover per product, from the same demand measurement used
-- for reorder levels in migration 028. That sits near the top of the natural
-- replenishment cycle this system produces -- the reorder point is ~8 days of
-- demand and an order is 3x the reorder point (~25 days), so stock oscillates
-- between roughly 8 and 33 days. Starting at 30 puts every product just after
-- a delivery rather than at an arbitrary point.
--
-- Demand excludes any day above 3x that product's own median. Bulk purchase
-- orders are recorded as sales in this system and are large enough to corrupt
-- both the mean and the variance: Wiper Fluid's median day is 76 units and its
-- largest is 13,442.
--
-- This removes 151,664 units, 53% of what is currently recorded. That is the
-- scale of the accumulated phantom stock, not a haircut.
--
-- reorder_level is restored in the same statement. It had been reset to a flat
-- 50 across all 66 products at some point after migration 028, which against a
-- 255-units-a-day product is fourteen hours of stock and would make the new
-- levels meaningless -- alerts would not fire until a product was effectively
-- empty. Stock target and reorder point have to be set together or neither
-- means anything.
--
-- Previous values are saved at supabase/backups/inventory_before_phase2.json.

with daily as (
  select product_id, sale_date, sum(quantity_sold) as qty
    from sales_transactions
   where sale_date >= current_date - 90
   group by 1, 2
),
med as (
  select product_id, percentile_cont(0.5) within group (order by qty) as m
    from daily group by 1
),
clean as (
  select d.* from daily d join med m on m.product_id = d.product_id
   where d.qty <= 3 * m.m
),
stat as (
  select product_id, avg(qty) as mu, coalesce(stddev_samp(qty), 0) as sigma
    from clean group by 1
),
target as (
  select s.product_id,
         greatest(1, round(s.mu * 30))::int as stock_target,
         -- Same formula as migration 028: lead-time demand plus safety stock
         -- at a ~95% service level, against a uniform 7-day vendor lead time.
         greatest(1, round(s.mu * 7 + 1.65 * s.sigma * sqrt(7)))::int as rop_target
    from stat s
)
update inventory i
   set current_stock = t.stock_target,
       reorder_level = t.rop_target,
       -- Nothing is in transit after a deliberate reset; any reservation still
       -- recorded belongs to the regime being replaced.
       on_order      = 0,
       last_updated  = now()
  from target t
 where i.product_id = t.product_id;
