-- 027_pay_vendor_dues.sql
--
-- Settle one vendor's outstanding bills in a single click.
--
-- Until now the only way to pay a vendor was run_vendor_autopay(), which
-- settles EVERY vendor at once and only on the configured payday. There was no
-- way to clear one vendor deliberately, which is what the Pay button on the
-- vendor card needs.
--
-- The predicate deliberately mirrors get_vendor_payment_summary() — the
-- function that computes the "Outstanding" figure printed on that card —
-- rather than run_vendor_autopay()'s. The two disagree on one point: autopay
-- uses `status is distinct from 'Cancelled'` (case-sensitive), the summary
-- uses `lower(coalesce(status,'')) <> 'cancelled'`. A row stored as
-- 'cancelled' in lower case is therefore excluded from the displayed total but
-- would have been paid by autopay. A button labelled "Pay $X" must settle
-- exactly $X and leave the card reading zero, so it follows the number the
-- user can actually see.
--
-- Everything downstream happens through the existing triggers: the payment
-- debits cash (cash_on_vendor_payment), raises a "bill settled" notification
-- (notify_bill_settled), and trips the overdraft alert if it takes the balance
-- below zero (cash_check_overdraft). Nothing about those paths is special-cased
-- for a manual payment.

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
    returning r.total_cost
  )
  select count(*), coalesce(sum(total_cost), 0) into v_count, v_total from settled;

  return jsonb_build_object(
    'vendor_id',   p_vendor_id,
    'vendor_name', v_name,
    'paid_count',  v_count,
    'paid_amount', round(v_total)
  );
end;
$fnbody$;

-- Postgres grants EXECUTE to PUBLIC by default, which on a SECURITY DEFINER
-- function that moves money would let an unauthenticated caller settle bills.
revoke all on function public.pay_vendor_dues(uuid) from public;
revoke all on function public.pay_vendor_dues(uuid) from anon;
grant execute on function public.pay_vendor_dues(uuid) to authenticated;
