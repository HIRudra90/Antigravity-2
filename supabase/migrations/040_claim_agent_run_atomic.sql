-- 040_claim_agent_run_atomic.sql
--
-- Migration 034's claim did not actually serialise anything, and the comment
-- there asserting that it did was wrong.
--
--     insert into agent_runs (...)
--     select ... where not exists (select 1 from agent_runs where ...)
--
-- A single statement is not an atomic test-and-set. Under READ COMMITTED two
-- concurrent transactions both evaluate NOT EXISTS, neither can see the
-- other's uncommitted row, and both insert. It only looks correct when the
-- callers arrive one after another -- which is exactly how it was tested, with
-- two sequential HTTP calls seconds apart.
--
-- The real workload is not sequential. trg_low_stock fires one HTTP request
-- per product crossing its reorder level, so a simulated day that pushes 17
-- products under fires 17 requests in the same instant. Observed afterwards:
-- 12 agent runs spread across 4 distinct seconds, 8 of them inside one second,
-- each ordering the same 17 products. 236 purchase orders for 538,670 units.
--
-- A transaction-scoped advisory lock does serialise it. The first caller takes
-- the lock, checks, inserts and commits; the rest block on the lock, and by
-- the time they acquire it the committed row is visible, so their existence
-- check sees it and they decline. The lock is released at transaction end, and
-- since an RPC call is one transaction that is precisely the window that needs
-- protecting -- it is not held for the duration of the agent's work, only for
-- the claim.
--
-- pg_try_advisory_xact_lock rather than the blocking form: a caller that
-- cannot get the lock instantly is by definition racing another claimant, and
-- the right answer for it is "someone else is running", not "wait your turn".

-- Cooldown drops from 2 minutes to 30 seconds. The advisory lock is what
-- actually prevents the storm now, so the cooldown only has to stop silly
-- rapid repeats. Two minutes was long enough that a simulated fortnight --
-- which elapses in about two real seconds -- produced one agent run and then
-- ignored every later crossing, leaving products low with nothing on order.
create or replace function public.claim_agent_run(
  p_run_type       text,
  p_trigger_source text default 'manual',
  p_cooldown       interval default interval '30 seconds'
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
declare
  v_id uuid;
begin
  -- Anyone who cannot take this instantly is racing another claimant.
  if not pg_try_advisory_xact_lock(hashtext('claim_agent_run:' || p_run_type)) then
    return null;
  end if;

  if exists (
    select 1 from agent_runs r
     where r.run_type = p_run_type
       and r.created_at >= now() - p_cooldown
  ) then
    return null;
  end if;

  insert into agent_runs (run_type, trigger_source, summary)
  values (p_run_type, p_trigger_source,
          jsonb_build_object('done', 0, 'skipped', 0, 'errors', '[]'::jsonb, 'note', 'claimed'))
  returning id into v_id;

  return v_id;
end;
$fnbody$;

comment on function public.claim_agent_run(text, text, interval) is
'Reserves an agent run under an advisory lock. Returns the new agent_runs id, or NULL if another run of the same type is in progress or happened inside the cooldown.';

revoke all on function public.claim_agent_run(text, text, interval) from public;
revoke all on function public.claim_agent_run(text, text, interval) from anon;
grant execute on function public.claim_agent_run(text, text, interval) to authenticated;
