-- 041_simulate_deliveries.sql
--
-- The simulator advanced sales but never advanced deliveries, so stock only
-- ever went down. After 37 simulated days: all 66 products at zero, 306
-- purchase orders sitting in Pending with an ETA of 2026-09-28 while the
-- simulated calendar read 2026-10-28 -- a month overdue and still waiting.
--
-- That is not a restock cycle, it is a drain. Half the cycle was missing:
--
--     sell -> stock falls -> agent orders -> [nothing] -> stock stays at zero
--
-- Each simulated day now begins by receiving whatever was due, so the loop
-- closes:
--
--     sell -> stock falls -> agent orders -> goods arrive -> stock recovers
--
-- Receiving goes through the ordinary path: setting status to 'Delivered'
-- fires receive_restock_order(), which credits current_stock, releases
-- on_order, and takes the product back out of the low-stock queue. The
-- simulator does not touch inventory itself -- the same rule migration 033
-- established, that only triggers move stock.
--
-- A note on timing. expected_delivery is stamped by whoever raised the order
-- from the REAL clock (ordered_at + the vendor's lead time), while simulated
-- days run ahead of the real calendar. So an order raised by the agent during
-- one run will generally arrive on the first day of the next run rather than a
-- full seven simulated days later. For a harness whose purpose is to exercise
-- the cycle that is a fair trade; modelling the lead time properly would mean
-- teaching the agent what the simulated date is, which is a much larger change
-- for a test tool. The lag is real, just shorter than production's.

drop function if exists public.simulate_sales_days(integer, numeric);

create function public.simulate_sales_days(
  p_days       integer default 1,
  p_multiplier numeric default 1.0
)
returns table (
  day             date,
  rows_inserted   integer,
  units_sold      bigint,
  revenue         numeric,
  lost_units      bigint,
  crossed_reorder integer,
  delivered       integer,
  units_received  bigint
)
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
declare
  v_day       date;
  v_start     date;
  v_i         integer;
  v_rows      integer;
  v_units     bigint;
  v_revenue   numeric;
  v_lost      bigint;
  v_crossed   integer;
  v_delivered integer;
  v_received  bigint;
  v_owner     uuid;
begin
  if p_days is null or p_days < 1 or p_days > 60 then
    raise exception 'p_days must be between 1 and 60 (got %). Longer runs exceed the 8s statement timeout.', p_days;
  end if;

  select max(sale_date) into v_start from sales_transactions;
  v_start := coalesce(v_start, current_date - 1);
  select owner_id into v_owner from products where owner_id is not null limit 1;

  create temp table if not exists _sim_demand (
    product_id integer primary key,
    mu numeric
  ) on commit drop;
  -- `where true`: supautils rejects an unqualified DELETE for `authenticated`.
  delete from _sim_demand where true;

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

    -- ── Morning: receive whatever was due. ──────────────────────────────
    -- receive_restock_order() does the stock movement; this only flips the
    -- status, exactly as a human confirming a delivery would.
    with due as (
      update restock_orders
         set status = 'Delivered'
       where status = 'Pending'
         and expected_delivery is not null
         and expected_delivery <= v_day
      returning items
    )
    select count(*)::int,
           coalesce(sum((select coalesce(sum((it->>'quantity')::numeric), 0)
                           from jsonb_array_elements(coalesce(d.items, '[]'::jsonb)) it)), 0)::bigint
      into v_delivered, v_received
      from due d;

    select count(*) into v_crossed
      from inventory where current_stock + on_order > reorder_level;

    -- ── Day: sell. ──────────────────────────────────────────────────────
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
    delivered       := coalesce(v_delivered, 0);
    units_received  := coalesce(v_received, 0);
    return next;
  end loop;
end;
$fnbody$;

revoke all on function public.simulate_sales_days(integer, numeric) from public;
revoke all on function public.simulate_sales_days(integer, numeric) from anon;
grant execute on function public.simulate_sales_days(integer, numeric) to authenticated;
