-- 059_align_procurement_to_calendar.sql
--
-- Regenerates procurement on calendar-aligned half-months.
--
-- 054 used a rolling 14-day window from 2025-09-01 with settlement 7 days
-- later. Fourteen days does not divide a month, so the settlement dates drift:
-- some months collected three payment runs and others two, and because each
-- run is ~$8M the monthly margin swung between 4.5% and 45% on a business
-- whose underlying economics never changed. Dec 2025 showed 17%, Jun 2026
-- 14.5%, against ~44% either side of them.
--
-- The annual total was right -- procurement came to exactly 60% of revenue --
-- but "expenses lower than revenue" is not much use if the monthly chart still
-- lurches. Lumpiness that comes from an arithmetic artifact rather than from
-- trading is noise.
--
-- Windows now start on the 1st and the 16th of each month and settle on the
-- 8th and the 23rd, so every month contains exactly two settlement runs and
-- each run pays for goods sold in that same month.
--
-- Only the generated history is replaced. The 35 real Pending orders and the
-- payroll and shipping rows from 056 are untouched.

do $mig$
declare
  v_owner   uuid;
  v_orders  integer := 0;
begin
  select owner_id into v_owner from products where owner_id is not null limit 1;

  -- Remove only what 054 generated. Its orders are recognisable by their note.
  delete from cash_ledger
   where source_type = 'restock_order'
     and source_id in (
       select id::text from restock_orders where notes like 'Replenishment for %'
     );
  delete from restock_orders where notes like 'Replenishment for %';

  execute 'alter table public.restock_orders disable trigger trg_reserve_on_order';
  execute 'alter table public.restock_orders disable trigger trg_notify_purchase_order';

  with windows as (
    select win_start,
           least(
             case when extract(day from win_start) = 1
                  then (date_trunc('month', win_start) + interval '14 days')::date
                  else (date_trunc('month', win_start) + interval '1 month - 1 day')::date
             end,
             current_date
           ) as win_end,
           -- Settlement inside the same month, always.
           case when extract(day from win_start) = 1
                then (date_trunc('month', win_start) + interval '7 days')::date
                else (date_trunc('month', win_start) + interval '22 days')::date
           end as settle_on
      from (
        select generate_series(date '2025-09-01', current_date, interval '1 month')::date as win_start
        union all
        select (generate_series(date '2025-09-01', current_date, interval '1 month')::date + 15)
      ) g(win_start)
     where win_start <= current_date
  ),
  sold as (
    select w.win_start, w.settle_on, t.product_id, sum(t.quantity_sold)::int as qty
      from windows w
      join sales_transactions t on t.sale_date between w.win_start and w.win_end
     group by w.win_start, w.settle_on, t.product_id
    having sum(t.quantity_sold) > 0
  ),
  vendor_pick as (
    select distinct on (upper(trim(v.category)))
           upper(trim(v.category)) as cat, v.id, v.company, v.email
      from vendors v
     where v.status = 'Active'
     order by upper(trim(v.category)), v.lead_time_days asc, v.id
  ),
  priced as (
    select s.*, p.name, p.family, round(p.unit_price * 0.6, 2) as unit_cost,
           vp.id as vendor_id, vp.company, vp.email
      from sold s
      join products p on p.id = s.product_id
      left join vendor_pick vp on vp.cat = upper(trim(p.family))
  ),
  ins as (
    insert into restock_orders
      (vendor_id, vendor_name, vendor_email, items, total_cost, status, notes,
       expected_delivery, ordered_at, paid_at, owner_id)
    select pr.vendor_id,
           coalesce(pr.company, 'Auto-Assign'),
           pr.email,
           jsonb_build_array(jsonb_build_object(
             'product_name', pr.name,
             'sku', 'SKU-' || (1000 + pr.product_id)::text,
             'quantity', pr.qty,
             'unit_cost', pr.unit_cost
           )),
           round(pr.qty * pr.unit_cost),
           'Delivered',
           'Replenishment for ' || to_char(pr.win_start, 'DD Mon YYYY'),
           pr.settle_on,
           (pr.win_start + time '09:00')::timestamptz,
           (pr.settle_on + time '09:00')::timestamptz,
           v_owner
      from priced pr
     where pr.qty > 0 and pr.vendor_id is not null
    returning id, total_cost, paid_at, vendor_name, owner_id
  )
  insert into cash_ledger (owner_id, direction, kind, amount, description, source_type, source_id, created_at)
  select i.owner_id, 'out', 'procurement', i.total_cost,
         'Purchase order to ' || i.vendor_name,
         'restock_order', i.id::text, i.paid_at
    from ins i where i.total_cost > 0;

  get diagnostics v_orders = row_count;

  execute 'alter table public.restock_orders enable trigger trg_reserve_on_order';
  execute 'alter table public.restock_orders enable trigger trg_notify_purchase_order';

  raise notice 'regenerated % procurement orders', v_orders;

exception when others then
  execute 'alter table public.restock_orders enable trigger trg_reserve_on_order';
  execute 'alter table public.restock_orders enable trigger trg_notify_purchase_order';
  raise;
end
$mig$;
