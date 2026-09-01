-- ============================================================
-- Autonomous Agent setup: payroll + restock automation
-- Run this once in the Supabase SQL editor.
-- Replace <PROJECT_URL> and <SERVICE_ROLE_OR_ANON_KEY> below before running
-- the cron.schedule / trigger statements at the bottom.
-- ============================================================

-- 1. Two independent activation switches (off by default — flip from
--    Settings → AI Settings → Autonomous Agents)
insert into app_settings (setting_key, setting_value) values
  ('agent_restock_enabled', 'false'),
  ('agent_payroll_enabled', 'false')
on conflict (setting_key) do nothing;

-- 2. Audit trail — every agent run (scheduled or event-triggered) logs here
create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  run_type text not null,        -- 'restock' | 'payroll'
  trigger_source text not null,  -- 'schedule' | 'event' | 'manual'
  summary jsonb not null,        -- { done, skipped, errors[], total_amount }
  created_at timestamptz default now()
);

-- 3. Required extensions for scheduling + outbound HTTP from Postgres
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ============================================================
-- 4. Scheduled sweeps (safety net — catches anything the event
--    trigger missed, e.g. if pg_net failed transiently)
-- ============================================================
-- Restock check every morning at 08:00 UTC
select cron.schedule(
  'agent-restock-daily',
  '0 8 * * *',
  $$
  select net.http_post(
    url := '<PROJECT_URL>/functions/v1/agent-restock',
    headers := '{"Authorization": "Bearer <SERVICE_ROLE_OR_ANON_KEY>", "Content-Type": "application/json"}'::jsonb,
    body := '{"trigger_source": "schedule"}'::jsonb
  );
  $$
);

-- Payroll check every morning at 09:00 UTC (no-op except near payday,
-- since it only acts on salary_payments rows not yet marked Paid)
select cron.schedule(
  'agent-payroll-daily',
  '0 9 * * *',
  $$
  select net.http_post(
    url := '<PROJECT_URL>/functions/v1/agent-payroll',
    headers := '{"Authorization": "Bearer <SERVICE_ROLE_OR_ANON_KEY>", "Content-Type": "application/json"}'::jsonb,
    body := '{"trigger_source": "schedule"}'::jsonb
  );
  $$
);

-- ============================================================
-- 5. Event trigger — fires the instant a product crosses INTO
--    low stock (not on every inventory update, so it won't spam
--    the function for an item that's already low and ordered).
-- ============================================================
create or replace function notify_low_stock() returns trigger as $$
begin
  if NEW.current_stock <= NEW.reorder_level
     and (OLD.current_stock is null or OLD.current_stock > OLD.reorder_level) then
    perform net.http_post(
      url := '<PROJECT_URL>/functions/v1/agent-restock',
      headers := '{"Authorization": "Bearer <SERVICE_ROLE_OR_ANON_KEY>", "Content-Type": "application/json"}'::jsonb,
      body := '{"trigger_source": "event"}'::jsonb
    );
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_low_stock on inventory;
create trigger trg_low_stock
  after update on inventory
  for each row execute function notify_low_stock();

-- ============================================================
-- To disable everything later:
--   select cron.unschedule('agent-restock-daily');
--   select cron.unschedule('agent-payroll-daily');
--   drop trigger if exists trg_low_stock on inventory;
-- Or simpler — just flip agent_enabled to 'false' in app_settings;
-- both Edge Functions check that flag first and no-op if it's off.
-- ============================================================
