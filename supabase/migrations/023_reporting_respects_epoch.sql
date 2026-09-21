-- 023_reporting_respects_epoch.sql
--
-- The books were reset (015_books_opened_at) and the Payment page duly showed
-- $0 revenue. Every other page did not. Dashboard, Statistics and Inventory
-- read their numbers from RPCs that predate the epoch and filter only on a
-- rolling window -- CURRENT_DATE - N months -- so they kept reporting the full
-- 2026-01-01 -> 2026-09-21 history, 62,327 rows of it. One reset, two answers,
-- depending which page you happened to be looking at.
--
-- The fix is to teach the reporting functions the same cutoff the Payment page
-- already honours, NOT to delete the sales rows. Those rows are the training
-- and backtest set for the forecasting model and the PPO restock agent; the
-- accounting question ("what have I earned since I opened the books?") and the
-- modelling question ("what does demand for this product look like?") want
-- different windows over the same table.
--
-- So the eight functions that touch sales_transactions split in two:
--
--   Reporting -- epoch-filtered here:
--     get_daily_revenue, get_monthly_revenue, get_sales_overview,
--     get_top_products, get_category_revenue
--
--   Model input -- deliberately left reading full history:
--     get_family_units            (forecast backtest calibration/holdout)
--     get_monthly_sales_coverage  (24-month coverage check)
--     get_product_daily_demand    (90-day signal for the restock agent)
--
-- The cutoff is on created_at, not sale_date, to match Payment.tsx exactly.
-- 400 rows carry sale_date = 2026-09-21 but were written at 14:16, before the
-- 16:42 epoch. Filtering on sale_date would readmit them and put Dashboard and
-- Payment back into disagreement over the same day -- the precise bug this
-- migration exists to close.
--
-- books_opened_at() is wrapped in a scalar subquery so it is evaluated once as
-- an InitPlan rather than per row.

create or replace function public.get_daily_revenue(days_back integer default 7)
returns table(sale_date date, revenue numeric)
language sql
security definer
set search_path to 'public'
as $function$
  SELECT
    t.sale_date,
    ROUND(SUM(t.quantity_sold::numeric * p.unit_price)) AS revenue
  FROM sales_transactions t
  JOIN products p ON p.id = t.product_id
  WHERE t.sale_date >= CURRENT_DATE - days_back
    AND t.created_at >= (select books_opened_at())
  GROUP BY t.sale_date
  ORDER BY t.sale_date;
$function$;

create or replace function public.get_monthly_revenue(months_back integer default 12)
returns table(month_key text, month_start date, revenue numeric, profit numeric, units bigint)
language sql
security definer
set search_path to 'public'
as $function$
  SELECT
    TO_CHAR(DATE_TRUNC('month', t.sale_date), 'Mon YYYY') AS month_key,
    DATE_TRUNC('month', t.sale_date)::date AS month_start,
    ROUND(SUM(t.quantity_sold::numeric * p.unit_price)) AS revenue,
    ROUND(SUM(t.quantity_sold::numeric * (p.unit_price - p.unit_cost))) AS profit,
    SUM(t.quantity_sold) AS units
  FROM sales_transactions t
  JOIN products p ON p.id = t.product_id
  WHERE t.sale_date >= CURRENT_DATE - (months_back || ' months')::interval
    AND t.created_at >= (select books_opened_at())
  GROUP BY DATE_TRUNC('month', t.sale_date)
  ORDER BY DATE_TRUNC('month', t.sale_date);
$function$;

create or replace function public.get_sales_overview()
returns table(total_orders bigint, total_revenue numeric, orders_today bigint, orders_yesterday bigint, orders_this_month bigint, orders_last_month bigint, revenue_this_month numeric, revenue_last_month numeric)
language sql
stable
set search_path to 'public'
as $function$
  with s as (
    select t.sale_date,
           t.quantity_sold::numeric * coalesce(p.unit_price, 0) as amount
      from sales_transactions t
      join products p on p.id = t.product_id
     where t.created_at >= (select books_opened_at())
  )
  -- No GROUP BY, so this returns exactly one row even when there are no
  -- sales at all, rather than an empty result the caller has to special-case.
  select
    count(*)::bigint,
    coalesce(round(sum(amount)), 0),
    count(*) filter (where sale_date = current_date)::bigint,
    count(*) filter (where sale_date = current_date - 1)::bigint,
    count(*) filter (where sale_date >= date_trunc('month', current_date)::date)::bigint,
    count(*) filter (where sale_date >= (date_trunc('month', current_date) - interval '1 month')::date
                       and sale_date <  date_trunc('month', current_date)::date)::bigint,
    coalesce(round(sum(amount) filter (where sale_date >= date_trunc('month', current_date)::date)), 0),
    coalesce(round(sum(amount) filter (where sale_date >= (date_trunc('month', current_date) - interval '1 month')::date
                                         and sale_date <  date_trunc('month', current_date)::date)), 0)
  from s;
$function$;

create or replace function public.get_top_products(months_back integer default 12)
returns table(name text, sales bigint)
language sql
security definer
set search_path to 'public'
as $function$
  SELECT p.name::text, SUM(t.quantity_sold) AS sales
  FROM sales_transactions t
  JOIN products p ON p.id = t.product_id
  WHERE t.sale_date >= CURRENT_DATE - (months_back || ' months')::interval
    AND t.created_at >= (select books_opened_at())
  GROUP BY p.name
  ORDER BY SUM(t.quantity_sold) DESC
  LIMIT 5;
$function$;

create or replace function public.get_category_revenue(months_back integer default 12)
returns table(family text, revenue numeric)
language sql
security definer
set search_path to 'public'
as $function$
  SELECT p.family::text, ROUND(SUM(t.quantity_sold::numeric * p.unit_price)) AS revenue
  FROM sales_transactions t
  JOIN products p ON p.id = t.product_id
  WHERE t.sale_date >= CURRENT_DATE - (months_back || ' months')::interval
    AND t.created_at >= (select books_opened_at())
  GROUP BY p.family
  ORDER BY SUM(t.quantity_sold::numeric * p.unit_price) DESC;
$function$;
