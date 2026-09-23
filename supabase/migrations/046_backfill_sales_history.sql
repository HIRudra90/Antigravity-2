-- 046_backfill_sales_history.sql
--
-- Rebuilds a year of sales history from the frozen baseline in 045.
--
-- ISOLATION IS THE POINT OF THIS MIGRATION.
--
-- Two triggers, and only these two, connect sales to the inventory and money
-- side of the system:
--
--   trg_sale_decrement_inventory   stock down -> low-stock crossing ->
--                                  restock agent -> vendor purchase order
--   trg_cash_sale                  a cash_ledger revenue row per sale
--
-- Both are disabled for the insert, so this writes history and nothing else:
-- no stock movement, no low-stock alerts, no purchase orders, no cash. The
-- Restock queue and the vendor payment figures are the same after this runs as
-- they were before it. Statistics, Dashboard and the forecast page read
-- sales_transactions directly, so those fill in completely.
--
-- Both are re-enabled in an EXCEPTION block. Without that, a failure partway
-- through would leave them off and every subsequent real sale would silently
-- stop decrementing stock -- the failure mode migration 007 documents and
-- guards the same way.
--
-- Shape of the generated data:
--   * volume grows 10% a month, so Sep 2025 runs at 1/1.10^12 = 0.319x of today
--   * weekday factors sum to exactly 7.00, so they redistribute demand across
--     the week without changing the monthly total
--   * +/-12% daily jitter, so the lines read as real trading rather than a
--     drawn curve
--   * two rows per product per day, split 45/55, so "Avg Transaction" is a
--     plausible order rather than a whole day's sales in one row
--
-- Idempotent: a date that already has sales is skipped, so this can be re-run
-- after a partial failure without doubling that day up.

create or replace function public.backfill_sales_history(
  p_from date,
  p_to   date
)
returns table (days_written integer, rows_written integer, units_written bigint)
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
declare
  v_owner uuid;
  v_days  integer := 0;
  v_rows  integer := 0;
  v_units bigint  := 0;
begin
  if p_from > p_to then
    raise exception 'p_from (%) must be on or before p_to (%)', p_from, p_to;
  end if;
  if p_to > current_date then
    raise exception 'refusing to write sales dated after today (% > %). Forward-dated sales are what broke the forecast chart.', p_to, current_date;
  end if;

  select owner_id into v_owner from products where owner_id is not null limit 1;

  execute 'alter table public.sales_transactions disable trigger trg_sale_decrement_inventory';
  execute 'alter table public.sales_transactions disable trigger trg_cash_sale';

  with target_days as (
    select d::date as day
      from generate_series(p_from, p_to, interval '1 day') d
     where not exists (
       select 1 from sales_transactions s where s.sale_date = d::date
     )
  ),
  day_units as (
    select t.day,
           b.product_id,
           greatest(
             0,
             round(
               b.daily_units
               * sim_growth_factor(date_trunc('month', t.day)::date)
               * case extract(dow from t.day)::int
                   when 0 then 0.88   -- Sun
                   when 1 then 0.90   -- Mon
                   when 2 then 0.92   -- Tue
                   when 3 then 0.95   -- Wed
                   when 4 then 1.00   -- Thu
                   when 5 then 1.10   -- Fri
                   else        1.25   -- Sat
                 end
               * (0.88 + random() * 0.24)
             )
           )::int as units
      from target_days t
      cross join sim_baseline b
  ),
  split as (
    select d.day,
           d.product_id,
           case p.part
             when 1 then ceil(d.units * 0.45)::int
             else        d.units - ceil(d.units * 0.45)::int
           end as qty
      from day_units d
      cross join generate_series(1, 2) as p(part)
     where d.units > 0
  ),
  ins as (
    insert into sales_transactions (product_id, sale_date, quantity_sold, on_promotion, owner_id)
    select s.product_id, s.day, s.qty, (random() < 0.08), v_owner
      from split s
     where s.qty > 0
    returning sale_date, quantity_sold
  )
  select count(distinct sale_date)::int, count(*)::int, coalesce(sum(quantity_sold), 0)::bigint
    into v_days, v_rows, v_units
    from ins;

  execute 'alter table public.sales_transactions enable trigger trg_sale_decrement_inventory';
  execute 'alter table public.sales_transactions enable trigger trg_cash_sale';

  days_written  := coalesce(v_days, 0);
  rows_written  := coalesce(v_rows, 0);
  units_written := coalesce(v_units, 0);
  return next;

exception when others then
  -- Leaving these off would silently stop every future real sale from moving
  -- stock or cash, which is far worse than the failure being reported.
  execute 'alter table public.sales_transactions enable trigger trg_sale_decrement_inventory';
  execute 'alter table public.sales_transactions enable trigger trg_cash_sale';
  raise;
end;
$fnbody$;

comment on function public.backfill_sales_history(date, date) is
'Writes generated sales history with the inventory and cash triggers disabled, so it fills the reporting pages without touching restock or vendor payment. Idempotent per date.';

revoke all on function public.backfill_sales_history(date, date) from public, anon;
grant execute on function public.backfill_sales_history(date, date) to authenticated;
