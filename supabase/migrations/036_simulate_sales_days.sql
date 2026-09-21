-- 036_simulate_sales_days.sql
--
-- A test harness that behaves like a real shop.
--
-- Nothing in this system depletes stock gradually. append_demo_sales_day()
-- explicitly does:
--
--     alter table sales_transactions disable trigger trg_sale_decrement_inventory
--
-- which is correct for what it does -- it backfills PAST dates, and
-- subtracting yesterday's sales from today's shelf would be wrong. But it
-- means demo sales grow history without ever touching inventory. The only
-- things that moved stock were a bulk sale of the entire catalogue, the
-- restock agent, and hand edits. So stockouts could only ever be
-- all-66-at-once, and the restock cycle could never be observed behaving
-- normally.
--
-- This advances the clock instead. It writes real sales, one day at a time,
-- with the decrement trigger LEFT ON, so:
--
--   * stock falls at each product's own rate
--   * products cross their reorder points on different days
--   * trg_low_stock fires the agent for those products only
--   * revenue and the cash ledger move, because the ordinary sale triggers run
--
-- Days are dated forward from the last existing sale, so they can run ahead of
-- the real calendar. That is what fast-forwarding means and it is deliberate:
-- the alternative, stacking several days of demand onto today, would collide
-- on sale_date and make per-day reporting meaningless.
--
-- Demand per product per day is its own cleaned mean, scaled by a random
-- 0.7-1.3. Cleaned means excluding any day above 3x that product's median:
-- bulk purchase orders are recorded as sales here, and generating from a mean
-- polluted by a 13,442-unit "day" would empty the warehouse on the first tick.
--
-- A product cannot sell stock it does not have. Demand above the shelf is
-- reported as lost_units rather than driving current_stock negative, which is
-- the thing worth seeing in a restock test: what running out actually costs.

create or replace function public.simulate_sales_days(
  p_days       integer default 1,
  p_multiplier numeric default 1.0
)
returns table (
  day             date,
  rows_inserted   integer,
  units_sold      bigint,
  revenue         numeric,
  lost_units      bigint,
  crossed_reorder integer
)
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
declare
  v_day      date;
  v_start    date;
  v_i        integer;
  v_rows     integer;
  v_units    bigint;
  v_revenue  numeric;
  v_lost     bigint;
  v_crossed  integer;
  v_owner    uuid;
begin
  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'p_days must be between 1 and 90 (got %)', p_days;
  end if;

  select max(sale_date) into v_start from sales_transactions;
  v_start := coalesce(v_start, current_date - 1);
  select owner_id into v_owner from products where owner_id is not null limit 1;

  -- Per-product demand, measured once rather than per simulated day.
  create temp table if not exists _sim_demand (
    product_id integer primary key,
    mu numeric
  ) on commit drop;
  delete from _sim_demand;

  insert into _sim_demand (product_id, mu)
  with daily as (
    select product_id, sale_date, sum(quantity_sold) as qty
      from sales_transactions
     where sale_date >= current_date - 90
     group by 1, 2
  ),
  med as (
    select product_id, percentile_cont(0.5) within group (order by qty) as m
      from daily group by 1
  )
  select d.product_id, avg(d.qty)
    from daily d join med m on m.product_id = d.product_id
   where d.qty <= 3 * m.m
   group by 1;

  for v_i in 1 .. p_days loop
    v_day := v_start + v_i;

    -- How many products are above their reorder point before this day's sales,
    -- so the crossings caused BY this day can be counted.
    select count(*) into v_crossed
      from inventory where current_stock + on_order > reorder_level;

    with want as (
      select sd.product_id,
             greatest(0, round(sd.mu * p_multiplier * (0.7 + random() * 0.6)))::int as wanted
        from _sim_demand sd
    ),
    avail as (
      select w.product_id,
             w.wanted,
             least(w.wanted, greatest(0, i.current_stock)) as can_sell
        from want w join inventory i on i.product_id = w.product_id
    ),
    ins as (
      insert into sales_transactions (product_id, sale_date, quantity_sold, on_promotion, owner_id)
      select a.product_id, v_day, a.can_sell, false, v_owner
        from avail a
       where a.can_sell > 0
      returning product_id, quantity_sold
    )
    select count(*)::int,
           coalesce(sum(i.quantity_sold), 0)::bigint,
           coalesce(round(sum(i.quantity_sold * p.unit_price)), 0)
      into v_rows, v_units, v_revenue
      from ins i join products p on p.id = i.product_id;

    -- Demand that could not be met, recomputed against the same day's numbers.
    select coalesce(sum(a.wanted - a.can_sell), 0)::bigint
      into v_lost
      from (
        select sd.product_id,
               greatest(0, round(sd.mu * p_multiplier))::int as wanted,
               least(greatest(0, round(sd.mu * p_multiplier))::int,
                     greatest(0, i.current_stock)) as can_sell
          from _sim_demand sd join inventory i on i.product_id = sd.product_id
      ) a;

    select v_crossed - count(*) into v_crossed
      from inventory where current_stock + on_order > reorder_level;

    day             := v_day;
    rows_inserted   := coalesce(v_rows, 0);
    units_sold      := coalesce(v_units, 0);
    revenue         := coalesce(v_revenue, 0);
    lost_units      := coalesce(v_lost, 0);
    crossed_reorder := greatest(0, coalesce(v_crossed, 0));
    return next;
  end loop;
end;
$fnbody$;

comment on function public.simulate_sales_days(integer, numeric) is
'Test harness: advances the clock by N days of realistic sales WITH stock drawdown. Writes real rows.';

-- Writes sales and moves stock, so it is not something an anonymous caller
-- should be able to invoke.
revoke all on function public.simulate_sales_days(integer, numeric) from public;
revoke all on function public.simulate_sales_days(integer, numeric) from anon;
grant execute on function public.simulate_sales_days(integer, numeric) to authenticated;
