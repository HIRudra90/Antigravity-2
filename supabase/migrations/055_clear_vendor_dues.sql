-- 055_clear_vendor_dues.sql
--
-- Settles every outstanding vendor bill.
--
-- Paid, not delivered. The distinction matters: the 35 remaining Pending
-- orders hold the on_order reservations for 59,535 units still in transit, and
-- marking them Delivered would fire trg_receive_restock_order and credit all
-- of it into current_stock as though a year of deliveries had just landed on
-- the shelf. Paying a bill does not make the lorry arrive.
--
-- pay_vendor_dues() is the system's own settlement path -- the same one the
-- "Pay All Due" button calls -- so this goes through it per vendor rather than
-- updating paid_at by hand. That keeps one definition of what "settled" means,
-- and lets trg_cash_vendor_payment write the cash_ledger rows exactly as it
-- would for a human clicking the button.

do $mig$
declare
  v           record;
  v_result    jsonb;
  v_vendors   integer := 0;
  v_total     numeric := 0;
begin
  for v in
    select distinct r.vendor_id
      from restock_orders r
     where r.paid_at is null
       and lower(coalesce(r.status, '')) <> 'cancelled'
       and r.vendor_id is not null
  loop
    v_result := public.pay_vendor_dues(v.vendor_id);
    v_vendors := v_vendors + 1;
    v_total := v_total + coalesce((v_result ->> 'paid_amount')::numeric, 0);
  end loop;

  raise notice 'settled % vendors, % total', v_vendors, v_total;
end
$mig$;
