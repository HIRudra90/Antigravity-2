-- 039_fix_simulate_bare_delete.sql
--
-- simulate_sales_days() failed for the app with "DELETE requires a WHERE
-- clause" while working perfectly from SQL.
--
-- Supabase preloads `supautils`, which refuses an unqualified DELETE or UPDATE
-- as a footgun guard. The function had:
--
--     delete from _sim_demand;
--
-- clearing its own temp table. Harmless in intent, and it ran fine under the
-- postgres role I tested with, because the guard does not apply there. Every
-- call from the browser runs as `authenticated`, where it does — so this only
-- ever failed on the path that matters, and testing through the Management API
-- could never have caught it.
--
-- `where true` satisfies the guard and changes nothing about the semantics.
-- (The delete is close to redundant anyway: the temp table is ON COMMIT DROP
-- and an RPC call is a single transaction, so it is normally created fresh.
-- It stays for the case where the function is called twice inside one
-- transaction, which is exactly what a SQL caller doing several runs would do.)
--
-- Also lowers the ceiling from 90 days to 60. `authenticated` carries
-- statement_timeout=8s and a run costs ~0.12s per simulated day
-- (7 days / 462 rows measured at 0.85s), so 90 days would sit around 11s and
-- abort halfway through — leaving some days written and others not. 60 is
-- ~7s, which fits. A SQL caller wanting more can loop.

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
  -- `where true`: supautils rejects an unqualified DELETE for the
  -- `authenticated` role, which is every call from the app.
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

revoke all on function public.simulate_sales_days(integer, numeric) from public;
revoke all on function public.simulate_sales_days(integer, numeric) from anon;
grant execute on function public.simulate_sales_days(integer, numeric) to authenticated;
