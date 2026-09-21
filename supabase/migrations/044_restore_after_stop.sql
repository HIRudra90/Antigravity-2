-- 044_restore_after_stop.sql
--
-- Undoes 043's kill switch, now that 042 has made the webhook safe to leave on.
--
-- Two of the three are restored here; the third is deliberately not.
--
--   trg_low_stock       ON   -- safe now. Under 042 the trigger reads the
--                               agent's activation switch first and returns
--                               without making any HTTP call when it is off,
--                               so an idle agent costs nothing at all. When it
--                               is on, a run already claimed inside the
--                               cooldown also short-circuits, so a burst of
--                               twenty crossings makes one request, not twenty.
--
--   fire-due-reminders  ON   -- never part of the problem. It is DB-only work
--                               with no outbound HTTP, and reminders are
--                               useless if they do not fire on the minute.
--
--   agent_restock_enabled stays FALSE. Re-arming an autonomous agent that
--   spends money is the owner's decision, not a migration's -- the switch is
--   in Settings. Leaving it off also means the restored trigger is provably
--   inert until someone deliberately turns it on.

alter table public.inventory enable trigger trg_low_stock;

select cron.schedule('fire-due-reminders', '* * * * *',
  $cronbody$ select public.fire_due_reminders(); $cronbody$)
 where not exists (select 1 from cron.job where jobname = 'fire-due-reminders');
