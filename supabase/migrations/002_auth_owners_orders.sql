-- ============================================================================
--  002_auth_owners_orders.sql
--  Adds authentication roles, multi-owner tenancy, and admin-placed orders.
--
--  Run this in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
--  It is idempotent: safe to run more than once.
--
--  What it creates
--    owners    - one row per business using the system
--    profiles  - maps a Supabase Auth user to a role (admin | owner)
--    orders    - orders an admin places on behalf of an owner
--
--  What it alters
--    products, inventory, sales_transactions gain owner_id, backfilled to the
--    existing business so no current data is orphaned.
--
--  Rollback is at the bottom of this file, commented out.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. OWNERS
-- ---------------------------------------------------------------------------
create table if not exists public.owners (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  company     text,
  email       text unique,
  phone       text,
  status      text not null default 'Active'
              check (status in ('Active', 'Suspended')),
  created_at  timestamptz not null default now()
);

comment on table public.owners is
  'A business tenant. Products, inventory and sales are scoped to one owner.';

-- Seed the business that already exists in this database. Named explicitly so
-- the backfill below is deterministic and re-running changes nothing.
insert into public.owners (name, company, email)
values ('Hasidul Islam', 'Inventiq', 'hirudra23@gmail.com')
on conflict (email) do nothing;

-- ---------------------------------------------------------------------------
-- 2. PROFILES  (role for each authenticated user)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  role        text not null default 'owner'
              check (role in ('admin', 'owner')),
  -- Which business this user operates. NULL for admins, who span all owners.
  owner_id    uuid references public.owners(id) on delete set null,
  created_at  timestamptz not null default now()
);

comment on column public.profiles.owner_id is
  'The owner this user operates. NULL for admins, who see every owner.';

-- Create a profile automatically whenever someone signs up.
--
-- Role is ALWAYS 'owner' here and is deliberately NOT read from signup
-- metadata: metadata is attacker-controlled, so trusting it would let anyone
-- self-register as an admin. Promoting an admin is an explicit SQL step —
-- see the bootstrap block at the end of this file.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, owner_id)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    'owner',
    null
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper used by the RLS policies below. SECURITY DEFINER so a policy can read
-- profiles without recursing into profiles' own RLS.
create or replace function public.current_role_is_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.current_owner_id()
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select owner_id from public.profiles where id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- 3. TENANCY COLUMNS  (added, then backfilled — no data is orphaned)
-- ---------------------------------------------------------------------------
alter table public.products           add column if not exists owner_id uuid references public.owners(id) on delete cascade;
alter table public.inventory          add column if not exists owner_id uuid references public.owners(id) on delete cascade;
alter table public.sales_transactions add column if not exists owner_id uuid references public.owners(id) on delete cascade;

-- Backfill every pre-existing row to the seeded business.
do $$
declare
  seed_owner uuid;
begin
  select id into seed_owner from public.owners where email = 'hirudra23@gmail.com';

  if seed_owner is not null then
    update public.products           set owner_id = seed_owner where owner_id is null;
    update public.inventory          set owner_id = seed_owner where owner_id is null;
    update public.sales_transactions set owner_id = seed_owner where owner_id is null;
  end if;
end $$;

create index if not exists products_owner_id_idx           on public.products(owner_id);
create index if not exists inventory_owner_id_idx          on public.inventory(owner_id);
create index if not exists sales_transactions_owner_id_idx on public.sales_transactions(owner_id);
create index if not exists sales_transactions_sale_date_idx on public.sales_transactions(sale_date desc);

-- ---------------------------------------------------------------------------
-- 4. ORDERS  (an admin placing stock on behalf of an owner)
-- ---------------------------------------------------------------------------
create table if not exists public.orders (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references public.owners(id) on delete cascade,
  product_id     bigint not null references public.products(id) on delete cascade,
  product_name   text not null,
  family         text,
  quantity       integer not null check (quantity > 0),
  unit_price     numeric(12,2) not null default 0,
  total_amount   numeric(14,2) not null default 0,
  status         text not null default 'Completed'
                 check (status in ('Completed', 'Pending', 'Cancelled')),
  -- Audit: which admin placed this, and the sale row it produced.
  placed_by      uuid references auth.users(id) on delete set null,
  placed_by_email text,
  sale_id        bigint references public.sales_transactions(id) on delete set null,
  note           text,
  created_at     timestamptz not null default now()
);

comment on table public.orders is
  'Orders an admin places for an owner. Each one also writes a sales_transactions row, so it counts as a sale on the owner dashboard.';

create index if not exists orders_owner_id_idx   on public.orders(owner_id);
create index if not exists orders_created_at_idx on public.orders(created_at desc);

-- ---------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
--    Owners are confined to their own rows by the database, not by the client.
-- ---------------------------------------------------------------------------
alter table public.owners             enable row level security;
alter table public.profiles           enable row level security;
alter table public.orders             enable row level security;
alter table public.products           enable row level security;
alter table public.inventory          enable row level security;
alter table public.sales_transactions enable row level security;

-- profiles: you can always read your own row; admins read all.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.current_role_is_admin());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- owners: an owner sees only their own business; an admin sees every business.
drop policy if exists owners_select on public.owners;
create policy owners_select on public.owners for select to authenticated
  using (public.current_role_is_admin() or id = public.current_owner_id());

drop policy if exists owners_admin_write on public.owners;
create policy owners_admin_write on public.owners for all to authenticated
  using (public.current_role_is_admin()) with check (public.current_role_is_admin());

-- Tenant tables: identical shape for products / inventory / sales_transactions.
do $$
declare
  t text;
begin
  foreach t in array array['products', 'inventory', 'sales_transactions'] loop
    execute format('drop policy if exists %I_tenant_select on public.%I', t, t);
    execute format($f$
      create policy %I_tenant_select on public.%I for select to authenticated
      using (public.current_role_is_admin() or owner_id = public.current_owner_id())
    $f$, t, t);

    execute format('drop policy if exists %I_tenant_write on public.%I', t, t);
    execute format($f$
      create policy %I_tenant_write on public.%I for all to authenticated
      using (public.current_role_is_admin() or owner_id = public.current_owner_id())
      with check (public.current_role_is_admin() or owner_id = public.current_owner_id())
    $f$, t, t);
  end loop;
end $$;

-- orders: owners read theirs, only admins create them.
drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders for select to authenticated
  using (public.current_role_is_admin() or owner_id = public.current_owner_id());

drop policy if exists orders_admin_write on public.orders;
create policy orders_admin_write on public.orders for all to authenticated
  using (public.current_role_is_admin()) with check (public.current_role_is_admin());

-- ---------------------------------------------------------------------------
-- 6. PLACE ORDER  (atomic: order + sale + stock decrement in one transaction)
--    A partial write here would corrupt the owner's dashboard, so all three
--    effects happen together or none do.
-- ---------------------------------------------------------------------------
create or replace function public.place_owner_order(
  p_owner_id   uuid,
  p_product_id bigint,
  p_quantity   integer,
  p_note       text default null
)
returns public.orders
language plpgsql
security definer set search_path = public
as $$
declare
  v_product   public.products%rowtype;
  v_stock     integer;
  v_sale_id   bigint;
  v_order     public.orders%rowtype;
  v_email     text;
begin
  if not public.current_role_is_admin() then
    raise exception 'Only an admin can place orders for an owner';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be greater than zero';
  end if;

  select * into v_product from public.products
   where id = p_product_id and owner_id = p_owner_id;
  if not found then
    raise exception 'Product % does not belong to owner %', p_product_id, p_owner_id;
  end if;

  select current_stock into v_stock from public.inventory
   where product_id = p_product_id and owner_id = p_owner_id
   for update;

  if v_stock is null then
    raise exception 'No inventory row for product %', p_product_id;
  end if;

  if v_stock < p_quantity then
    raise exception 'Insufficient stock: % available, % requested', v_stock, p_quantity;
  end if;

  -- 1. The sale the owner dashboard reads.
  --
  -- This INSERT is the only thing that touches stock. The pre-existing
  -- trigger trg_sale_decrement_inventory on sales_transactions already does
  -- `current_stock = GREATEST(0, current_stock - NEW.quantity_sold)`, so
  -- decrementing again here would take the stock down twice per order.
  insert into public.sales_transactions
    (product_id, sale_date, quantity_sold, on_promotion, owner_id)
  values
    (p_product_id, current_date, p_quantity, false, p_owner_id)
  returning id into v_sale_id;

  -- 2. The admin audit trail.
  select email into v_email from auth.users where id = auth.uid();

  insert into public.orders (
    owner_id, product_id, product_name, family, quantity,
    unit_price, total_amount, status, placed_by, placed_by_email, sale_id, note
  ) values (
    p_owner_id, p_product_id, v_product.name, v_product.family, p_quantity,
    coalesce(v_product.unit_price, 0),
    coalesce(v_product.unit_price, 0) * p_quantity,
    'Completed', auth.uid(), v_email, v_sale_id, p_note
  )
  returning * into v_order;

  return v_order;
end;
$$;

revoke all on function public.place_owner_order(uuid, bigint, integer, text) from public;
grant execute on function public.place_owner_order(uuid, bigint, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. OWNER SUMMARY  (drives the admin "who is using the system" list)
-- ---------------------------------------------------------------------------
create or replace view public.owner_summary as
select
  o.id,
  o.name,
  o.company,
  o.email,
  o.status,
  o.created_at,
  (select count(*)            from public.products p  where p.owner_id = o.id) as product_count,
  (select count(distinct p.family) from public.products p where p.owner_id = o.id) as category_count,
  (select coalesce(sum(i.current_stock), 0) from public.inventory i where i.owner_id = o.id) as total_stock,
  (select count(*)            from public.orders  r  where r.owner_id = o.id) as order_count,
  (select coalesce(sum(s.quantity_sold), 0) from public.sales_transactions s where s.owner_id = o.id) as units_sold
from public.owners o;

grant select on public.owner_summary to authenticated;

-- ============================================================================
--  8. BOOTSTRAP  —  run AFTER creating your two users
--
--  Create the users first (Dashboard -> Authentication -> Users -> Add user,
--  with "Auto Confirm" ticked), then run the two statements below with your
--  real email addresses. The signup trigger makes everyone an 'owner'; this is
--  the deliberate, manual step that grants admin.
-- ============================================================================

-- Create these two users first (Auto Confirm ticked):
--   hirudra23@gmail.com  -> admin
--   hirudra90@gmail.com  -> owner
--
-- Then run this block. It is safe to re-run.

-- Promote the admin (sees every owner, places orders, has no owner_id):
update public.profiles
   set role = 'admin', owner_id = null
 where email = 'hirudra23@gmail.com';

-- Attach the owner account to the seeded business.
-- Note: the business row's contact email is hirudra23@gmail.com (it predates
-- these logins); the owner who signs in is hirudra90@gmail.com. Different
-- tables, no conflict.
update public.profiles
   set role = 'owner',
       owner_id = (select id from public.owners order by created_at limit 1)
 where email = 'hirudra90@gmail.com';

-- Verify both landed correctly — expect exactly two rows:
--   hirudra23@gmail.com | admin | (null)
--   hirudra90@gmail.com | owner | Inventiq
--   select p.email, p.role, o.company
--     from public.profiles p
--     left join public.owners o on o.id = p.owner_id
--    order by p.role;

-- ============================================================================
--  ROLLBACK  (uncomment and run to undo everything above)
-- ============================================================================
-- drop view if exists public.owner_summary;
-- drop function if exists public.place_owner_order(uuid, bigint, integer, text);
-- drop table if exists public.orders;
-- alter table public.products           drop column if exists owner_id;
-- alter table public.inventory          drop column if exists owner_id;
-- alter table public.sales_transactions drop column if exists owner_id;
-- drop trigger if exists on_auth_user_created on auth.users;
-- drop function if exists public.handle_new_user();
-- drop function if exists public.current_role_is_admin();
-- drop function if exists public.current_owner_id();
-- drop table if exists public.profiles;
-- drop table if exists public.owners;
-- alter table public.products           disable row level security;
-- alter table public.inventory          disable row level security;
-- alter table public.sales_transactions disable row level security;
