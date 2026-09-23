-- 053_rebuild_revenue_ledger.sql
--
-- Reconnects the cash ledger to the sales that actually exist.
--
-- Migration 046 rebuilt a year of sales history with trg_cash_sale disabled,
-- deliberately, so the backfill could not disturb the vendor-payment side.
-- The cost of that decision is visible on the Payment page: the ledger still
-- holds 3,259 revenue rows belonging to the sales that 046 deleted, and holds
-- nothing at all for the 51,216 rows it wrote. Cash revenue and reported
-- revenue were describing two different businesses.
--
-- Three parts.
--
-- 1. The accounting epoch moves back to the start of the history.
--
--    books_opened_at was 2026-09-21, two days ago. Every money figure on the
--    Payment page is scoped to it, and unlike Statistics that page has no
--    all-history toggle -- so a year of correct history would still have
--    rendered as two days. The books now open where the business's recorded
--    history opens.
--
-- 2. Orphaned revenue rows are removed.
--
--    Only the orphans. Rows written by the live tick point at sales that do
--    exist and are left alone, so this stays correct however many ticks have
--    run before it.
--
-- 3. One revenue row per trading day replaces them.
--
--    Per-day rather than per-sale: 388 rows instead of 51,216, matching the
--    granularity the charts already draw, and leaving the ledger's recent
--    -movements list readable. Keyed on the date through the existing
--    (source_type, source_id) unique index, so re-running cannot double up.
--
--    Each day's row is NET of anything the live trigger already recorded for
--    that day. Without that subtraction, today would be counted twice -- once
--    per sale by trg_cash_sale, once in the daily total here.

-- ---------------------------------------------------------------------------
-- 1. Epoch
-- ---------------------------------------------------------------------------
update app_settings
   set setting_value = '2025-09-01 00:00:00+00'
 where setting_key = 'books_opened_at';

insert into app_settings (setting_key, setting_value)
select 'books_opened_at', '2025-09-01 00:00:00+00'
 where not exists (select 1 from app_settings where setting_key = 'books_opened_at');

-- ---------------------------------------------------------------------------
-- 2. Drop revenue rows whose sale no longer exists
-- ---------------------------------------------------------------------------
delete from cash_ledger cl
 where cl.kind = 'revenue'
   and cl.source_type = 'sale'
   and not exists (
     select 1 from sales_transactions s where s.id::text = cl.source_id
   );

-- ---------------------------------------------------------------------------
-- 3. One row per trading day, net of what the live trigger already booked
-- ---------------------------------------------------------------------------
with day_total as (
  select t.sale_date,
         round(sum(t.quantity_sold * p.unit_price)) as gross
    from sales_transactions t
    join products p on p.id = t.product_id
   group by t.sale_date
),
already as (
  -- What trg_cash_sale has already recorded, resolved back to the sale's date.
  select s.sale_date, round(sum(cl.amount)) as booked
    from cash_ledger cl
    join sales_transactions s on s.id::text = cl.source_id
   where cl.kind = 'revenue' and cl.source_type = 'sale'
   group by s.sale_date
),
owner as (
  select owner_id from products where owner_id is not null limit 1
)
insert into cash_ledger (owner_id, direction, kind, amount, description, source_type, source_id, created_at)
select (select owner_id from owner),
       'in', 'revenue',
       d.gross - coalesce(a.booked, 0),
       'Sales — ' || to_char(d.sale_date, 'DD Mon YYYY'),
       'sales_day',
       d.sale_date::text,
       -- Dated to the trading day, not to now(). The monthly cash-flow chart
       -- buckets on created_at, so stamping these with the migration time
       -- would pile a year of revenue onto today.
       (d.sale_date + time '18:00')::timestamptz
  from day_total d
  left join already a on a.sale_date = d.sale_date
 where d.gross - coalesce(a.booked, 0) > 0
-- cash_ledger_source_idx is a PARTIAL unique index (migration 020 excludes
-- rows with a null source). ON CONFLICT has to repeat that predicate or
-- Postgres cannot match it to an index and raises 42P10.
on conflict (source_type, source_id) where source_type is not null and source_id is not null
do nothing;
