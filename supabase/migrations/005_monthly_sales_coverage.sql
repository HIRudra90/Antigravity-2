-- 005_monthly_sales_coverage.sql
--
-- Read-only helper. Reports, per month, how many distinct days actually
-- carry sales against how many days the month has.
--
-- The forecast chart was plotting June 2026 as a normal month when it holds
-- only 20 of 30 days, so the "actual sales" line fell off a cliff and both
-- forecast lines anchored to that artificially low point. Completeness is a
-- property of the data, not something the client can infer from a revenue
-- total, so it has to come from the database.

create or replace function public.get_monthly_sales_coverage(months_back integer default 24)
returns table (
  month_key       text,
  month_start     date,
  month_end       date,
  days_with_sales integer,
  days_in_month   integer,
  is_complete     boolean,
  revenue         numeric,
  units           bigint
)
language sql
security definer
set search_path to 'public'
as $fn$
  select
    to_char(date_trunc('month', t.sale_date), 'Mon YYYY')                      as month_key,
    date_trunc('month', t.sale_date)::date                                     as month_start,
    (date_trunc('month', t.sale_date) + interval '1 month - 1 day')::date      as month_end,
    count(distinct t.sale_date)::int                                           as days_with_sales,
    extract(day from (date_trunc('month', t.sale_date) + interval '1 month - 1 day'))::int as days_in_month,
    count(distinct t.sale_date)
      >= extract(day from (date_trunc('month', t.sale_date) + interval '1 month - 1 day'))::int
                                                                               as is_complete,
    round(sum(t.quantity_sold::numeric * p.unit_price))                        as revenue,
    sum(t.quantity_sold)                                                       as units
  from sales_transactions t
  join products p on p.id = t.product_id
  where t.sale_date >= (current_date - (months_back || ' months')::interval)
  group by date_trunc('month', t.sale_date)
  order by date_trunc('month', t.sale_date);
$fn$;

comment on function public.get_monthly_sales_coverage(integer) is
'Monthly revenue/units plus day coverage, so callers can drop partial months instead of charting them as complete.';

grant execute on function public.get_monthly_sales_coverage(integer) to anon, authenticated;


-- Per-family totals for an arbitrary window, used by the accuracy backtest to
-- compare the model against what was actually sold. Aggregating here avoids
-- paging thousands of transaction rows through PostgREST on every page load.
create or replace function public.get_family_units(from_date date, to_date date)
returns table (family text, units bigint, revenue numeric)
language sql
stable
security definer
set search_path to 'public'
as $fn2$
  select p.family,
         sum(t.quantity_sold)::bigint,
         round(sum(t.quantity_sold::numeric * p.unit_price))
  from sales_transactions t
  join products p on p.id = t.product_id
  where t.sale_date >= from_date
    and t.sale_date <= to_date
    and p.family is not null
  group by p.family
  order by p.family;
$fn2$;

grant execute on function public.get_family_units(date, date) to anon, authenticated;


-- Observed sales velocity per product, used as the demand basis for the stock
-- recommendations. The forecast model predicts per product *family* on its
-- training set's scale, so its per-product number can be many times what a
-- specific product actually sells; sizing purchase orders off that inflates
-- them badly. daily_rate is per day that actually had sales, so a gap in the
-- data does not read as a slowdown.
create or replace function public.get_product_daily_demand(days_back integer default 60)
returns table (product_id bigint, units bigint, days_covered integer, daily_rate numeric)
language sql
stable
security definer
set search_path to 'public'
as $fn3$
  select t.product_id::bigint,
         sum(t.quantity_sold)::bigint,
         count(distinct t.sale_date)::int,
         round(sum(t.quantity_sold)::numeric / nullif(count(distinct t.sale_date), 0), 3)
  from sales_transactions t
  where t.sale_date >= (current_date - (days_back || ' days')::interval)
  group by t.product_id;
$fn3$;

grant execute on function public.get_product_daily_demand(integer) to anon, authenticated;
