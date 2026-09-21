-- 026_dedupe_only_open_alerts.sql
--
-- 025 made alerts close themselves when the underlying condition is fixed.
-- That exposed a gap in the dedupe rule it inherited.
--
-- dedupe_key for a stock alert is 'inv-<product>-<date>' — one per product per
-- day, so the same item going low twice in a day cannot produce two unread
-- rows. Correct on its own. But combined with auto-resolution it goes wrong:
--
--   product runs out      -> alert raised
--   stock replenished     -> alert auto-resolves      (025)
--   product runs out AGAIN -> deduped against the resolved row, SILENT
--
-- The second outage is a genuinely new event and the operator hears nothing
-- about it until tomorrow. Suppressing a repeat of something still open is
-- noise control; suppressing a recurrence of something already dealt with is
-- a dropped alert.
--
-- So the uniqueness only applies while the alert is open. Once resolved, the
-- key is free again and a recurrence raises a fresh alert.
--
-- NOTE: this is a PARTIAL unique index, so every ON CONFLICT targeting it must
-- restate the predicate in full. A bare `on conflict (dedupe_key)` does not
-- match a partial index — Postgres raises "no unique or exclusion constraint
-- matching the ON CONFLICT specification", and because that happens inside the
-- trigger it fails the originating write (the restock, the sale) rather than
-- just skipping the notification.

drop index if exists public.notifications_dedupe_idx;

create unique index notifications_dedupe_idx
  on public.notifications (dedupe_key)
  where dedupe_key is not null and resolved_at is null;

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
  on conflict (dedupe_key) where dedupe_key is not null and resolved_at is null do nothing
  returning id into v_id;

  return v_id;
end;
$fnbody$;

-- The rollup update in notify_purchase_order must likewise only touch the one
-- OPEN row for that vendor+day; resolved rows from earlier in the day keep the
-- same key and are history, not live counters.
create or replace function public.notify_purchase_order()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
declare
  v_vendor text := coalesce(new.vendor_name, 'vendor');
  v_key    text;
  v_count  int;
  v_total  numeric;
begin
  v_key := 'po-' || lower(v_vendor) || '-' || to_char(current_date, 'YYYYMMDD');

  perform raise_notification(
    new.owner_id,
    'procurement',
    'info',
    'Purchase order raised — ' || v_vendor,
    coalesce(new.items->0->>'product_name', 'Order')
      || case when coalesce(jsonb_array_length(new.items), 0) > 1
              then ' +' || (jsonb_array_length(new.items) - 1) || ' more' else '' end
      || ' · ' || round(coalesce(new.total_cost, 0))::text,
    '/owner/restock',
    'restock_order', new.id::text,
    v_key
  );

  select count(*), coalesce(sum(total_cost), 0)
    into v_count, v_total
    from restock_orders
   where lower(coalesce(vendor_name, 'vendor')) = lower(v_vendor)
     and ordered_at >= current_date
     and lower(coalesce(status, '')) <> 'cancelled';

  if v_count > 1 then
    update notifications
       set title = 'Purchase orders raised — ' || v_vendor,
           body  = v_count || ' orders today · ' || round(v_total)::text
     where dedupe_key = v_key
       and resolved_at is null;
  end if;

  return new;
end;
$fnbody$;

grant execute on function public.raise_notification(uuid,text,text,text,text,text,text,text,text) to authenticated;
