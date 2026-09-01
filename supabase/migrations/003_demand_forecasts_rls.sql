-- 003_demand_forecasts_rls.sql
--
-- Fixes: every AI panel (XGBoost "0 live", sentiment "x1.000", PPO 0/0/0,
-- Live Pipeline Coverage 0%) renders zero for a signed-in user.
--
-- Cause: demand_forecasts has RLS enabled but migration 002 never gave it
-- policies. Its only policies (allow_select / allow_insert / allow_delete)
-- are granted TO anon. Once the app moved behind login, the browser started
-- sending a user JWT, so queries run as `authenticated` -- a role with no
-- policy on this table, which Postgres answers with zero rows and no error.
-- fetchDashboardIntelligence() then takes its `allForecasts.length === 0`
-- early return and leaves every panel at its initial state.
--
-- products / inventory / sales_transactions were given `authenticated`
-- policies by 002, which is why 66 products still load while 0 forecasts do.
--
-- The anon policies stay: the FastAPI backend logs predictions through
-- Supabase REST with the anon key (app/services/supabase_service.py).

-- ---------------------------------------------------------------------------
-- 1. Tenant column
-- ---------------------------------------------------------------------------
-- product_id is text here while products.id is bigint, so the join casts.
alter table public.demand_forecasts
  add column if not exists owner_id uuid references public.owners(id) on delete cascade;

update public.demand_forecasts df
   set owner_id = p.owner_id
  from public.products p
 where p.id::text = df.product_id
   and df.owner_id is null;

create index if not exists demand_forecasts_owner_id_idx   on public.demand_forecasts(owner_id);
create index if not exists demand_forecasts_product_id_idx on public.demand_forecasts(product_id);
create index if not exists demand_forecasts_predicted_at_idx on public.demand_forecasts(predicted_at desc);

-- ---------------------------------------------------------------------------
-- 2. Keep owner_id filled on insert
-- ---------------------------------------------------------------------------
-- The backend posts with the anon key and has no idea which owner a product
-- belongs to, so it never sends owner_id. Without this trigger every new row
-- would land with owner_id null and be invisible to the owner that caused it.
create or replace function public.demand_forecasts_set_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $fnbody$
begin
  if new.owner_id is null then
    select p.owner_id into new.owner_id
      from public.products p
     where p.id::text = new.product_id;
  end if;
  return new;
end;
$fnbody$;

drop trigger if exists trg_demand_forecasts_set_owner on public.demand_forecasts;
create trigger trg_demand_forecasts_set_owner
  before insert on public.demand_forecasts
  for each row execute function public.demand_forecasts_set_owner();

-- ---------------------------------------------------------------------------
-- 3. Policies for authenticated (same shape as the 002 tenant tables)
-- ---------------------------------------------------------------------------
drop policy if exists demand_forecasts_tenant_select on public.demand_forecasts;
create policy demand_forecasts_tenant_select on public.demand_forecasts
  for select to authenticated
  using (public.current_role_is_admin() or owner_id = public.current_owner_id());

-- Covers the Clear All / delete-row buttons on the forecast history table,
-- which were failing for the same reason the reads were.
drop policy if exists demand_forecasts_tenant_write on public.demand_forecasts;
create policy demand_forecasts_tenant_write on public.demand_forecasts
  for all to authenticated
  using (public.current_role_is_admin() or owner_id = public.current_owner_id())
  with check (public.current_role_is_admin() or owner_id = public.current_owner_id());
