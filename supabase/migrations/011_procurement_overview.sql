-- 011_procurement_overview.sql
--
-- The Payment page fetches restock_orders with .limit(200), but there are
-- 1,323 of them. Procurement spend, and therefore every expense and profit
-- figure derived from it, was being summed over a sixth of the table.
--
-- It also had no concept of an unpaid bill: 1,295 open purchase orders worth
-- $40.7M existed with nothing on screen showing them, so confirming a delivery
-- (which stamps paid_at) changed a status badge and nothing else. Outstanding
-- is what makes a vendor payment visible.
--
-- Two functions: totals for the KPI strip, and a per-vendor roll-up so the
-- vendor cards stop deriving their numbers from a truncated list.
--
-- SECURITY INVOKER so RLS on restock_orders scopes both to the caller's tenant.

create or replace function public.get_procurement_overview()
returns table (
  total_orders      bigint,
  total_committed   numeric,
  paid_orders       bigint,
  paid_amount       numeric,
  open_orders       bigint,
  outstanding       numeric,
  in_transit_orders bigint
)
language sql
stable
security invoker
set search_path to 'public'
as $fnbody$
  select
    count(*)::bigint,
    coalesce(round(sum(total_cost)), 0),
    count(*) filter (where paid_at is not null)::bigint,
    coalesce(round(sum(total_cost) filter (where paid_at is not null)), 0),
    count(*) filter (where paid_at is null)::bigint,
    coalesce(round(sum(total_cost) filter (where paid_at is null)), 0),
    count(*) filter (where lower(coalesce(status, '')) not in ('delivered', 'cancelled'))::bigint
  from restock_orders;
$fnbody$;

comment on function public.get_procurement_overview() is
'Exact procurement totals including outstanding (unpaid) vendor bills. Replaces client-side sums over a 200-row page of restock_orders.';

-- Per-vendor roll-up. The cards used to filter an already-truncated list, so a
-- vendor whose orders fell outside the fetched page showed zero.
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
security invoker
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
  group by r.vendor_id;
$fnbody$;

comment on function public.get_vendor_payment_summary() is
'Per-vendor order count, paid total, outstanding balance and in-transit count.';

grant execute on function public.get_procurement_overview()   to anon, authenticated;
grant execute on function public.get_vendor_payment_summary() to anon, authenticated;
