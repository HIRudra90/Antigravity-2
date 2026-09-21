-- 037_stagger_inventory_cycle.sql
--
-- Phase 2 set every product to exactly 30 days of cover, which is a clean
-- starting point but an unrealistic one: the entire catalogue then sits at the
-- same position in its replenishment cycle and crosses the reorder point
-- within the same week. Running the simulator for 30 days shows it plainly --
-- 3 products cross on day 20, then 9, then 30, then 19 -- 66 products inside
-- six days.
--
-- That is the user's original complaint restated. Testing the restock loop is
-- impossible when everything happens at once, and a synchronised catalogue
-- guarantees it will.
--
-- Real inventory is desynchronised: each product was last delivered at a
-- different time, so at any moment they are scattered across their cycles.
-- This places each product at a random point between the reorder level and a
-- full 35 days of cover, deterministically seeded so a test run can be
-- reproduced.
--
-- Safe to re-run: it is how you reshuffle the shop before a fresh test.

create or replace function public.stagger_inventory_cycle(
  p_min_days integer default 9,
  p_max_days integer default 35,
  p_seed     double precision default null
)
returns table (product_id integer, product_name text, days_cover integer, stock integer)
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
begin
  if p_min_days < 1 or p_max_days <= p_min_days then
    raise exception 'p_max_days must be greater than p_min_days, and p_min_days at least 1';
  end if;

  -- A fixed seed makes a scenario repeatable; without one every call reshuffles.
  if p_seed is not null then
    perform setseed(greatest(-1, least(1, p_seed)));
  end if;

  return query
  with daily as (
    select s.product_id as pid, s.sale_date, sum(s.quantity_sold) as qty
      from sales_transactions s
     where s.sale_date >= current_date - 90
     group by 1, 2
  ),
  med as (
    select d.pid, percentile_cont(0.5) within group (order by d.qty) as m
      from daily d group by 1
  ),
  stat as (
    select d.pid, avg(d.qty) as mu
      from daily d join med m on m.pid = d.pid
     where d.qty <= 3 * m.m
     group by 1
  ),
  target as (
    select st.pid,
           -- Never below the reorder point: a product starting already-low
           -- would fire the agent the moment this runs, which is a reshuffle,
           -- not a demand event.
           greatest(
             i.reorder_level + 1,
             round(st.mu * (p_min_days + random() * (p_max_days - p_min_days)))::int
           ) as new_stock
      from stat st join inventory i on i.product_id = st.pid
  ),
  upd as (
    update inventory i
       set current_stock = t.new_stock,
           on_order      = 0,
           last_updated  = now()
      from target t
     where i.product_id = t.pid
    returning i.product_id, i.current_stock
  )
  select u.product_id, p.name::text,
         round(u.current_stock / nullif(s.mu, 0))::int,
         u.current_stock
    from upd u
    join products p on p.id = u.product_id
    join stat s on s.pid = u.product_id
   order by 3;
end;
$fnbody$;

comment on function public.stagger_inventory_cycle(integer, integer, double precision) is
'Test harness: scatters products across their replenishment cycles so they do not all hit reorder at once.';

revoke all on function public.stagger_inventory_cycle(integer, integer, double precision) from public;
revoke all on function public.stagger_inventory_cycle(integer, integer, double precision) from anon;
grant execute on function public.stagger_inventory_cycle(integer, integer, double precision) to authenticated;
