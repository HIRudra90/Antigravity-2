-- 050_retire_fast_forward_harness.sql
--
-- Stops simulate_sales_days() from writing sales into the future.
--
-- That function dates its days from max(sale_date) rather than from the
-- calendar, so each run starts where the last one ended. Run it a few times
-- and the data leaves real time behind: sales reached 2026-11-21 while the
-- calendar read 2026-09-23, two months ahead. Every date-anchored view then
-- misreads, the forecast chart worst of all -- it drew the model "forecasting"
-- 24.9M for a September that already held 110.6M of recorded actuals, because
-- the forecast window starts at today and today was buried inside the data.
--
-- Fast-forwarding was a reasonable thing to want when nothing else moved
-- stock. It is incompatible with a realtime clock: 047's tick and this
-- function disagree about what day it is, and only one of them can be right.
--
-- The guard is here rather than only in the UI because Settings.tsx is not the
-- only possible caller -- the RPC is reachable by any authenticated client. A
-- check in the page would protect the button, not the database.
--
-- The signature is kept so an old client gets a clear explanation instead of
-- "function does not exist". It must match migration 041's exactly, including
-- the delivered/units_received columns that 041 added -- CREATE OR REPLACE
-- cannot change a function's OUT parameters, and getting this wrong means the
-- migration fails while the unguarded function stays live.

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
  crossed_reorder integer,
  delivered       integer,
  units_received  bigint
)
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
begin
  raise exception using
    message = 'simulate_sales_days is retired: it wrote sales dated into the future.',
    detail  = 'It advanced from max(sale_date) rather than the calendar, so the data ran ahead of real time and every date-anchored view misread it (migration 050).',
    hint    = 'For live sales use tick_realtime_sales(), which pg_cron already runs hourly. To fill a gap in PAST history use backfill_sales_history(from_date, to_date).';
end;
$fnbody$;

comment on function public.simulate_sales_days(integer, numeric) is
'RETIRED (migration 050). Forward-dated the sales calendar, which broke every date-anchored view. Use tick_realtime_sales() or backfill_sales_history().';
