-- 010_realtime_tables.sql
--
-- Only inventory, restock_orders and sales_transactions were published to
-- realtime, so pages watching anything else got no change events and sat on
-- whatever they fetched at mount. Placing an order from the admin panel moved
-- stock and payroll figures that the owner's pages never heard about.
--
-- Adding a table to the publication does not widen access: realtime still
-- applies RLS per subscriber, so an owner only receives rows in their tenant.

do $fnbody$
declare
  t text;
begin
  foreach t in array array['orders', 'salary_payments', 'employees', 'vendors', 'shipments', 'financial_transactions']
  loop
    if to_regclass('public.' || t) is null then
      continue;  -- table not in this environment
    end if;

    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$fnbody$;

-- Realtime sends only the primary key on UPDATE/DELETE unless the table is
-- set to REPLICA IDENTITY FULL. The app only uses events as a "something
-- changed, refetch" signal, so the default is fine and deliberately left
-- alone -- FULL costs WAL volume on every write.
