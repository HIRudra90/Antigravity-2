-- 056_rebuild_payroll_and_shipping.sql
--
-- Gives payroll and shipping figures that belong to the same business as the
-- revenue.
--
-- Before this, the expense breakdown read:
--
--     Payroll    $4,000     one ledger row, against 32 employees who cost
--                           $100,444 every month
--     Shipping   $12        two shipments, for an operation moving $1.67M of
--                           goods a day
--
-- Both were leftovers from hand-testing, not records of anything. A donut
-- chart of $4,000 payroll against $238M of procurement tells you nothing.
--
-- Payroll is generated from the standing cost: every employee paid every
-- month, for the 13 months the books now cover. Shipping is generated as 1% of
-- each day's actual sales, so logistics cost grows with the volume shipped
-- rather than sitting at a constant.
--
-- The cash triggers are disabled for both inserts and the ledger rows written
-- by hand. Not to bypass them -- to date them. trg_cash_salary_payment and
-- trg_cash_shipment both stamp created_at with now(), which would drop a year
-- of payroll and shipping onto today and spike the monthly cash-flow chart on
-- a single day. Re-enabled in an EXCEPTION block.

do $mig$
declare
  v_owner    uuid;
  v_sal      integer := 0;
  v_ship     integer := 0;
begin
  select owner_id into v_owner from products where owner_id is not null limit 1;

  execute 'alter table public.salary_payments disable trigger trg_cash_salary_payment';
  execute 'alter table public.salary_payments disable trigger trg_notify_salary_paid';
  execute 'alter table public.shipments      disable trigger trg_cash_shipment';

  -- ---------------------------------------------------------------------
  -- Payroll: clear the hand-test rows, then pay everyone, every month.
  -- ---------------------------------------------------------------------
  delete from cash_ledger where source_type = 'salary_payment';
  delete from salary_payments;

  with months as (
    select m::date as month_start
      from generate_series(date '2025-09-01', date_trunc('month', current_date)::date, interval '1 month') m
  ),
  ins as (
    insert into salary_payments (employee_id, amount, payment_month, payment_year, status, paid_at, created_at)
    select e.id,
           e.monthly_salary,
           extract(month from mo.month_start)::int,
           extract(year  from mo.month_start)::int,
           'Paid',
           -- Paid on the 28th, or today for the month still in progress.
           least((mo.month_start + interval '27 days')::date, current_date) + time '17:00',
           least((mo.month_start + interval '27 days')::date, current_date) + time '17:00'
      from months mo
      cross join employees e
     where e.monthly_salary > 0
    returning id, amount, paid_at
  )
  insert into cash_ledger (owner_id, direction, kind, amount, description, source_type, source_id, created_at)
  select v_owner, 'out', 'payroll', i.amount, 'Salary payment', 'salary_payment', i.id::text, i.paid_at
    from ins i where i.amount > 0;

  get diagnostics v_sal = row_count;

  -- ---------------------------------------------------------------------
  -- Shipping: one consignment per trading day, costed at 1% of that day's
  -- sales, so it scales with what actually moved.
  -- ---------------------------------------------------------------------
  delete from cash_ledger where source_type = 'shipment';
  delete from shipments;

  with day_rev as (
    select t.sale_date, round(sum(t.quantity_sold * p.unit_price)) as gross,
           sum(t.quantity_sold) as units
      from sales_transactions t
      join products p on p.id = t.product_id
     group by t.sale_date
  ),
  -- A VALUES list, not nested array literals: Postgres flattens
  -- array[array[...],array[...]] into one 2-D array, so subscripting it with a
  -- single index yields text and "cannot subscript type text" follows.
  dests as (
    select * from (values
      (0, 'Kuala Lumpur', 'Wilayah Persekutuan', '50000'),
      (1, 'Penang',       'Pulau Pinang',        '10000'),
      (2, 'Johor Bahru',  'Johor',               '80000'),
      (3, 'Ipoh',         'Perak',               '30000'),
      (4, 'Kuching',      'Sarawak',             '93000')
    ) as v(idx, city, state, postcode)
  ),
  ins as (
    -- recipient_name/phone/address/city/state/postcode are all NOT NULL on
    -- this table, so every one has to be supplied even though a bulk
    -- distribution run has no single consumer recipient.
    insert into shipments
      (tracking_no, carrier, service_name,
       recipient_name, recipient_phone, recipient_address,
       recipient_city, recipient_state, recipient_postcode,
       weight_kg, item_type, price, currency, status_code, created_at)
    select 'DHL' || to_char(d.sale_date, 'YYYYMMDD'),
           'DHL', 'Domestic Express',
           'Retail Distribution', '+60-3-0000-0000', 'Distribution Centre',
           dest.city, dest.state, dest.postcode,
           round(d.units * 0.4, 2),
           'Parcel',
           round(d.gross * 0.01),
           'USD',
           700,                       -- delivered
           d.sale_date + time '16:00'
      from day_rev d
      join dests dest on dest.idx = (extract(doy from d.sale_date)::int % 5)
     where d.gross > 0
    returning id, price, created_at
  )
  insert into cash_ledger (owner_id, direction, kind, amount, description, source_type, source_id, created_at)
  select v_owner, 'out', 'shipping', i.price, 'Outbound logistics', 'shipment', i.id::text, i.created_at
    from ins i where i.price > 0;

  get diagnostics v_ship = row_count;

  execute 'alter table public.salary_payments enable trigger trg_cash_salary_payment';
  execute 'alter table public.salary_payments enable trigger trg_notify_salary_paid';
  execute 'alter table public.shipments      enable trigger trg_cash_shipment';

  raise notice 'payroll rows %, shipping rows %', v_sal, v_ship;

exception when others then
  execute 'alter table public.salary_payments enable trigger trg_cash_salary_payment';
  execute 'alter table public.salary_payments enable trigger trg_notify_salary_paid';
  execute 'alter table public.shipments      enable trigger trg_cash_shipment';
  raise;
end
$mig$;
