-- 020_cash_account.sql
--
-- Turns "Cash Balance" from a number someone typed into a real account.
--
-- Before this, cash_balance was a single string in app_settings, edited by
-- hand, that nothing ever debited. Paying a vendor, running payroll or booking
-- a shipment left it untouched, so it only ever meant "what I last typed".
-- Separately, the Payment page's Record Payment modal read and wrote
-- public.financial_transactions — a table that does not exist in this database
-- — so manual entries silently went nowhere.
--
-- The model here is a full cash account:
--     balance = deposits + sales revenue - spending - cashouts
-- Every movement is a row, so the balance is derived and auditable rather than
-- asserted, and every automatic debit is idempotent on its source event.

create table if not exists public.cash_ledger (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid,
  -- 'in' adds to the balance, 'out' subtracts. Amount is always positive so a
  -- sign error cannot silently invert a movement.
  direction   text not null check (direction in ('in', 'out')),
  kind        text not null check (kind in ('deposit','cashout','revenue','procurement','payroll','shipping','adjustment')),
  amount      numeric not null check (amount > 0),
  description text,
  -- What caused this movement. The unique index below makes every automatic
  -- entry idempotent: a trigger that fires twice for the same event cannot
  -- double-count it.
  source_type text,
  source_id   text,
  created_at  timestamptz not null default now(),
  created_by  uuid
);

create index if not exists cash_ledger_created_idx on public.cash_ledger (created_at desc);
create unique index if not exists cash_ledger_source_idx
  on public.cash_ledger (source_type, source_id)
  where source_type is not null and source_id is not null;

comment on table public.cash_ledger is
'Every movement of spendable cash. Balance is the running sum since books_opened_at, never a stored figure.';

-- ---------------------------------------------------------------------------
-- The balance. Scoped to the accounting epoch, like every other money figure,
-- so "reset" means the same thing everywhere.
-- ---------------------------------------------------------------------------
create or replace function public.get_cash_balance()
returns table (
  balance      numeric,
  total_in     numeric,
  total_out    numeric,
  deposits     numeric,
  cashouts     numeric,
  revenue      numeric,
  spending     numeric,
  movements    bigint,
  opened_at    timestamptz
)
language sql
stable
set search_path to 'public'
as $fnbody$
  with e as (select books_opened_at() as t),
  l as (select * from cash_ledger, e where cash_ledger.created_at >= e.t)
  select
    coalesce(round(sum(case when direction = 'in' then amount else -amount end)), 0),
    coalesce(round(sum(amount) filter (where direction = 'in')), 0),
    coalesce(round(sum(amount) filter (where direction = 'out')), 0),
    coalesce(round(sum(amount) filter (where kind = 'deposit')), 0),
    coalesce(round(sum(amount) filter (where kind = 'cashout')), 0),
    coalesce(round(sum(amount) filter (where kind = 'revenue')), 0),
    coalesce(round(sum(amount) filter (where direction = 'out' and kind <> 'cashout')), 0),
    count(*)::bigint,
    (select t from e)
  from l;
$fnbody$;

-- ---------------------------------------------------------------------------
-- Manual movements: add money, take money out.
-- ---------------------------------------------------------------------------
create or replace function public.cash_deposit(p_amount numeric, p_note text default null)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
declare v_balance numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Deposit amount must be greater than zero';
  end if;

  insert into cash_ledger (owner_id, direction, kind, amount, description, created_by)
  values (current_owner_id(), 'in', 'deposit', p_amount,
          coalesce(nullif(trim(p_note), ''), 'Money added'), auth.uid());

  select balance into v_balance from get_cash_balance();
  return v_balance;
end;
$fnbody$;

create or replace function public.cash_withdraw(p_amount numeric, p_note text default null)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
declare v_balance numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Cashout amount must be greater than zero';
  end if;

  insert into cash_ledger (owner_id, direction, kind, amount, description, created_by)
  values (current_owner_id(), 'out', 'cashout', p_amount,
          coalesce(nullif(trim(p_note), ''), 'Cash withdrawn'), auth.uid());

  select balance into v_balance from get_cash_balance();
  return v_balance;
end;
$fnbody$;

-- ---------------------------------------------------------------------------
-- Automatic movements.
--
-- These are triggers rather than app code so a debit happens whichever path
-- caused it: the UI, an agent, the admin console or raw SQL. A balance that
-- only some code paths update is worse than no balance at all.
-- ---------------------------------------------------------------------------

-- Money leaves when a vendor bill is actually settled, not when it is raised.
create or replace function public.cash_on_vendor_payment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
begin
  if new.paid_at is null or old.paid_at is not null then
    return new;
  end if;
  if lower(coalesce(new.status, '')) = 'cancelled' then
    return new;
  end if;

  insert into cash_ledger (owner_id, direction, kind, amount, description, source_type, source_id)
  values (new.owner_id, 'out', 'procurement', coalesce(new.total_cost, 0),
          'Vendor payment — ' || coalesce(new.vendor_name, 'vendor'),
          'restock_order', new.id::text)
  on conflict (source_type, source_id) do nothing;

  return new;
end;
$fnbody$;

drop trigger if exists trg_cash_vendor_payment on public.restock_orders;
create trigger trg_cash_vendor_payment
  after update of paid_at on public.restock_orders
  for each row execute function public.cash_on_vendor_payment();

-- Payroll leaves when a salary is marked paid.
create or replace function public.cash_on_salary_payment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
declare v_name text;
begin
  if new.paid_at is null or old.paid_at is not null then
    return new;
  end if;

  select name into v_name from employees where id = new.employee_id;

  insert into cash_ledger (owner_id, direction, kind, amount, description, source_type, source_id)
  values (null, 'out', 'payroll', coalesce(new.amount, 0),
          'Salary — ' || coalesce(v_name, 'employee'),
          'salary_payment', new.id::text)
  on conflict (source_type, source_id) do nothing;

  return new;
end;
$fnbody$;

drop trigger if exists trg_cash_salary_payment on public.salary_payments;
create trigger trg_cash_salary_payment
  after update of paid_at on public.salary_payments
  for each row execute function public.cash_on_salary_payment();

-- Shipping is paid at booking.
create or replace function public.cash_on_shipment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
begin
  if coalesce(new.price, 0) <= 0 then
    return new;
  end if;

  insert into cash_ledger (owner_id, direction, kind, amount, description, source_type, source_id)
  values (null, 'out', 'shipping', new.price,
          'Shipping — ' || coalesce(new.carrier, 'courier'),
          'shipment', new.id::text)
  on conflict (source_type, source_id) do nothing;

  return new;
end;
$fnbody$;

drop trigger if exists trg_cash_shipment on public.shipments;
create trigger trg_cash_shipment
  after insert on public.shipments
  for each row execute function public.cash_on_shipment();

-- Revenue arrives with the sale.
create or replace function public.cash_on_sale()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
declare
  v_price numeric;
  v_name  text;
  v_value numeric;
begin
  select unit_price, name into v_price, v_name from products where id = new.product_id;
  v_value := coalesce(v_price, 0) * coalesce(new.quantity_sold, 0);

  if v_value <= 0 then
    return new;
  end if;

  insert into cash_ledger (owner_id, direction, kind, amount, description, source_type, source_id)
  values (new.owner_id, 'in', 'revenue', v_value,
          'Sale — ' || coalesce(v_name, 'product'),
          'sale', new.id::text)
  on conflict (source_type, source_id) do nothing;

  return new;
end;
$fnbody$;

drop trigger if exists trg_cash_sale on public.sales_transactions;
create trigger trg_cash_sale
  after insert on public.sales_transactions
  for each row execute function public.cash_on_sale();

-- ---------------------------------------------------------------------------
-- Overdraft warning.
--
-- Only outflows can push the balance under, so the check runs on those alone
-- rather than on every sale. Deduped per day: one warning while you are
-- overdrawn, not one per payment.
-- ---------------------------------------------------------------------------
create or replace function public.cash_check_overdraft()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fnbody$
declare v_balance numeric;
begin
  if new.direction <> 'out' then
    return new;
  end if;

  select balance into v_balance from get_cash_balance();

  if v_balance < 0 then
    perform raise_notification(
      new.owner_id,
      'payment',
      'critical',
      'Cash balance is negative',
      'Balance is ' || round(v_balance)::text || ' after ' || coalesce(new.description, 'a payment')
        || '. Add money to cover further spending.',
      '/owner/payment',
      'cash_ledger', new.id::text,
      'cash-negative-' || to_char(current_date, 'YYYYMMDD')
    );
  end if;

  return new;
end;
$fnbody$;

drop trigger if exists trg_cash_overdraft on public.cash_ledger;
create trigger trg_cash_overdraft
  after insert on public.cash_ledger
  for each row execute function public.cash_check_overdraft();

-- ---------------------------------------------------------------------------
-- RLS + realtime, matching the other tables.
-- ---------------------------------------------------------------------------
alter table public.cash_ledger enable row level security;

drop policy if exists cash_ledger_read on public.cash_ledger;
create policy cash_ledger_read on public.cash_ledger
  for select to authenticated, anon using (true);

drop policy if exists cash_ledger_write on public.cash_ledger;
create policy cash_ledger_write on public.cash_ledger
  for all to authenticated, anon using (true) with check (true);

do $blk$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cash_ledger'
  ) then
    alter publication supabase_realtime add table public.cash_ledger;
  end if;
end;
$blk$;

-- Postgres grants EXECUTE to PUBLIC by default, so the write functions are
-- revoked explicitly — granting to `authenticated` alone restricts nothing.
revoke execute on function public.cash_deposit(numeric, text)  from public;
revoke execute on function public.cash_deposit(numeric, text)  from anon;
grant  execute on function public.cash_deposit(numeric, text)  to authenticated;

revoke execute on function public.cash_withdraw(numeric, text) from public;
revoke execute on function public.cash_withdraw(numeric, text) from anon;
grant  execute on function public.cash_withdraw(numeric, text) to authenticated;

grant execute on function public.get_cash_balance() to authenticated;
