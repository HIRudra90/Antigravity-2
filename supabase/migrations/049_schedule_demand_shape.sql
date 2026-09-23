-- 049_schedule_demand_shape.sql
--
-- Refreshes the cached AI demand shape once a day, at 02:20 UTC -- before the
-- working day, and clear of the restock (08:00), payroll (09:00) and vendor
-- pay (10:00) sweeps so a cold Space cannot delay them.
--
-- Once a day is deliberate. The shape describes which families are running hot
-- today; it does not change hour to hour, and waking a sleeping Space 24 times
-- a day to ask the same question would burn its free-tier CPU budget for
-- nothing. The hourly tick reads the cached row.
--
-- The Authorization header is copied from an existing job rather than written
-- in. The service-role key is already present in cron.job from agent_setup.sql
-- and there is no reason to add a second literal copy of it -- one place to
-- rotate is better than two, and a key in a migration file is a key in git.

do $mig$
declare
  v_headers text;
begin
  -- Reuse whatever the restock sweep is already authenticating with.
  select substring(command from 'headers := ''(\{.*?\})''::jsonb')
    into v_headers
    from cron.job
   where jobname = 'agent-restock-daily';

  if v_headers is null then
    raise exception
      'Could not read the auth header from agent-restock-daily. Schedule sim-demand-shape-daily by hand, or re-run agent_setup.sql first.';
  end if;

  perform cron.unschedule('sim-demand-shape-daily')
   where exists (select 1 from cron.job where jobname = 'sim-demand-shape-daily');

  perform cron.schedule(
    'sim-demand-shape-daily',
    '20 2 * * *',
    format(
      $job$select net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb);$job$,
      'https://llmajiliqlgijtuxrdml.supabase.co/functions/v1/sim-demand-shape',
      v_headers,
      '{"trigger_source": "schedule"}'
    )
  );
end
$mig$;
