-- 038_reporting_all_history.sql
--
-- Give the charts their history back.
--
-- 62,338 sales rows covering 264 days (2026-01-01 to 2026-09-21) exist, but
-- get_monthly_revenue(12) returns ONE month. Migration 023 taught these
-- functions the accounting epoch, which was right for the question being asked
-- then ("what have I earned since I opened the books?") and wrong for the one
-- the charts ask ("what does this business look like over time?").
--
-- One cutoff cannot answer both. So the window becomes a parameter:
--
--   p_all_history = false  ->  since books_opened_at()   (accounting)
--   p_all_history = true   ->  every row                 (analytics)
--
-- The default stays false so any caller not updated here keeps the behaviour
-- it has today. Statistics passes true by default -- a page whose entire
-- purpose is trends is useless showing a single day -- and offers a toggle
-- back to the epoch. The money cards on Payment are untouched and remain the
-- accounting truth.
--
-- NOTE: adding a parameter does not replace these functions, it overloads
-- them. Leaving both signatures in place would make every existing one-argument
-- call ambiguous ("function is not unique"), so the old ones are dropped first.
-- DROP also discards privileges, which are restored at the end.

drop function if exists public.get_daily_revenue(integer);
drop function if exists public.get_monthly_revenue(integer);
drop function if exists public.get_top_products(integer);
drop function if exists public.get_category_revenue(integer);

create function public.get_daily_revenue(
  days_back integer default 7,
  p_all_history boolean default false
)
returns table(sale_date date, revenue numeric)
language sql
security definer
set search_path to 'public'
as $function$
  select t.sale_date,
         round(sum(t.quantity_sold::numeric * p.unit_price)) as revenue
    from sales_transactions t
    join products p on p.id = t.product_id
   where t.sale_date >= current_date - days_back
     and (p_all_history or t.created_at >= (select books_opened_at()))
   group by t.sale_date
   order by t.sale_date;
$function$;

create function public.get_monthly_revenue(
  months_back integer default 12,
  p_all_history boolean default false
)
returns table(month_key text, month_start date, revenue numeric, profit numeric, units bigint)
language sql
security definer
set search_path to 'public'
as $function$
  select to_char(date_trunc('month', t.sale_date), 'Mon YYYY') as month_key,
         date_trunc('month', t.sale_date)::date as month_start,
         round(sum(t.quantity_sold::numeric * p.unit_price)) as revenue,
         round(sum(t.quantity_sold::numeric * (p.unit_price - p.unit_cost))) as profit,
         sum(t.quantity_sold) as units
    from sales_transactions t
    join products p on p.id = t.product_id
   where t.sale_date >= current_date - (months_back || ' months')::interval
     and (p_all_history or t.created_at >= (select books_opened_at()))
   group by date_trunc('month', t.sale_date)
   order by date_trunc('month', t.sale_date);
$function$;

create function public.get_top_products(
  months_back integer default 12,
  p_all_history boolean default false
)
returns table(name text, sales bigint)
language sql
security definer
set search_path to 'public'
as $function$
  select p.name::text, sum(t.quantity_sold) as sales
    from sales_transactions t
    join products p on p.id = t.product_id
   where t.sale_date >= current_date - (months_back || ' months')::interval
     and (p_all_history or t.created_at >= (select books_opened_at()))
   group by p.name
   order by sum(t.quantity_sold) desc
   limit 5;
$function$;

create function public.get_category_revenue(
  months_back integer default 12,
  p_all_history boolean default false
)
returns table(family text, revenue numeric)
language sql
security definer
set search_path to 'public'
as $function$
  select p.family::text, round(sum(t.quantity_sold::numeric * p.unit_price)) as revenue
    from sales_transactions t
    join products p on p.id = t.product_id
   where t.sale_date >= current_date - (months_back || ' months')::interval
     and (p_all_history or t.created_at >= (select books_opened_at()))
   group by p.family
   order by sum(t.quantity_sold::numeric * p.unit_price) desc;
$function$;

-- Restored verbatim: these were readable by authenticated and anon before the
-- drop (anon via Postgres' default PUBLIC grant). This migration is about the
-- time window and deliberately does not change who may call them.
grant execute on function public.get_daily_revenue(integer, boolean)     to authenticated;
grant execute on function public.get_monthly_revenue(integer, boolean)   to authenticated;
grant execute on function public.get_top_products(integer, boolean)      to authenticated;
grant execute on function public.get_category_revenue(integer, boolean)  to authenticated;
