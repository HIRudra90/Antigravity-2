-- 032_shipments_authenticated_rls.sql
--
-- Booking a shipment appeared to work and then vanished: the Logistics cards
-- stayed at 0 / 0 / RM 0.00 / 0 no matter how many were placed.
--
-- public.shipments had RLS enabled with exactly one policy:
--
--     anon_all   FOR ALL   TO anon   USING (true) WITH CHECK (true)
--
-- granted to `anon` alone. A signed-in session runs as `authenticated`, which
-- had no policy at all, and RLS denies by default. So for the actual user of
-- the app both directions failed:
--
--   SELECT  -> 0 rows, no error   (the four dashboard cards read zero, even
--                                  though a shipment from June was sitting in
--                                  the table)
--   INSERT  -> rejected           (the booking was never recorded)
--
-- The insert failure was the damaging half. Logistics.tsx called
-- `await supabase.from('shipments').insert(...)` without checking the returned
-- error and then reported "Booked!", so the courier order was really created
-- at Delyva while nothing was saved locally — a real shipment with no record
-- of it anywhere in the system. That call now checks its error; this migration
-- removes the reason it was failing.
--
-- Replaced rather than added to: keeping `anon_all` alongside a second pair
-- would leave two overlapping grants describing the same intent, and the next
-- person reading it could not tell which one was load-bearing. The shape here
-- matches notifications, reminders and cash_ledger.

drop policy if exists anon_all on public.shipments;

drop policy if exists shipments_read on public.shipments;
create policy shipments_read on public.shipments
  for select to authenticated, anon using (true);

drop policy if exists shipments_write on public.shipments;
create policy shipments_write on public.shipments
  for all to authenticated, anon using (true) with check (true);
