-- 022_cash_month_flow.sql
--
-- Real monthly cash flow.
--
-- The Payment page's "Monthly Cash Flow" card was computing
--     cashFlow = totalRevenue * 0.13
-- and labelling it "+7.8%", a hardcoded string. Neither number described
-- anything: 13% of revenue is not cash flow, and the percentage never moved
-- whatever happened. With a real cash ledger in place there is an actual
-- figure to show — money in minus money out for the current calendar month.
--
-- Returned alongside the existing balance fields so the card costs no extra
-- round trip.

create or replace function public.get_cash_balance()
returns table (
  balance      numeric,
  total_in     numeric,
  total_out    numeric,
  deposits     numeric,
  cashouts     numeric,
  revenue      numeric,
  spending     numeric,
  movements    bigint,
  opened_at    timestamptz,
  month_in     numeric,
  month_out    numeric,
  month_net    numeric,
  prev_month_net numeric
)
language sql
stable
set search_path to 'public'
as $fnbody$
  with e as (select books_opened_at() as t),
  l as (select * from cash_ledger, e where cash_ledger.created_at >= e.t),
  m as (
    select
      coalesce(round(sum(amount) filter (
        where direction = 'in' and created_at >= date_trunc('month', current_date))), 0) as m_in,
      coalesce(round(sum(amount) filter (
        where direction = 'out' and created_at >= date_trunc('month', current_date))), 0) as m_out,
      coalesce(round(sum(case when direction = 'in' then amount else -amount end) filter (
        where created_at >= date_trunc('month', current_date) - interval '1 month'
          and created_at <  date_trunc('month', current_date))), 0) as prev_net
    from l
  )
  select
    coalesce(round(sum(case when direction = 'in' then amount else -amount end)), 0),
    coalesce(round(sum(amount) filter (where direction = 'in')), 0),
    coalesce(round(sum(amount) filter (where direction = 'out')), 0),
    coalesce(round(sum(amount) filter (where kind = 'deposit')), 0),
    coalesce(round(sum(amount) filter (where kind = 'cashout')), 0),
    coalesce(round(sum(amount) filter (where kind = 'revenue')), 0),
    coalesce(round(sum(amount) filter (where direction = 'out' and kind <> 'cashout')), 0),
    count(*)::bigint,
    (select t from e),
    (select m_in from m),
    (select m_out from m),
    (select m_in - m_out from m),
    (select prev_net from m)
  from l;
$fnbody$;

grant execute on function public.get_cash_balance() to authenticated;
