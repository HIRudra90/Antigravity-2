-- 007_daily_demo_sales_job.sql
--
-- Keeps the demo dataset current so the dashboard charts never go blank.
--
-- 006 backfilled a fixed range. That goes stale the moment real time moves on:
-- the Dashboard's 7-day revenue chart queries `current_date - 6`, so once the
-- newest sale is a week old the chart renders empty. This appends the missing
-- days on a schedule instead.
--
-- Properties that matter:
--
--   Idempotent   A date that already has rows is skipped, so running it twice
--                in a day, or by hand while the cron job also fires, cannot
--                double up.
--   Self-healing It fills every date between the last sale and today, not just
--                yesterday. Leave the project for a month and one run catches up.
--   Stock-safe   trg_sale_decrement_inventory is disabled for the insert and
--                re-enabled in an EXCEPTION block, so a failure mid-run cannot
--                leave it off and silently stop decrementing real sales.
--
-- Source days come from the ORIGINAL seed range (on or before 2026-06-20),
-- never from previously generated rows. Replaying generated data would compound
-- its own artefacts until every week looked identical.

create or replace function public.append_demo_sales_day()
returns table (days_added integer, rows_added integer)
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  -- Last day of genuine seed data. Sources are drawn only from on/before this.
  seed_end constant date := date '2026-06-20';
  tgt      date;
  src      date;
  matches  integer;
  added    integer;
  n_days   integer := 0;
  n_rows   integer := 0;
begin
  execute 'alter table public.sales_transactions disable trigger trg_sale_decrement_inventory';

  for tgt in
    select d::date
    from generate_series(
           coalesce((select max(sale_date) from public.sales_transactions), seed_end) + 1,
           current_date,
           interval '1 day') d
  loop
    if exists (select 1 from public.sales_transactions where sale_date = tgt) then
      continue;
    end if;

    -- How many seed days share this weekday, so the pick can rotate rather
    -- than always cloning the same Tuesday.
    select count(distinct s.sale_date) into matches
    from public.sales_transactions s
    where s.sale_date <= seed_end
      and extract(dow from s.sale_date) = extract(dow from tgt);

    if matches = 0 then
      continue;
    end if;

    select x.sale_date into src
    from (
      select distinct sale_date
      from public.sales_transactions
      where sale_date <= seed_end
        and extract(dow from sale_date) = extract(dow from tgt)
      order by sale_date
    ) x
    offset ((tgt - seed_end) % matches)
    limit 1;

    insert into public.sales_transactions
      (product_id, sale_date, quantity_sold, on_promotion, owner_id)
    select s.product_id,
           tgt,
           greatest(1, round(s.quantity_sold * (0.90 + random() * 0.28))::int),
           s.on_promotion,
           s.owner_id
    from public.sales_transactions s
    where s.sale_date = src;

    get diagnostics added = row_count;
    n_rows := n_rows + added;
    n_days := n_days + 1;
  end loop;

  execute 'alter table public.sales_transactions enable trigger trg_sale_decrement_inventory';

  days_added := n_days;
  rows_added := n_rows;
  return next;

exception when others then
  -- Never leave the trigger disabled: real sales would stop decrementing stock.
  execute 'alter table public.sales_transactions enable trigger trg_sale_decrement_inventory';
  raise;
end;
$fn$;

comment on function public.append_demo_sales_day() is
'Appends generated demo sales for every date between the last recorded sale and today. Idempotent and stock-safe. Scheduled as cron job demo-sales-daily.';

-- 02:15 UTC, before the existing agent-restock (08:00) and agent-payroll (09:00)
-- jobs, so they see a complete day of sales.
select cron.schedule(
  'demo-sales-daily',
  '15 2 * * *',
  $job$select public.append_demo_sales_day();$job$
);

-- Inspect:   select * from cron.job where jobname = 'demo-sales-daily';
-- History:   select * from cron.job_run_details where jobid =
--              (select jobid from cron.job where jobname = 'demo-sales-daily')
--            order by start_time desc limit 10;
-- Run now:   select * from public.append_demo_sales_day();
-- Disable:   select cron.unschedule('demo-sales-daily');
