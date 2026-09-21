-- 016_notifications.sql
--
-- A real notification system. The Settings > Notifications panel wrote five
-- keys that nothing read, and the "Bell" in the nav was just the Alerts page
-- icon — nothing was ever generated, delivered, or marked as seen.
--
-- Notifications are raised by database triggers rather than by the app, so an
-- event is recorded whether it came from the UI, an agent, the admin console
-- or raw SQL. A notification only the UI path creates is worse than none.
--
-- Four categories, matching what actually happens in this system:
--   inventory   - a product crossed into low stock or ran out
--   procurement - a purchase order was raised
--   payment     - a vendor bill was settled, or salaries were paid
--   agent       - an autonomous agent did something
--
-- Dropped from the old panel: "Logistics Delays" (one shipment exists and the
-- courier integration reports no delay events), "AI Behavior Insights" (not a
-- discrete event), SMS (no provider is configured anywhere in this project)
-- and email forwarding (EmailJS is browser-side, so it cannot deliver while
-- the tab is closed — which is exactly when an alert matters).

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid,
  category    text not null check (category in ('inventory','procurement','payment','agent')),
  severity    text not null default 'info' check (severity in ('critical','warning','info')),
  title       text not null,
  body        text,
  -- In-app route the notification points at, so clicking it lands on the page
  -- where the thing actually is.
  link        text,
  entity_type text,
  entity_id   text,
  -- Collapses repeats: the same product going low twice in a day should not
  -- produce two unread rows.
  dedupe_key  text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);

create index if not exists notifications_unread_idx
  on public.notifications (owner_id, read_at, created_at desc);
create unique index if not exists notifications_dedupe_idx
  on public.notifications (dedupe_key) where dedupe_key is not null;

comment on table public.notifications is
'In-app notifications raised by database triggers. read_at null = unread.';

-- ---------------------------------------------------------------------------
-- Raiser. Honours the per-category switches in app_settings, so turning a
-- category off in Settings genuinely stops it being recorded.
-- ---------------------------------------------------------------------------
create or replace function public.raise_notification(
  p_owner_id    uuid,
  p_category    text,
  p_severity    text,
  p_title       text,
  p_body        text,
  p_link        text,
  p_entity_type text default null,
  p_entity_id   text default null,
  p_dedupe_key  text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
declare
  v_enabled text;
  v_id uuid;
begin
  select setting_value into v_enabled
    from app_settings where setting_key = 'notif_' || p_category;
  -- Default on: a brand-new category should notify until told otherwise.
  if coalesce(v_enabled, 'true') <> 'true' then
    return null;
  end if;

  insert into notifications
    (owner_id, category, severity, title, body, link, entity_type, entity_id, dedupe_key)
  values
    (p_owner_id, p_category, p_severity, p_title, p_body, p_link, p_entity_type, p_entity_id, p_dedupe_key)
  on conflict (dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;

  return v_id;
end;
$fnbody$;

-- ---------------------------------------------------------------------------
-- 1. Inventory: fires only on the CROSSING into low stock, not on every
--    update of an already-low item, which would otherwise notify on every sale.
-- ---------------------------------------------------------------------------
create or replace function public.notify_inventory_low()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
declare
  v_name text;
  v_crossed boolean;
begin
  v_crossed := new.current_stock <= new.reorder_level
               and (old.current_stock is null or old.current_stock > old.reorder_level);
  if not v_crossed then
    return new;
  end if;

  select name into v_name from products where id = new.product_id;
  v_name := coalesce(v_name, 'Product ' || new.product_id);

  perform raise_notification(
    new.owner_id,
    'inventory',
    case when new.current_stock = 0 then 'critical' else 'warning' end,
    case when new.current_stock = 0
         then v_name || ' is out of stock'
         else v_name || ' is low on stock' end,
    'Stock is ' || new.current_stock || ', at or below the reorder level of ' || new.reorder_level || '.',
    '/owner/restock',
    'inventory', new.product_id::text,
    'inv-' || new.product_id || '-' || to_char(current_date, 'YYYYMMDD')
  );
  return new;
end;
$fnbody$;

drop trigger if exists trg_notify_inventory_low on public.inventory;
create trigger trg_notify_inventory_low
  after update on public.inventory
  for each row execute function public.notify_inventory_low();

-- ---------------------------------------------------------------------------
-- 2. Procurement: a purchase order was raised (by hand or by the agent).
-- ---------------------------------------------------------------------------
create or replace function public.notify_purchase_order()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
begin
  perform raise_notification(
    new.owner_id,
    'procurement',
    'info',
    'Purchase order raised — ' || coalesce(new.vendor_name, 'vendor'),
    coalesce(new.items->0->>'product_name', 'Order')
      || case when coalesce(jsonb_array_length(new.items), 0) > 1
              then ' +' || (jsonb_array_length(new.items) - 1) || ' more' else '' end
      || ' · ' || round(coalesce(new.total_cost, 0))::text,
    '/owner/restock',
    'restock_order', new.id::text,
    'po-' || new.id
  );
  return new;
end;
$fnbody$;

drop trigger if exists trg_notify_purchase_order on public.restock_orders;
create trigger trg_notify_purchase_order
  after insert on public.restock_orders
  for each row execute function public.notify_purchase_order();

-- ---------------------------------------------------------------------------
-- 3. Payment: a vendor bill was settled.
-- ---------------------------------------------------------------------------
create or replace function public.notify_bill_settled()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
begin
  if new.paid_at is null or old.paid_at is not null then
    return new;
  end if;

  perform raise_notification(
    new.owner_id,
    'payment',
    'info',
    'Vendor bill settled — ' || coalesce(new.vendor_name, 'vendor'),
    round(coalesce(new.total_cost, 0))::text || ' paid.',
    '/owner/payment',
    'restock_order', new.id::text,
    'paid-' || new.id
  );
  return new;
end;
$fnbody$;

drop trigger if exists trg_notify_bill_settled on public.restock_orders;
create trigger trg_notify_bill_settled
  after update of paid_at on public.restock_orders
  for each row execute function public.notify_bill_settled();

-- ---------------------------------------------------------------------------
-- 4. Payment: a salary was paid.
-- ---------------------------------------------------------------------------
create or replace function public.notify_salary_paid()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
declare v_name text;
begin
  if new.paid_at is null or old.paid_at is not null then
    return new;
  end if;

  select name into v_name from employees where id = new.employee_id;

  perform raise_notification(
    null,
    'payment',
    'info',
    'Salary paid — ' || coalesce(v_name, 'employee'),
    round(coalesce(new.amount, 0))::text || ' for ' || new.payment_month || '/' || new.payment_year || '.',
    '/owner/employees',
    'salary_payment', new.id::text,
    'sal-' || new.id
  );
  return new;
end;
$fnbody$;

drop trigger if exists trg_notify_salary_paid on public.salary_payments;
create trigger trg_notify_salary_paid
  after update of paid_at on public.salary_payments
  for each row execute function public.notify_salary_paid();

-- ---------------------------------------------------------------------------
-- 5. Agent: an autonomous run that actually did something. Runs that skipped
--    ("not payday", "agent disabled") are logged but not notified — that is
--    the normal daily no-op and would bury everything else.
-- ---------------------------------------------------------------------------
create or replace function public.notify_agent_run()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
declare
  v_done int := coalesce((new.summary->>'done')::int, 0);
  v_amt  numeric := coalesce((new.summary->>'total_amount')::numeric, 0);
  v_label text;
begin
  if v_done <= 0 then
    return new;
  end if;

  v_label := case new.run_type
    when 'restock'    then 'Restock agent'
    when 'payroll'    then 'Payroll agent'
    when 'vendor_pay' then 'Vendor payment agent'
    else new.run_type end;

  perform raise_notification(
    null,
    'agent',
    'info',
    v_label || ' acted',
    v_done || ' item' || case when v_done = 1 then '' else 's' end
      || case when v_amt > 0 then ' · ' || round(v_amt)::text else '' end,
    case new.run_type
      when 'restock' then '/owner/restock'
      when 'payroll' then '/owner/employees'
      else '/owner/payment' end,
    'agent_run', new.id::text,
    'agent-' || new.id
  );
  return new;
end;
$fnbody$;

drop trigger if exists trg_notify_agent_run on public.agent_runs;
create trigger trg_notify_agent_run
  after insert on public.agent_runs
  for each row execute function public.notify_agent_run();

-- ---------------------------------------------------------------------------
-- Settings: the four categories that exist, defaulting on.
-- ---------------------------------------------------------------------------
insert into public.app_settings (setting_key, setting_value) values
  ('notif_inventory',   'true'),
  ('notif_procurement', 'true'),
  ('notif_payment',     'true'),
  ('notif_agent',       'true')
on conflict (setting_key) do nothing;

-- The old keys drove nothing and two of them described capabilities that do
-- not exist (SMS has no provider; browser-side email cannot fire when the tab
-- is shut).
delete from public.app_settings
 where setting_key in ('notif_low_stock','notif_payments','notif_logistics','notif_ai','notif_email','notif_sms');

-- ---------------------------------------------------------------------------
-- RLS — same tenant shape as the other tables.
-- ---------------------------------------------------------------------------
alter table public.notifications enable row level security;

drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications
  for select to authenticated, anon using (true);

drop policy if exists notifications_write on public.notifications;
create policy notifications_write on public.notifications
  for all to authenticated, anon using (true) with check (true);

-- Live delivery.
do $fnbody$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$fnbody$;

grant execute on function public.raise_notification(uuid,text,text,text,text,text,text,text,text) to authenticated;
