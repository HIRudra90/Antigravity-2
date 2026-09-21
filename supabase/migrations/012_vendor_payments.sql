-- 012_vendor_payments.sql
--
-- Settling a vendor bill stamps restock_orders.paid_at, but nothing treated
-- that as a cash event. Procurement was recognised at ORDER time, so paying
-- moved no figure anywhere: the money left the business and the system said
-- nothing about it.
--
-- This adds the period totals for money actually paid out, plus a feed of
-- individual payments (which vendor, how much, when) so a payment can be
-- pointed at rather than inferred.
--
-- SECURITY INVOKER: RLS on restock_orders keeps both scoped to the tenant.

-- Adding OUT columns changes the row type, which CREATE OR REPLACE cannot do.
drop function if exists public.get_procurement_overview();

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
    count(*) filter (where lower(coalesce(status, '')) not in ('delivered', 'cancelled'))::bigint,
    coalesce(round(sum(total_cost) filter (where paid_at::date = current_date)), 0),
    coalesce(round(sum(total_cost) filter (
      where paid_at >= date_trunc('month', current_date))), 0),
    coalesce(round(sum(total_cost) filter (
      where paid_at >= date_trunc('month', current_date) - interval '1 month'
        and paid_at <  date_trunc('month', current_date))), 0)
  from restock_orders;
$fnbody$;

comment on function public.get_procurement_overview() is
'Procurement totals: committed, paid, outstanding, plus cash actually paid out today / this month / last month.';

-- Individual payment events. The ledger can only show the most recent page of
-- restock_orders; this returns payments specifically, newest first, so a
-- settled bill is findable however long ago the order itself was raised.
create or replace function public.get_vendor_payments(p_limit integer default 50)
returns table (
  order_id    uuid,
  vendor_id   uuid,
  vendor_name text,
  amount      numeric,
  paid_at     timestamptz,
  ordered_at  timestamptz,
  item_label  text,
  item_count  integer
)
language sql
stable
security invoker
set search_path to 'public'
as $fnbody$
  select
    r.id,
    r.vendor_id,
    coalesce(r.vendor_name, 'Vendor'),
    round(coalesce(r.total_cost, 0)),
    r.paid_at,
    r.ordered_at,
    coalesce(r.items->0->>'product_name', 'Purchase order'),
    coalesce(jsonb_array_length(r.items), 0)
  from restock_orders r
  where r.paid_at is not null
  order by r.paid_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 500));
$fnbody$;

comment on function public.get_vendor_payments(integer) is
'Feed of vendor payments actually made: which vendor, how much, when.';

grant execute on function public.get_procurement_overview()        to anon, authenticated;
grant execute on function public.get_vendor_payments(integer)      to anon, authenticated;
