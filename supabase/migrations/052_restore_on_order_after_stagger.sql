-- 052_restore_on_order_after_stagger.sql
--
-- Puts back the on_order reservations that 051 destroyed.
--
-- stagger_inventory_cycle sets on_order = 0 outright. That is correct for what
-- it was written to be -- a reshuffle that resets the shop to a clean scattered
-- state before a test run, where any in-flight orders are part of the state
-- being discarded. It is wrong when the goal is only to desynchronise the
-- cycle, which is all 051 wanted, because the restock_orders rows survive and
-- the reservations do not.
--
-- The result was 37 Pending orders worth ~$13M with nothing reserved against
-- them. That is precisely the condition migration 033 exists to prevent: the
-- Restock queue and the restock agent both test
--
--     current_stock + on_order <= reorder_level
--
-- and with on_order at zero those 37 products read as far less covered than
-- they are, so the agent would order them a second time while the first
-- shipment was still in transit. Delivery would then credit stock against a
-- reservation that was never held.
--
-- adjust_inventory_for_order already knows how to read an order's items jsonb
-- and move the right products, so this only has to replay the reserve half
-- (stock_mult 0, onorder_mult +1) for orders still outstanding.
--
-- Deliberately Pending only: Delivered orders already became current_stock,
-- and Cancelled ones released their reservation on purpose. Re-reserving
-- either would invent stock.

do $mig$
declare
  r         record;
  v_orders  integer := 0;
begin
  for r in
    select items, owner_id from restock_orders where status = 'Pending'
  loop
    perform adjust_inventory_for_order(r.items, r.owner_id, 0, 1);
    v_orders := v_orders + 1;
  end loop;

  raise notice 'restored on_order reservations for % pending orders', v_orders;
end
$mig$;
