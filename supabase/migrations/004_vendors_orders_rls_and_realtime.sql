-- 004_vendors_orders_rls_and_realtime.sql
--
-- Two things, both needed by the dashboard restock button.
--
-- 1. vendors and restock_orders repeat the demand_forecasts problem fixed in
--    003: RLS is enabled but every policy is granted TO anon, and migration
--    002 never covered these tables. Since the app moved behind login the
--    browser queries as `authenticated`, a role with no policy here, so
--    Postgres returns zero rows and rejects writes -- silently, with no error.
--    That leaves the Restock page with an empty vendor list and orders that
--    never save, and it would leave the new dashboard restock button with no
--    vendor to send to.
--
-- 2. Realtime. The supabase_realtime publication is empty, so no postgres_changes
--    event is ever emitted and a .subscribe() on these tables does nothing.
--
-- The anon policies stay -- nothing else is known to depend on them, but
-- removing them is a separate decision from making the app work again.

-- ---------------------------------------------------------------------------
-- 1. Tenant columns
-- ---------------------------------------------------------------------------
alter table public.vendors
  add column if not exists owner_id uuid references public.owners(id) on delete cascade;
alter table public.restock_orders
  add column if not exists owner_id uuid references public.owners(id) on delete cascade;

-- Vendors predate multi-tenancy and carry no owner hint, so they go to the
-- seed owner -- the same backfill target migration 002 used for products.
update public.vendors
   set owner_id = (select id from public.owners order by created_at limit 1)
 where owner_id is null;

-- An order belongs to whoever owns the vendor it was sent to.
update public.restock_orders o
   set owner_id = v.owner_id
  from public.vendors v
 where v.id = o.vendor_id
   and o.owner_id is null;

update public.restock_orders
   set owner_id = (select id from public.owners order by created_at limit 1)
 where owner_id is null;

create index if not exists vendors_owner_id_idx        on public.vendors(owner_id);
create index if not exists restock_orders_owner_id_idx on public.restock_orders(owner_id);

-- ---------------------------------------------------------------------------
-- 2. Keep owner_id filled on insert
-- ---------------------------------------------------------------------------
create or replace function public.set_owner_from_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $fnbody$
begin
  if new.owner_id is null then
    new.owner_id := public.current_owner_id();
  end if;
  -- An admin has no owner_id of their own; fall back to the vendor's owner.
  if new.owner_id is null and to_jsonb(new) ? 'vendor_id' then
    select v.owner_id into new.owner_id from public.vendors v where v.id = new.vendor_id;
  end if;
  if new.owner_id is null then
    select id into new.owner_id from public.owners order by created_at limit 1;
  end if;
  return new;
end;
$fnbody$;

drop trigger if exists trg_vendors_set_owner on public.vendors;
create trigger trg_vendors_set_owner
  before insert on public.vendors
  for each row execute function public.set_owner_from_session();

drop trigger if exists trg_restock_orders_set_owner on public.restock_orders;
create trigger trg_restock_orders_set_owner
  before insert on public.restock_orders
  for each row execute function public.set_owner_from_session();

-- ---------------------------------------------------------------------------
-- 3. Policies for authenticated (same shape as the 002 tenant tables)
-- ---------------------------------------------------------------------------
do $policies$
declare t text;
begin
  foreach t in array array['vendors', 'restock_orders'] loop
    execute format('drop policy if exists %I_tenant_select on public.%I', t, t);
    execute format($p$
      create policy %I_tenant_select on public.%I for select to authenticated
      using (public.current_role_is_admin() or owner_id = public.current_owner_id())
    $p$, t, t);

    execute format('drop policy if exists %I_tenant_write on public.%I', t, t);
    execute format($p$
      create policy %I_tenant_write on public.%I for all to authenticated
      using (public.current_role_is_admin() or owner_id = public.current_owner_id())
      with check (public.current_role_is_admin() or owner_id = public.current_owner_id())
    $p$, t, t);
  end loop;
end
$policies$;

-- ---------------------------------------------------------------------------
-- 4. Realtime
-- ---------------------------------------------------------------------------
-- postgres_changes still evaluates RLS per subscriber, so adding a table here
-- does not widen who can read it.
do $realtime$
declare t text;
begin
  foreach t in array array['inventory', 'sales_transactions', 'restock_orders'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$realtime$;

-- Realtime sends only the primary key on UPDATE/DELETE unless the replica
-- identity is full. The dashboard refetches rather than reading the payload,
-- so the default is fine and is left alone deliberately.
