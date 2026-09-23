-- 051_stagger_after_stock_reset.sql
--
-- Desynchronises the catalogue after 045's stock reset.
--
-- 045 set every product to exactly 30 days of cover, which makes "a month of
-- sales equals the stock on hand" true by construction -- and, as a direct
-- consequence, makes every product cross its reorder point on the same day.
--
-- The arithmetic is unavoidable. Stock is set to 30 x daily_rate, and
-- migration 028 derived each reorder level as roughly 7 x daily_rate plus
-- safety stock. Days until crossing is therefore (30r - 7r) / r, and the rate
-- cancels out: every product, fast or slow, crosses at the same moment.
-- Measured after the reset, all 66 landed between day 21.4 and day 22.0 -- a
-- fourteen-hour window for the entire catalogue.
--
-- That is precisely the failure migration 037 was written to escape, restated:
-- "66 products inside six days ... testing the restock loop is impossible when
-- everything happens at once". 045 reintroduced it by accident, because a
-- uniform rule applied to every product is exactly what synchronises them.
--
-- stagger_inventory_cycle already solves this, so this migration only has to
-- call it. Each product is placed at a random point between its reorder level
-- and 35 days of cover, seeded for reproducibility.
--
-- This does not weaken the demand contract. Monthly volume comes from
-- sim_baseline, never from stock on hand, so scattering the starting positions
-- changes when each product reorders and not how much it sells.

select public.stagger_inventory_cycle(
  p_min_days => 9,
  p_max_days => 35,
  p_seed     => 0.4242
);
