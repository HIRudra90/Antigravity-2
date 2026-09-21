-- 043_emergency_stop.sql
--
-- Kill switch. Run this first, on its own, when the project is throttling.
--
-- Deliberately tiny: three statements, no function bodies, no reference to the
-- `net` or `auth` schemas. Larger scripts were being rejected outright while
-- the project was rate-limited, so this is sized to land in a short window.
--
-- What it stops:
--   * the restock agent's activation switch, so any webhook that does fire
--     returns immediately instead of making a dozen further API calls
--   * trg_low_stock itself, which is the thing issuing one outbound HTTP
--     request per product crossing its reorder level -- the source of the
--     traffic that caused the throttling
--   * the per-minute reminder cron, which is cheap but pointless while
--     everything else is being cleared
--
-- Re-enable with 044 once the project is healthy and 042 (the throttled
-- webhook) has been applied.

update public.app_settings
   set setting_value = 'false'
 where setting_key in ('agent_restock_enabled', 'auto_vendor_pay_enabled', 'agent_vendor_pay_enabled');

alter table public.inventory disable trigger trg_low_stock;

select cron.unschedule('fire-due-reminders')
 where exists (select 1 from cron.job where jobname = 'fire-due-reminders');
