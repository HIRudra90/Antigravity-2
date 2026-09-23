-- 058_monthly_cashflow.sql
--
-- Monthly income and expenses, aggregated in Postgres.
--
-- The Payment page's "Monthly Revenue vs Expenses" chart was bucketing the
-- arrays it had already fetched for its transaction list -- sales, shipments
-- and purchase orders, each capped at 200 rows. Six months of history drawn
-- from the most recent 200 sales is roughly a day and a half of trading in the
-- newest bar and nothing at all in the other five.
--
-- This is the same defect that made the Total Revenue card read $225,158
-- against $23.7M of expenses: a page-level display limit being used as an
-- accounting figure. Fixing one and leaving the other would have left the
-- headline number right and the chart beneath it still wrong.
--
-- Deposits and cashouts are excluded on purpose. Money you put into the
-- business is capital, not revenue, and taking it out is not an expense --
-- counting either would flatter or dent the profit line with your own
-- transfers. They still move the cash BALANCE, which is what get_cash_balance
-- reports separately.

create or replace function public.get_monthly_cashflow(p_months integer default 6)
returns table (
  month_start date,
  income      numeric,
  expenses    numeric,
  profit      numeric
)
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select date_trunc('month', cl.created_at)::date                                as month_start,
         round(coalesce(sum(cl.amount) filter (
           where cl.direction = 'in'  and cl.kind <> 'deposit'), 0))             as income,
         round(coalesce(sum(cl.amount) filter (
           where cl.direction = 'out' and cl.kind <> 'cashout'), 0))             as expenses,
         round(coalesce(sum(cl.amount) filter (
           where cl.direction = 'in'  and cl.kind <> 'deposit'), 0)
             - coalesce(sum(cl.amount) filter (
           where cl.direction = 'out' and cl.kind <> 'cashout'), 0))             as profit
    from cash_ledger cl
   where cl.created_at >= date_trunc('month', current_date)
                          - ((greatest(p_months, 1) - 1) || ' months')::interval
     and cl.created_at >= books_opened_at()
   group by date_trunc('month', cl.created_at)
   order by date_trunc('month', cl.created_at);
$fn$;

comment on function public.get_monthly_cashflow(integer) is
'Monthly income vs expenses from the cash ledger. Server-side so the chart cannot be skewed by a page fetch limit. Excludes deposits/cashouts, which are capital rather than trading.';

grant execute on function public.get_monthly_cashflow(integer) to anon, authenticated;
