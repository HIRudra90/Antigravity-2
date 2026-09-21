-- 009_sales_overview.sql
--
-- The dashboard used to pull every sales row into the browser and aggregate
-- there. PostgREST caps a response at 1000 rows, so with 61k sales on file
-- "Total Orders" read 1,000 and "Revenue" only summed the rows that happened
-- to come back — both silently wrong, and both getting wronger over time.
--
-- Aggregating in SQL is exact whatever the table size, and the dashboard
-- stops downloading megabytes on every refresh.
--
-- SECURITY INVOKER on purpose: RLS on sales_transactions then applies
-- normally, so an owner sees their own tenant and nothing else. (Note that
-- the older get_daily_revenue is SECURITY DEFINER with no tenant predicate,
-- which reads across every owner — harmless with one tenant on file, worth
-- tightening before a second one exists.)

create or replace function public.get_sales_overview()
returns table (
  total_orders       bigint,
  total_revenue      numeric,
  orders_today       bigint,
  orders_yesterday   bigint,
  orders_this_month  bigint,
  orders_last_month  bigint,
  revenue_this_month numeric,
  revenue_last_month numeric
)
language sql
stable
security invoker
set search_path to 'public'
as $fnbody$
  with s as (
    select t.sale_date,
           t.quantity_sold::numeric * coalesce(p.unit_price, 0) as amount
      from sales_transactions t
      join products p on p.id = t.product_id
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
$fnbody$;

comment on function public.get_sales_overview() is
'Exact dashboard totals computed in SQL. Replaces client-side aggregation that was capped at PostgREST''s 1000-row limit.';

grant execute on function public.get_sales_overview() to anon, authenticated;
