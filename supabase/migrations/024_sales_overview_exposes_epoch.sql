-- 024_sales_overview_exposes_epoch.sql
--
-- 023 silenced the aggregate RPCs, but the Dashboard's "Recent Orders" list is
-- not an RPC -- it reads sales_transactions directly, ordered by sale_date desc
-- and capped with .limit(5). That query has no epoch filter, so the page would
-- have shown five pre-reset orders sitting directly beneath a $0 revenue card.
-- The same contradiction, one card to the left.
--
-- Filtering it client-side after the fetch does not work: .limit(5) is applied
-- by the server, so a client-side filter could only ever shrink an already
-- truncated list -- five old orders in, zero out, even when five new ones
-- exist further down the table. The cutoff has to reach the database as part
-- of the query, which means the page needs to know the epoch before it asks.
--
-- get_sales_overview() is already fetched on that screen, so it is the natural
-- carrier. Adding a column changes the return type, which Postgres will not do
-- through CREATE OR REPLACE -- the function must be dropped first (same
-- constraint hit in 022).
--
-- DROP also discards privileges. The prior grants were EXECUTE to both
-- authenticated and anon (the latter inherited from Postgres' default PUBLIC
-- grant), and they are restored verbatim here. This migration is about the
-- epoch and deliberately does not change who may call the function.

drop function if exists public.get_sales_overview();

create function public.get_sales_overview()
returns table(
  total_orders       bigint,
  total_revenue      numeric,
  orders_today       bigint,
  orders_yesterday   bigint,
  orders_this_month  bigint,
  orders_last_month  bigint,
  revenue_this_month numeric,
  revenue_last_month numeric,
  opened_at          timestamptz
)
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
                                         and sale_date <  date_trunc('month', current_date)::date)), 0),
    (select books_opened_at())
  from s;
$function$;

grant execute on function public.get_sales_overview() to authenticated;
