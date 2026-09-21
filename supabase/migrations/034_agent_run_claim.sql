-- 034_agent_run_claim.sql
--
-- The restock agent is not safe to run twice at once.
--
-- Found while verifying migration 033: a single HTTP call to the agent
-- produced TWO agent_runs rows and TWO purchase orders for the same product,
-- 150 units each. on_order correctly showed 300, because 300 units really had
-- been ordered. The reservation arithmetic was right; the agent had simply
-- executed twice.
--
-- Whatever the cause in that instance (a platform retry, a redirected POST,
-- two cron firings overlapping), the shape of the bug is permanent: nothing
-- stopped two concurrent runs from both reading the same low-stock list and
-- both ordering against it. Under the previous stale-write code this was
-- invisible -- the second run's inventory write simply clobbered the first's
-- -- which is part of why 1,404 orders appeared in two minutes.
--
-- So a run must be claimed before any ordering happens. The insert below is
-- the claim: it succeeds only if no run of the same type was recorded inside
-- the cooldown, and because that test and the insert are one statement, two
-- concurrent callers cannot both win it.
--
-- The claimed row is the agent_runs row the agent would have written anyway,
-- so this adds no bookkeeping -- it just writes it at the start instead of the
-- end, and the agent updates its summary when it finishes.

create or replace function public.claim_agent_run(
  p_run_type       text,
  p_trigger_source text default 'manual',
  p_cooldown       interval default interval '2 minutes'
)
returns uuid
language sql
security definer
set search_path to 'public'
as $fnbody$
  insert into agent_runs (run_type, trigger_source, summary)
  select p_run_type, p_trigger_source,
         jsonb_build_object('done', 0, 'skipped', 0, 'errors', '[]'::jsonb, 'note', 'claimed')
   where not exists (
     select 1 from agent_runs r
      where r.run_type = p_run_type
        and r.created_at >= now() - p_cooldown
   )
  returning id;
$fnbody$;

comment on function public.claim_agent_run(text, text, interval) is
'Reserves an agent run. Returns the new agent_runs id, or NULL if another run of the same type happened inside the cooldown.';

-- Lets the agent write its results back into the row it claimed.
create or replace function public.finish_agent_run(
  p_id      uuid,
  p_summary jsonb
)
returns void
language sql
security definer
set search_path to 'public'
as $fnbody$
  update agent_runs set summary = p_summary where id = p_id;
$fnbody$;

revoke all on function public.claim_agent_run(text, text, interval) from public;
revoke all on function public.claim_agent_run(text, text, interval) from anon;
revoke all on function public.finish_agent_run(uuid, jsonb) from public;
revoke all on function public.finish_agent_run(uuid, jsonb) from anon;
grant execute on function public.claim_agent_run(text, text, interval) to authenticated;
grant execute on function public.finish_agent_run(uuid, jsonb) to authenticated;
