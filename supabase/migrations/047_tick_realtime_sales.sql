-- 047_tick_realtime_sales.sql
--
-- The live tick. Unlike the 046 backfill, this one runs with both triggers ON:
-- stock falls, trg_low_stock fires the restock agent, purchase orders get
-- placed, deliveries land, cash moves. The whole loop, driven continuously.
--
-- Three properties that the old simulate_sales_days() did not have.
--
-- 1. Sales are dated current_date, never forward.
--
--    simulate_sales_days dated its days from max(sale_date), so each run
--    started where the last one ended and the data raced ahead of the
--    calendar -- reaching 2026-11-21 while the calendar read 2026-09-23. The
--    forecast chart then drew a "forecast" for September against September
--    actuals that already existed. A realtime simulator has no business
--    inventing tomorrow, so this refuses to.
--
-- 2. Time-proportional, so a missed tick is not a lost tick.
--
--    Quantity comes from how much time has actually passed since the last
--    tick, not from a fixed per-tick amount. Miss four hours and the next tick
--    writes four hours of demand; change the cron interval and nothing needs
--    recalculating. Capped at 24h so a long outage cannot dump a week of
--    demand into one day.
--
-- 3. Probabilistic rounding, so slow movers do not vanish.
--
--    A product selling 1,615 units a month is 2.2 units an hour. Rounding that
--    to the nearest integer every tick is fine, but a genuinely slow product
--    at 0.4/hour would round to zero forever and never sell anything. Adding 1
--    with probability equal to the fraction makes the expected value exact
--    over many ticks, so small products converge on their real monthly total
--    instead of silently dropping out of the data.
--
-- Growth resets every 12 months rather than compounding forever: 1.10^12 is
-- 3.1x, but 1.10^24 is 9.8x and 1.10^48 is 97x, at which point the charts are
-- unreadable and the stock figures absurd.

-- Cycle-aware growth for the live clock, distinct from sim_growth_factor()
-- which the historical backfill used and which is deliberately unbounded
-- backwards.
-- The double modulo is not redundant: Postgres % keeps the sign of the left
-- operand, so a month before the anchor gives -1, and 1.10^-1 would quietly
-- shrink demand instead of wrapping to the top of the cycle.
create or replace function public.sim_live_factor(p_month date)
returns numeric
language sql
stable
as $fn$
  select power(1.10, (((m.ahead % 12) + 12) % 12)::numeric)
    from public.sim_state s
    cross join lateral (
      select ((extract(year from p_month) - extract(year from s.anchor_month)) * 12
            + (extract(month from p_month) - extract(month from s.anchor_month)))::int as ahead
    ) m
   where s.id = 1;
$fn$;

create or replace function public.tick_realtime_sales(
  p_dry_run boolean default false
)
returns table (
  tick_date     date,
  elapsed_hours numeric,
  rows_written  integer,
  units_sold    bigint,
  lost_units    bigint,
  note          text
)
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
declare
  v_state    record;
  v_owner    uuid;
  v_elapsed  numeric;
  v_factor   numeric;
  v_dow      numeric;
  v_rows     integer := 0;
  v_units    bigint  := 0;
  v_lost     bigint  := 0;
  v_note     text    := 'ok';
begin
  select * into v_state from sim_state where id = 1;
  if not found then
    raise exception 'sim_state row missing -- migration 045 did not run';
  end if;

  if not v_state.enabled then
    tick_date := current_date; elapsed_hours := 0; rows_written := 0;
    units_sold := 0; lost_units := 0; note := 'simulator disabled';
    return next; return;
  end if;

  -- How much demand this tick represents. A first-ever tick assumes one hour
  -- rather than reaching back to the epoch.
  v_elapsed := case
    when v_state.last_tick_at is null then 1.0
    else least(24.0, greatest(0.0, extract(epoch from (now() - v_state.last_tick_at)) / 3600.0))
  end;

  if v_elapsed < 0.01 then
    tick_date := current_date; elapsed_hours := v_elapsed; rows_written := 0;
    units_sold := 0; lost_units := 0; note := 'too soon since last tick';
    return next; return;
  end if;

  select owner_id into v_owner from products where owner_id is not null limit 1;
  v_factor := sim_live_factor(date_trunc('month', current_date)::date);
  v_dow := case extract(dow from current_date)::int
             when 0 then 0.88 when 1 then 0.90 when 2 then 0.92 when 3 then 0.95
             when 4 then 1.00 when 5 then 1.10 else 1.25 end;

  create temp table _tick (
    product_id int primary key,
    wanted     int not null,
    can_sell   int not null
  ) on commit drop;

  with raw as (
    select b.product_id,
           b.daily_units
             * v_factor
             * v_dow
             * (v_elapsed / 24.0)
             -- The AI demand shape, when the model server managed to supply
             -- one today. Absent (Space asleep) it falls back to 1.0 and the
             -- tick carries on regardless -- the cache is never a dependency.
             * coalesce((
                 select (sh.weights ->> b.product_id::text)::numeric
                   from sim_day_shape sh where sh.shape_date = current_date
               ), 1.0)
             * (0.85 + random() * 0.30) as v
      from sim_baseline b
  )
  insert into _tick (product_id, wanted, can_sell)
  select r.product_id,
         w.wanted,
         -- A product cannot sell stock it does not have. The shortfall is
         -- recorded as lost demand rather than driving current_stock negative,
         -- which is the thing worth seeing: what running out actually costs.
         least(w.wanted, greatest(0, i.current_stock))
    from raw r
    join inventory i on i.product_id = r.product_id
    cross join lateral (
      -- Probabilistic rounding: floor, plus one with probability equal to the
      -- fractional part. Exact in expectation, so slow movers survive.
      select (floor(r.v) + case when random() < (r.v - floor(r.v)) then 1 else 0 end)::int as wanted
    ) w;

  select coalesce(sum(greatest(0, wanted - can_sell)), 0)::bigint into v_lost from _tick;

  if p_dry_run then
    select count(*)::int, coalesce(sum(can_sell), 0)::bigint
      into v_rows, v_units from _tick where can_sell > 0;
    v_note := 'dry run -- nothing written';
  else
    with ins as (
      insert into sales_transactions (product_id, sale_date, quantity_sold, on_promotion, owner_id)
      select t.product_id, current_date, t.can_sell, (random() < 0.08), v_owner
        from _tick t
       where t.can_sell > 0
      returning quantity_sold
    )
    select count(*)::int, coalesce(sum(quantity_sold), 0)::bigint
      into v_rows, v_units from ins;

    update sim_state set last_tick_at = now() where id = 1;

    -- Postgres format() takes %s/%I/%L only; C-style precision specifiers
    -- like %.3f raise "unrecognized format() type specifier".
    insert into sim_tick_log (tick_date, rows_written, units_sold, lost_units, note)
    values (current_date, v_rows, v_units, v_lost,
            format('factor %s, dow %s, %sh',
                   round(v_factor, 3), round(v_dow, 2), round(v_elapsed, 2)));
  end if;

  tick_date     := current_date;
  elapsed_hours := round(v_elapsed, 3);
  rows_written  := coalesce(v_rows, 0);
  units_sold    := coalesce(v_units, 0);
  lost_units    := coalesce(v_lost, 0);
  note          := v_note;
  return next;
end;
$fnbody$;

comment on function public.tick_realtime_sales(boolean) is
'One tick of live sales, dated today, with stock drawdown and the restock loop live. Time-proportional so a missed tick is not a lost tick.';

revoke all on function public.tick_realtime_sales(boolean) from public, anon;
grant execute on function public.tick_realtime_sales(boolean) to authenticated, service_role;
revoke all on function public.sim_live_factor(date) from public, anon;
grant execute on function public.sim_live_factor(date) to authenticated, service_role;
