-- 017_bulk_owner_order.sql
--
-- "Buy everything available" for the admin console.
--
-- Placing ~50 orders by looping place_owner_order from the browser would be
-- wrong in three ways: the quantities would come from stock figures the page
-- read seconds earlier (the restock agent writes to the same rows), a closed
-- tab or dropped connection would leave the owner's books half-updated, and it
-- would be 50 round trips. So the whole batch is one transaction that reads
-- the stock it is about to sell, under lock.
--
-- Deliberately NOT suppressed: the sale insert fires the existing
-- trg_sale_decrement_inventory trigger, which in turn fires the low-stock
-- notification trigger from 016 for every product that hits zero. That is a
-- true statement about the inventory and the owner-side pages depend on it, so
-- the flood is honest rather than something to hide. The UI warns about it
-- before the click instead.

-- ---------------------------------------------------------------------------
-- Preview: what the button is about to do, counted on the server.
--
-- The page has its own products+inventory in state, but a preview computed
-- from that would be a guess about what the write will actually hit. This is
-- the same query the write uses.
-- ---------------------------------------------------------------------------
create or replace function public.preview_owner_order_all(p_owner_id uuid)
returns table (product_count integer, total_units bigint, total_amount numeric)
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
begin
  if not current_role_is_admin() then
    raise exception 'Only an admin can preview orders for an owner';
  end if;

  return query
    select count(*)::integer,
           coalesce(sum(i.current_stock), 0)::bigint,
           coalesce(sum(i.current_stock * coalesce(p.unit_price, 0)), 0)::numeric
      from products p
      join inventory i
        on i.product_id = p.id
       and i.owner_id = p.owner_id
     where p.owner_id = p_owner_id
       and i.current_stock > 0;
end;
$fnbody$;

-- ---------------------------------------------------------------------------
-- The write. Buys the full available stock of every in-stock product.
-- ---------------------------------------------------------------------------
create or replace function public.place_owner_order_all(
  p_owner_id uuid,
  p_note     text default null
)
returns table (product_count integer, total_units bigint, total_amount numeric)
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
declare
  v_email   text;
  r         record;
  v_sale_id bigint;
  v_count   integer := 0;
  v_units   bigint  := 0;
  v_amount  numeric := 0;
begin
  -- SECURITY DEFINER bypasses RLS, so the role check is the only thing
  -- standing between this and any authenticated user emptying an owner's
  -- shelves. It is not optional.
  if not current_role_is_admin() then
    raise exception 'Only an admin can place orders for an owner';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  for r in
    select p.id,
           p.name,
           p.family,
           coalesce(p.unit_price, 0) as unit_price,
           i.current_stock
      from products p
      join inventory i
        on i.product_id = p.id
       and i.owner_id = p.owner_id
     where p.owner_id = p_owner_id
       and i.current_stock > 0
     -- Stable lock order. A concurrent single-product order takes the same
     -- inventory row; acquiring them in a consistent order stops the two
     -- deadlocking against each other.
     order by p.id
     for update of i
  loop
    -- The sale is the only thing that touches stock: trg_sale_decrement_inventory
    -- already does current_stock = GREATEST(0, current_stock - quantity_sold).
    -- Decrementing here as well would take it down twice, exactly as the
    -- single-order path documents.
    insert into sales_transactions
      (product_id, sale_date, quantity_sold, on_promotion, owner_id)
    values
      (r.id, current_date, r.current_stock, false, p_owner_id)
    returning id into v_sale_id;

    insert into orders (
      owner_id, product_id, product_name, family, quantity,
      unit_price, total_amount, status, placed_by, placed_by_email, sale_id, note
    ) values (
      p_owner_id, r.id, r.name, r.family, r.current_stock,
      r.unit_price, r.unit_price * r.current_stock, 'Completed',
      auth.uid(), v_email, v_sale_id,
      coalesce(p_note, 'Bulk purchase — all available stock')
    );

    v_count  := v_count + 1;
    v_units  := v_units + r.current_stock;
    v_amount := v_amount + (r.unit_price * r.current_stock);
  end loop;

  return query select v_count, v_units, v_amount;
end;
$fnbody$;

-- ---------------------------------------------------------------------------
-- Grants.
--
-- Postgres grants EXECUTE to PUBLIC by default, so granting to `authenticated`
-- restricts nothing on its own — an anon caller would still reach it. Both
-- functions are revoked from PUBLIC and anon explicitly, naming argument types.
-- ---------------------------------------------------------------------------
revoke execute on function public.preview_owner_order_all(uuid) from public;
revoke execute on function public.preview_owner_order_all(uuid) from anon;
grant  execute on function public.preview_owner_order_all(uuid) to authenticated;

revoke execute on function public.place_owner_order_all(uuid, text) from public;
revoke execute on function public.place_owner_order_all(uuid, text) from anon;
grant  execute on function public.place_owner_order_all(uuid, text) to authenticated;

comment on function public.place_owner_order_all(uuid, text) is
'Admin-only. Sells the full available stock of every in-stock product for one owner, in a single transaction.';
