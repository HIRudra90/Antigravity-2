-- 028_demand_based_reorder_levels.sql
--
-- Reorder levels were seed constants, not calculations. Across all 66 products
-- there were four distinct values — 3, 6, 12 and 25 — assigned regardless of
-- whether a product sold 3 units a day or 250. Every single product's reorder
-- level sat below ONE day of demand; the average covered 0.14 days, about
-- three and a half hours.
--
-- Every vendor quotes a 7-day lead time. So the low-stock alert fired when
-- roughly three hours of stock remained, against a delivery a week away: the
-- product was guaranteed to sit empty for ~7 days before the restock landed.
-- That is why all 66 products tripped out-of-stock alerts simultaneously —
-- the system was not warning early, it was reporting after the fact.
--
-- The standard reorder point:
--
--     ROP = (mean daily demand x lead time) + safety stock
--     safety stock = Z * sigma_daily * sqrt(lead time)
--
-- with Z = 1.65, a ~95% service level: the stock that absorbs normal demand
-- variability during the lead time, so an ordinary busy week does not cause a
-- stockout.
--
-- ---------------------------------------------------------------------------
-- The outlier problem, which matters more than the formula
-- ---------------------------------------------------------------------------
-- Computed naively, this produced absurd answers — a reorder point of 8,042
-- for Wiper Fluid, over 100 days of normal demand. The cause is that
-- sales_transactions does not only contain retail demand. Bulk purchase orders
-- placed from the admin console (the "Buy All Available" button) are recorded
-- as sales too, and they are enormous.
--
-- Wiper Fluid 1L, last 90 days:
--     median day      76 units
--     95th percentile 109 units
--     largest day     13,442 units      <- a bulk order, not demand
--     mean            255  (inflated ~3x)
--     sigma           1,433 (inflated ~15x)
--
-- Both terms of the formula are built from the mean and sigma, so those spikes
-- corrupt the result twice over. Only 71 of 6,006 product-days are affected —
-- 1.18%, falling on just 2 distinct dates — so they are excluded rather than
-- modelled: a day above 3x that product's own median is treated as a
-- restocking event, not as demand. A per-product median is used rather than a
-- global threshold because a fast mover's ordinary day would otherwise look
-- like a slow mover's outlier.
--
-- Written as a function rather than a one-off UPDATE so it can be re-run as
-- demand shifts; a reorder level derived from last quarter's sales is only
-- correct for as long as that remains true.

create or replace function public.recompute_reorder_levels(
  p_days          integer default 90,   -- demand window
  p_service_z     numeric default 1.65, -- 1.65 = ~95% service level
  p_outlier_mult  numeric default 3.0   -- day > this x median = restock, not demand
)
returns table (
  product_id   integer,
  product_name text,
  old_level    integer,
  new_level    integer,
  daily_demand numeric
)
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
declare
  v_lead integer;
begin
  -- Conservative: the slowest vendor sets the exposure, since a stockout is
  -- governed by the delivery that has not arrived yet. All vendors currently
  -- quote 7 days, so this is presently uniform.
  select coalesce(max(lead_time_days), 7) into v_lead from vendors;

  return query
  with daily as (
    select s.product_id as pid, s.sale_date, sum(s.quantity_sold) as qty
      from sales_transactions s
     where s.sale_date >= current_date - p_days
     group by 1, 2
  ),
  med as (
    select d.pid, percentile_cont(0.5) within group (order by d.qty) as m
      from daily d group by 1
  ),
  clean as (
    select d.* from daily d join med m on m.pid = d.pid
     where d.qty <= p_outlier_mult * m.m
  ),
  stat as (
    select c.pid, avg(c.qty) as mu, coalesce(stddev_samp(c.qty), 0) as sigma
      from clean c group by 1
  ),
  calc as (
    select i.product_id as pid,
           i.reorder_level as old_rop,
           -- At least 1: a reorder level of 0 can never be crossed, so the
           -- product would never be flagged at all.
           greatest(1, round(s.mu * v_lead + p_service_z * s.sigma * sqrt(v_lead)))::int as rop,
           round(s.mu, 2) as mu
      from inventory i
      join stat s on s.pid = i.product_id
  ),
  upd as (
    update inventory i
       set reorder_level = c.rop,
           last_updated  = now()
      from calc c
     where i.product_id = c.pid
       and i.reorder_level is distinct from c.rop
    -- The previous value is carried through `calc` rather than read back from
    -- inventory afterwards: RETURNING reports post-update values, and a join
    -- to inventory here would rely on data-modifying-CTE snapshot rules to
    -- still see the old one. Carrying it explicitly is unambiguous.
    returning i.product_id, c.old_rop, c.rop, c.mu
  )
  select u.product_id, p.name::text, u.old_rop, u.rop, u.mu
    from upd u
    join products p on p.id = u.product_id;
end;
$fnbody$;

-- SECURITY DEFINER and it rewrites stock thresholds, so the default PUBLIC
-- grant is removed explicitly.
revoke all on function public.recompute_reorder_levels(integer, numeric, numeric) from public;
revoke all on function public.recompute_reorder_levels(integer, numeric, numeric) from anon;
grant execute on function public.recompute_reorder_levels(integer, numeric, numeric) to authenticated;

-- Apply once now.
select count(*) as products_updated from public.recompute_reorder_levels();
