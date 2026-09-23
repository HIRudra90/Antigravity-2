-- 048_schedule_realtime_tick.sql
--
-- Puts the simulator's clock in pg_cron rather than in the model server.
--
-- The obvious place for a continuous loop is the Hugging Face Space, since
-- that is where the models already live. It is the wrong place. The Space runs
-- on free cpu-basic, which sleeps on inactivity and is restarted at Hugging
-- Face's discretion; a `while True` inside FastAPI dies with the container and
-- takes any in-memory counter with it. pg_cron is already running five jobs on
-- this database without supervision.
--
-- So Postgres keeps the time and the Space supplies the demand shape. The
-- Space being asleep costs a little realism in the mix between products, and
-- nothing else -- tick_realtime_sales falls back to a flat 1.0 weight.

-- ---------------------------------------------------------------------------
-- Retire the old daily generator.
--
-- append_demo_sales_day() drew its weekday patterns from a seed range ending
-- 2026-06-20 and cloned them forward. That range no longer exists -- the
-- history was rebuilt from the measured per-product baseline in 045/046 -- so
-- the function now has nothing to sample and would find no source day for any
-- target date. It is also redundant: the hourly tick keeps the data current by
-- construction, which was the whole reason 007 existed.
-- ---------------------------------------------------------------------------
select cron.unschedule('demo-sales-daily')
 where exists (select 1 from cron.job where jobname = 'demo-sales-daily');

-- ---------------------------------------------------------------------------
-- The live tick, hourly on the hour.
--
-- Hourly is a deliberate middle: frequent enough that the dashboard visibly
-- moves during a working day, infrequent enough to stay far inside the
-- throttle migration 042 had to introduce after the simulator rate-limited
-- this project into an outage. The tick is time-proportional, so changing this
-- interval needs no other change -- halve it and each tick simply carries half
-- the demand.
-- ---------------------------------------------------------------------------
select cron.schedule(
  'sim-realtime-sales-hourly',
  '0 * * * *',
  $cron$ select public.tick_realtime_sales(); $cron$
);
