-- 042_throttle_low_stock_webhook.sql
--
-- APPLY THIS FIRST once the project stops returning 429/544.
--
-- trg_low_stock fires net.http_post() to the restock agent for EVERY product
-- that crosses its reorder level. That is one Edge Function invocation per
-- product, and each invocation then makes several API calls of its own
-- (settings, inventory, vendors, an insert per low product, the run claim).
--
-- Normally that is a trickle. Under the simulator it is not: advancing a
-- fortnight takes about two seconds and can push twenty or more products under
-- at once, and running that repeatedly stacks the bursts. The result was the
-- project rate-limiting itself into an outage -- Storage returning 429, REST
-- and Auth timing out, and therefore no sign-in and no pages, because the
-- browser could not reach the API at all.
--
-- Migration 040's claim already ensures only one of those invocations does any
-- work. But the other nineteen still cost a full HTTP round trip each, and the
-- cost is paid whether or not the agent has anything to do. The claim was
-- solving the right problem one layer too late.
--
-- So the check moves into the trigger: ask first whether a run is already
-- claimed, and only make the HTTP call if it is not. A burst of twenty
-- crossings now produces at most one request instead of twenty.
--
-- Two further guards:
--   * the agent's own on/off switch is honoured here, so a disabled agent
--     costs nothing at all rather than one request per crossing that the
--     function immediately discards
--   * a crossing while stock is already on order raises nothing, matching the
--     current_stock + on_order test the agent and the Restock queue both use

create or replace function public.notify_low_stock()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
declare
  v_enabled text;
  v_recent  boolean;
begin
  -- Only on the crossing INTO low, as before.
  if not (new.current_stock <= new.reorder_level
          and (old.current_stock is null or old.current_stock > old.reorder_level)) then
    return new;
  end if;

  -- Goods already on the way are not a reason to order more.
  if coalesce(new.current_stock, 0) + coalesce(new.on_order, 0) > new.reorder_level then
    return new;
  end if;

  -- A disabled agent should cost nothing. Without this every crossing still
  -- paid for an HTTP round trip so the function could look up the same switch
  -- and return.
  select setting_value into v_enabled
    from app_settings where setting_key = 'agent_restock_enabled';
  if coalesce(v_enabled, 'false') <> 'true' then
    return new;
  end if;

  -- The decisive guard. If a restock run was claimed within the cooldown, the
  -- agent would refuse this call anyway, so do not make it. Twenty simultaneous
  -- crossings become one request rather than twenty.
  select exists (
    select 1 from agent_runs r
     where r.run_type = 'restock'
       and r.created_at >= now() - interval '30 seconds'
  ) into v_recent;

  if v_recent then
    return new;
  end if;

  perform net.http_post(
    url := 'https://llmajiliqlgijtuxrdml.supabase.co/functions/v1/agent-restock',
    headers := jsonb_build_object(
      'Authorization', 'Bearer sb_publishable_o77wMVDbkpVYyEIMsyXUIg__zxAA2z_',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('trigger_source', 'event')
  );

  return new;
end;
$fnbody$;

comment on function public.notify_low_stock() is
'Fires the restock agent on a crossing into low stock, at most once per cooldown window and only when the agent is enabled.';
