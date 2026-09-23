-- 045_realtime_sales_simulator.sql
--
-- A continuous sales simulator, replacing the two ad-hoc harnesses that came
-- before it.
--
-- What was wrong with the old pair:
--
--   append_demo_sales_day()  filled forward to current_date but disabled the
--                            stock trigger, so it grew history that never
--                            touched inventory. Its source days were also
--                            hard-coded to a seed range ending 2026-06-20.
--
--   simulate_sales_days()    drew stock down correctly, but dated its days
--                            forward from max(sale_date) rather than from the
--                            calendar. Run it enough times and the data runs
--                            ahead of real time -- which is exactly what
--                            happened: sales reached 2026-11-21 while the
--                            calendar read 2026-09-23. Every date-anchored
--                            view then broke, the forecast chart worst of all,
--                            because it drew a "forecast" for months that
--                            already held recorded actuals.
--
-- This replaces both. Sales are always dated current_date. The clock is
-- pg_cron's, not the data's, so the two cannot drift apart again.
--
-- Demand model
-- ------------
-- Each product has a frozen baseline: its own cleaned mean daily demand,
-- measured once from real history. Cleaned means a day above 3x that
-- product's median is excluded -- bulk purchase orders were recorded as sales
-- too, and a mean polluted by a 13,442-unit "day" against a 76-unit median
-- would empty the warehouse on the first tick (same rule as migrations 028
-- and 036). Over the 90 days measured, that dropped 71 product-days and
-- brought total demand from 6,528/day to 4,411/day.
--
-- Volume grows 10% per month against that frozen baseline, and the baseline
-- is NOT re-measured each month. Deriving it from live stock would compound
-- against itself -- demand up, so restock orders up, so stock up, so demand
-- up again -- and 10% would become 30-40% in practice. After 12 months the
-- cycle resets to 1.0x rather than compounding to 9.8x in year two.

-- ---------------------------------------------------------------------------
-- Per-product frozen baseline
-- ---------------------------------------------------------------------------
create table if not exists public.sim_baseline (
  product_id  integer primary key references public.products(id) on delete cascade,
  daily_units numeric not null check (daily_units >= 0),
  created_at  timestamptz not null default now()
);

comment on table public.sim_baseline is
'Frozen per-product daily demand at cycle 0. Never recomputed from live stock -- that would compound the growth rate against itself.';

insert into public.sim_baseline (product_id, daily_units) values
  (1, 75.146),
  (2, 76.798),
  (3, 81.2),
  (4, 67.589),
  (5, 66.667),
  (6, 63.944),
  (7, 74.618),
  (8, 78.267),
  (9, 75.7),
  (10, 66.311),
  (11, 78.833),
  (12, 75.856),
  (13, 78),
  (14, 77.278),
  (15, 65.348),
  (16, 78.078),
  (17, 75.633),
  (18, 63.522),
  (19, 57.856),
  (20, 65.956),
  (21, 64.489),
  (22, 64.744),
  (23, 67.167),
  (24, 76.022),
  (25, 66.167),
  (26, 78.7),
  (27, 76.578),
  (28, 76.7),
  (29, 59.633),
  (30, 62.222),
  (31, 58.756),
  (32, 67.278),
  (33, 59.356),
  (34, 59.478),
  (35, 54.533),
  (36, 56.067),
  (37, 77.111),
  (38, 80.856),
  (39, 59.611),
  (40, 59.822),
  (41, 59.222),
  (42, 60.9),
  (43, 65.122),
  (44, 57.289),
  (45, 53.844),
  (46, 59.2),
  (47, 75.689),
  (48, 78.1),
  (49, 56.033),
  (50, 55.411),
  (51, 65.856),
  (52, 58.122),
  (53, 57.844),
  (54, 59.1),
  (55, 56.356),
  (56, 55.333),
  (57, 59.411),
  (58, 60.6),
  (59, 64.756),
  (60, 66.389),
  (61, 77.122),
  (62, 77.422),
  (63, 75.844),
  (64, 75.944),
  (65, 54.878),
  (66, 56.911)
on conflict (product_id) do update set daily_units = excluded.daily_units;

-- ---------------------------------------------------------------------------
-- Simulator state. One row, enforced.
-- ---------------------------------------------------------------------------
create table if not exists public.sim_state (
  id           integer primary key default 1 check (id = 1),
  anchor_month date        not null,   -- the month sim_baseline.daily_units describes
  cycle_start  date        not null,   -- first month of the current 12-month cycle
  enabled      boolean     not null default true,
  last_tick_at timestamptz
);

insert into public.sim_state (id, anchor_month, cycle_start, enabled)
values (1, date '2026-09-01', date '2025-09-01', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Cached daily demand shape from the model server.
--
-- The Space sleeps, so this is a cache and never a dependency: a tick with no
-- row for today uses weight 1.0 and carries on.
-- ---------------------------------------------------------------------------
create table if not exists public.sim_day_shape (
  shape_date date primary key,
  weights    jsonb not null,
  source     text  not null check (source in ('hf', 'fallback')),
  fetched_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Audit trail, so a gap in the sales data can be explained.
-- ---------------------------------------------------------------------------
create table if not exists public.sim_tick_log (
  id           bigserial primary key,
  ticked_at    timestamptz not null default now(),
  tick_date    date not null,
  rows_written integer not null default 0,
  units_sold   bigint  not null default 0,
  lost_units   bigint  not null default 0,
  note         text
);

create index if not exists sim_tick_log_ticked_idx on public.sim_tick_log (ticked_at desc);

-- ---------------------------------------------------------------------------
-- Growth factor for a given month, against the anchor.
-- ---------------------------------------------------------------------------
create or replace function public.sim_growth_factor(p_month date)
returns numeric
language sql
immutable
as $fn$
  select power(
    1.10,
    ((extract(year from p_month) - extract(year from (select anchor_month from public.sim_state where id = 1))) * 12
     + (extract(month from p_month) - extract(month from (select anchor_month from public.sim_state where id = 1))))::numeric
  );
$fn$;

-- ---------------------------------------------------------------------------
-- Stock reset: one month of cover for every product.
--
-- Makes "a month of sales equals the stock on hand" true by construction, and
-- clears the 10 products sitting at zero because the fast-forward harness had
-- already sold stock against dates that had not arrived yet.
--
-- on_order and restock_orders are deliberately left alone.
-- ---------------------------------------------------------------------------
update public.inventory i
   set current_stock = greatest(1, round(b.daily_units * 30))::int
  from public.sim_baseline b
 where b.product_id = i.product_id;

revoke all on function public.sim_growth_factor(date) from public, anon;
grant execute on function public.sim_growth_factor(date) to authenticated;
