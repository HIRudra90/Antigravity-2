-- 006_backfill_demo_sales.sql
--
-- GENERATED DEMO DATA. These are not real sales.
--
-- The seed data stops on 2026-06-20 while the app runs against today's date,
-- so the forecast chart showed three empty months between the last actual and
-- the forecast window. This fills 2026-06-21 .. current_date so the actual
-- line runs up to the forecast.
--
-- Rather than inventing a distribution, each new date replays the same weekday
-- 84 days (12 weeks) earlier and jitters the quantity +/-. Every target date
-- maps back into 2026-03-29 .. 2026-06-10, which is fully populated, so the
-- product mix, transaction counts and quantity spread all match the real seed.
--
-- ---------------------------------------------------------------------------
-- WHY THE TRIGGER IS DISABLED
-- ---------------------------------------------------------------------------
-- trg_sale_decrement_inventory subtracts every inserted sale from
-- inventory.current_stock. That is right for a live sale, but this is a
-- historical backfill: current stock already reflects where the business is.
-- Letting it fire would subtract roughly 340,000 units and drive every product
-- to zero. It is re-enabled at the end, in the same transaction, so a failure
-- part-way cannot leave it off.
--
-- ---------------------------------------------------------------------------
-- TO UNDO
-- ---------------------------------------------------------------------------
--   delete from public.sales_transactions where id > <max id printed below>;
-- Capture that id first:
--   select max(id) from public.sales_transactions;

begin;

alter table public.sales_transactions disable trigger trg_sale_decrement_inventory;

insert into public.sales_transactions (product_id, sale_date, quantity_sold, on_promotion, owner_id)
select
  src.product_id,
  d::date,
  greatest(1, round(src.quantity_sold * (0.90 + random() * 0.28))::int),
  src.on_promotion,
  src.owner_id
from generate_series(date '2026-06-21', current_date, interval '1 day') d
join lateral (
  select s.product_id, s.quantity_sold, s.on_promotion, s.owner_id
  from public.sales_transactions s
  where s.sale_date = (d::date - 84)
) src on true;

alter table public.sales_transactions enable trigger trg_sale_decrement_inventory;

commit;

-- Verify: every month from Jun onward should now report is_complete = true
-- except the current one, which is only partway through by definition.
--
--   select month_key, days_with_sales, days_in_month, is_complete, revenue
--   from public.get_monthly_sales_coverage(24);
--
-- And confirm stock was untouched:
--   select sum(current_stock) from public.inventory;
