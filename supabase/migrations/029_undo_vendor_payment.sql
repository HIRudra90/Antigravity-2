-- 029_undo_vendor_payment.sql
--
-- The Pay button asked for confirmation through the browser's native
-- window.confirm(). That dialog is branded with the origin ("127.0.0.1:5173
-- says"), cannot be styled, and turns a one-click action into two clicks —
-- the opposite of what the button was asked for.
--
-- Removing it outright would leave a money movement with no safety net, so the
-- safeguard moves from before the action to after it: pay in one click, and
-- offer Undo. That is strictly better protection. A confirm dialog interrupts
-- every correct payment and is dismissed reflexively, so it catches almost
-- nothing; an undo catches the mistake that actually happened.
--
-- For that to be honest, the reversal has to undo everything the payment did,
-- not just the paid_at flag:
--
--   1. restock_orders.paid_at      -> back to null
--   2. the cash_ledger debit       -> deleted, so the balance returns
--   3. the "bill settled" notice   -> deleted, since it is no longer true
--
-- Leaving (2) behind would be the worst outcome: bills unpaid again but the
-- money still gone from the available balance.
--
-- pay_vendor_dues also now returns the ids it settled, so the undo reverses
-- exactly that payment and never a bill settled by some other path in between.

create or replace function public.pay_vendor_dues(p_vendor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
declare
  v_owner  uuid;
  v_now    timestamptz := now();
  v_count  integer := 0;
  v_total  numeric := 0;
  v_name   text;
  v_ids    uuid[];
begin
  if p_vendor_id is null then
    raise exception 'A vendor must be specified.';
  end if;

  v_owner := current_owner_id();

  select company into v_name from vendors where id = p_vendor_id;
  if v_name is null then
    raise exception 'Vendor % does not exist.', p_vendor_id;
  end if;

  -- Locked in a stable order so two clicks (or a click racing the autopay
  -- agent) cannot deadlock or double-settle the same bill.
  with target as (
    select r.id
      from restock_orders r
     where r.vendor_id = p_vendor_id
       and r.paid_at is null
       and lower(coalesce(r.status, '')) <> 'cancelled'
       and r.ordered_at >= books_opened_at()
       and (v_owner is null or r.owner_id = v_owner)
     order by r.id
       for update
  ),
  settled as (
    update restock_orders r
       set paid_at = v_now
      from target t
     where r.id = t.id
       and r.paid_at is null
    returning r.id, r.total_cost
  )
  select count(*), coalesce(sum(total_cost), 0), array_agg(id)
    into v_count, v_total, v_ids
    from settled;

  return jsonb_build_object(
    'vendor_id',   p_vendor_id,
    'vendor_name', v_name,
    'paid_count',  v_count,
    'paid_amount', round(v_total),
    'order_ids',   coalesce(to_jsonb(v_ids), '[]'::jsonb)
  );
end;
$fnbody$;

create or replace function public.undo_vendor_payment(p_order_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
declare
  v_owner uuid;
  v_count integer := 0;
  v_total numeric := 0;
  v_ids   uuid[];
begin
  if p_order_ids is null or array_length(p_order_ids, 1) is null then
    return jsonb_build_object('undone_count', 0, 'undone_amount', 0);
  end if;

  v_owner := current_owner_id();

  with target as (
    select r.id
      from restock_orders r
     where r.id = any(p_order_ids)
       and r.paid_at is not null
       and (v_owner is null or r.owner_id = v_owner)
     order by r.id
       for update
  ),
  reverted as (
    update restock_orders r
       set paid_at = null
      from target t
     where r.id = t.id
    returning r.id, r.total_cost
  )
  select count(*), coalesce(sum(total_cost), 0), array_agg(id)
    into v_count, v_total, v_ids
    from reverted;

  if v_count > 0 then
    -- Give the money back. Without this the bills would show unpaid while the
    -- cash stayed spent.
    delete from cash_ledger
     where source_type = 'restock_order'
       and source_id = any(select unnest(v_ids)::text);

    -- The "bill settled" notification is no longer true. Deleting rather than
    -- resolving also frees its dedupe key ('paid-<id>'), so paying again
    -- raises a fresh notification instead of being silently swallowed.
    delete from notifications
     where entity_type = 'restock_order'
       and category = 'payment'
       and entity_id = any(select unnest(v_ids)::text);
  end if;

  return jsonb_build_object(
    'undone_count',  v_count,
    'undone_amount', round(v_total)
  );
end;
$fnbody$;

revoke all on function public.pay_vendor_dues(uuid) from public;
revoke all on function public.pay_vendor_dues(uuid) from anon;
grant execute on function public.pay_vendor_dues(uuid) to authenticated;

revoke all on function public.undo_vendor_payment(uuid[]) from public;
revoke all on function public.undo_vendor_payment(uuid[]) from anon;
grant execute on function public.undo_vendor_payment(uuid[]) to authenticated;
