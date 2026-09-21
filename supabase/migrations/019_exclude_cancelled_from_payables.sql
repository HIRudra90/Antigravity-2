-- 019_exclude_cancelled_from_payables.sql
--
-- A cancelled purchase order is not money owed.
--
-- get_procurement_overview and get_vendor_payment_summary both mentioned
-- 'cancelled', but only in the in_transit count. Every money figure —
-- total_committed, open_orders, outstanding — was computed from
-- `paid_at is null` with no status filter, and a cancelled order is still
-- unpaid forever. So after cancelling the agent's duplicate backlog the
-- Payment page still reported 2,498 open orders and $12,160,827 outstanding
-- against vendors who are owed nothing.
--
-- Filtering at the base relation rather than per-column, so a figure added
-- later cannot silently reintroduce the same leak.

create or replace function public.get_procurement_overview()
returns table (
  total_orders      bigint,
  total_committed   numeric,
  paid_orders       bigint,
  paid_amount       numeric,
  open_orders       bigint,
  outstanding       numeric,
  in_transit_orders bigint,
  paid_today        numeric,
  paid_this_month   numeric,
  paid_last_month   numeric
)
language sql
stable
set search_path to 'public'
as $fnbody$
  with epoch as (select books_opened_at() as t),
  r as (
    select * from restock_orders, epoch
     where ordered_at >= epoch.t
       and lower(coalesce(status, '')) <> 'cancelled'
  )
  select
    count(*)::bigint,
    coalesce(round(sum(total_cost)), 0),
    count(*) filter (where paid_at is not null)::bigint,
    coalesce(round(sum(total_cost) filter (where paid_at is not null)), 0),
    count(*) filter (where paid_at is null)::bigint,
    coalesce(round(sum(total_cost) filter (where paid_at is null)), 0),
    count(*) filter (where lower(coalesce(status, '')) not in ('delivered', 'cancelled'))::bigint,
    coalesce(round(sum(total_cost) filter (where paid_at::date = current_date)), 0),
    coalesce(round(sum(total_cost) filter (where paid_at >= date_trunc('month', current_date))), 0),
    coalesce(round(sum(total_cost) filter (
      where paid_at >= date_trunc('month', current_date) - interval '1 month'
        and paid_at <  date_trunc('month', current_date))), 0)
  from r;
$fnbody$;

create or replace function public.get_vendor_payment_summary()
returns table (
  vendor_id   uuid,
  order_count bigint,
  paid_amount numeric,
  outstanding numeric,
  in_transit  bigint,
  last_order  timestamptz
)
language sql
stable
set search_path to 'public'
as $fnbody$
  select
    r.vendor_id,
    count(*)::bigint,
    coalesce(round(sum(r.total_cost) filter (where r.paid_at is not null)), 0),
    coalesce(round(sum(r.total_cost) filter (where r.paid_at is null)), 0),
    count(*) filter (where lower(coalesce(r.status, '')) not in ('delivered', 'cancelled'))::bigint,
    max(r.ordered_at)
  from restock_orders r
  where r.vendor_id is not null
    and r.ordered_at >= books_opened_at()
    and lower(coalesce(r.status, '')) <> 'cancelled'
  group by r.vendor_id;
$fnbody$;
