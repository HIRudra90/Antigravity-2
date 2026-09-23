import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabaseClient'
import { useLiveData } from '../lib/useLiveData'
import { useLocale } from '../lib/locale'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, Sector,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import {
  DollarSign, TrendingUp, TrendingDown, CreditCard, CheckCircle, Clock,
  RefreshCw, X, ArrowUpRight, ArrowDownRight, Wallet, Building2,
  ArrowRightLeft, Plus, Truck, Package, Users, UserCheck, AlertCircle, RotateCcw,
} from 'lucide-react'


function GlowSlice(props: any) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props
  return (
    <Sector
      cx={cx} cy={cy}
      innerRadius={innerRadius - 4}
      outerRadius={outerRadius + 14}
      startAngle={startAngle}
      endAngle={endAngle}
      fill={fill}
      style={{ filter: `drop-shadow(0 0 10px ${fill}) drop-shadow(0 0 22px ${fill}cc)` }}
    />
  )
}

// ─── Ledger date/time rendering ──────────────────────────────────────────────
// Every row renders from `sortAt` — the same instant the ledger is ordered by —
// in the timezone chosen in Settings. Mixing sources was what made a sale and
// the purchase order it triggered two seconds later read as different days:
// `sale_date` is a bare DATE that rendered as-is, while `ordered_at` is a
// timestamp the browser shifted into whatever zone the viewer happened to be in.
//
// The zone is one app-wide setting rather than the viewer's own clock, so the
// books read the same for everyone who opens them.

// The timezone the DATABASE resolves `current_date` in, which is what stamps
// sales_transactions.sale_date. Deliberately NOT the display timezone: this one
// is not a presentation choice, it has to match the server. The Supabase
// instance runs UTC (`current_setting('TimeZone')`). If that is ever changed,
// change this with it — comparing a sale's insert time against its business
// date in the wrong zone would misfile every sale made between midnight and
// 8am as backfilled history.
const DB_DATE_TZ = 'UTC'

/** YYYY-MM-DD for an instant, as seen from `tz`. */
const dayIn = (d: Date, tz: string) => d.toLocaleDateString('en-CA', { timeZone: tz })

/** Milliseconds for a timestamp string, 0 when absent or unparseable. */
const stampOf = (d: any) => { const t = new Date(d || 0).getTime(); return isNaN(t) ? 0 : t }

// Purchase orders and manual entries key off UUIDs, so their reference ran to
// 39 characters and pushed the rest of the ledger off screen. The prefix plus
// the first block stays unique enough to quote, and the full value is still in
// the detail modal.
const shortRef = (id: string) => {
  const [prefix, ...rest] = String(id || '').split('-')
  const tail = rest.join('-')
  return tail.length > 12 ? `${prefix}-${tail.slice(0, 8)}` : String(id || '')
}

function MiniStat({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div
      style={{ flex: '1 1 140px', padding: '16px 18px', borderRadius: 14, background: `${color}0d`, border: `1px solid ${color}33`, transition: 'box-shadow 0.2s, border-color 0.2s' }}
      onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = `0 0 0 1px ${color}66, 0 0 20px ${color}44`; el.style.borderColor = `${color}66` }}
      onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = ''; el.style.borderColor = `${color}33` }}
    >
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 5, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

const TABS = ['overview', 'ledger', 'vendors', 'payroll', 'reports'] as const
type Tab = typeof TABS[number]

/**
 * Only Active staff are paid. Inactive and On Leave employees are excluded
 * from payroll entirely — no salary_payments row is raised for them, they are
 * left out of the month's totals, and neither "Pay All Due" nor the per-row
 * Pay button will touch them.
 *
 * Kept as one helper so the rule cannot drift between the places that read it.
 */
const isPayable = (e: any) => (e?.status ?? '').trim().toLowerCase() === 'active'

function VendorHistoryModal({ vendor, orders, onClose, onConfirmDelivery, confirmingId }: { vendor: any; orders: any[]; onClose: () => void; onConfirmDelivery: (id: string) => void; confirmingId: string | null }) {
  const { moneyShort: fmt, fmtDate } = useLocale()
  const totalPaid = orders.filter(o => o.paid_at).reduce((a, o) => a + (Number(o.total_cost) || 0), 0)
  const sorted = [...orders].sort((a, b) => new Date(b.paid_at || b.ordered_at || 0).getTime() - new Date(a.paid_at || a.ordered_at || 0).getTime())
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: 640, maxHeight: '85vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>{vendor.company} — Order History</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
              {orders.length} order{orders.length !== 1 ? 's' : ''} · {fmt(totalPaid)} total paid
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '7px 11px', cursor: 'pointer', color: 'rgba(255,255,255,0.6)' }}><X size={16} /></button>
        </div>
        {sorted.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgba(255,255,255,0.3)' }}>
            <Package size={36} style={{ marginBottom: 12, opacity: 0.25, display: 'block', margin: '0 auto 12px' }} />
            <p>No orders placed with this vendor yet.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sorted.map((o, i) => {
              const items = Array.isArray(o.items) ? o.items : []
              const dColor = (o.status || '').toLowerCase() === 'delivered' ? '#22d3a8' : (o.status || '').toLowerCase() === 'cancelled' ? '#f43f5e' : '#f59e0b'
              return (
                <div key={o.id || i} style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#a78bfa', fontWeight: 700 }}>PO-{String(o.id || i).slice(-8).toUpperCase()}</span>
                    <span style={{ fontWeight: 800, color: o.paid_at ? '#22d3a8' : '#f59e0b', fontSize: 14 }}>{fmt(Number(o.total_cost) || 0)} {o.paid_at ? 'paid' : 'due on delivery'}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
                    Ordered {o.ordered_at ? fmtDate(o.ordered_at) : '—'}
                    {o.paid_at && <> · Paid {fmtDate(o.paid_at)}</>}
                    {o.expected_delivery && <> · ETA {fmtDate(o.expected_delivery)}</>}
                  </div>
                  {items.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                      {items.map((it: any, ii: number) => (
                        <div key={ii} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
                          <span>{it.product_name}{it.sku ? ` (${it.sku})` : ''} × {it.quantity}</span>
                          <span>{fmt((it.quantity || 0) * (it.unit_cost || 0))}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 4 }}>
                    <span style={{ fontSize: 10, padding: '3px 9px', borderRadius: 20, background: `${dColor}1e`, color: dColor, fontWeight: 700 }}>{o.status || 'Pending'} delivery</span>
                    {!['delivered', 'cancelled'].includes((o.status || '').toLowerCase()) && (
                      <button
                        disabled={confirmingId === o.id}
                        onClick={() => onConfirmDelivery(o.id)}
                        style={{ fontSize: 11, padding: '5px 10px', borderRadius: 7, background: 'rgba(34,211,168,0.14)', border: '1px solid rgba(34,211,168,0.4)', color: '#22d3a8', fontWeight: 600, cursor: confirmingId === o.id ? 'wait' : 'pointer', opacity: confirmingId === o.id ? 0.6 : 1 }}
                      >
                        {confirmingId === o.id ? '⏳ Confirming…' : '✓ Confirm Delivery'}
                      </button>
                    )}
                  </div>
                  {o.notes && <div style={{ marginTop: 8, fontSize: 11, color: 'rgba(255,255,255,0.35)', fontStyle: 'italic' }}>{o.notes}</div>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

export default function Payment() {
  const locale = useLocale()
  const fmt = locale.moneyShort
  const { symbol, fmtDate } = locale

  // Both read the row's `sortAt` — the same instant the ledger is ordered by —
  // through the app-wide timezone, so ordering and labelling can never
  // disagree. A row with no known clock time shows a dash rather than a
  // fabricated one.
  const ledgerDate = (t: any, withYear = false) =>
    t?.sortAt ? locale.fmtDate(new Date(t.sortAt), withYear ? { year: '2-digit' } : undefined) : '—'
  const ledgerTime = (t: any) =>
    t?.hasTime && t?.sortAt ? locale.fmtTime(new Date(t.sortAt)) : '—'

  const [tab, setTab] = useState<Tab>('overview')
  const [loading, setLoading] = useState(true)
  // Set when fetchAll throws, so a half-populated page says so instead of
  // quietly reading zero everywhere.
  const [fetchError, setFetchError] = useState<string | null>(null)

  // Vendor whose bills are being settled right now, and the outcome of the
  // last attempt. One at a time: paying is a money movement, so the button
  // locks rather than queueing clicks.
  const [payingVendor, setPayingVendor] = useState<string | null>(null)
  const [undoing, setUndoing] = useState(false)
  const [payResult, setPayResult] = useState<
    { ok: boolean; msg: string; orderIds?: string[] } | null
  >(null)

  // Financial totals
  // totalRevenue is derived from the server aggregate further down, NOT held
  // in state. See the note where it is computed: summing the fetched sales
  // array compared 200 rows of revenue against a full-epoch expense total.
  const [totalShipping, setTotalShipping] = useState(0)
  const [totalProcurement, setTotalProcurement] = useState(0)

  // Chart data
  const [monthlyData, setMonthlyData] = useState<any[]>([])
  const [expenseBreakdown, setExpenseBreakdown] = useState<any[]>([])

  // Ledger
  const [allTransactions, setAllTransactions] = useState<any[]>([])
  const [ledgerFilter, setLedgerFilter] = useState<'all' | 'income' | 'expense' | 'pending'>('all')

  // Vendors
  const [vendors, setVendors] = useState<any[]>([])
  const [vendorOrders, setVendorOrders] = useState<any[]>([])
  // Exact procurement figures, aggregated server-side. The page only fetches a
  // 200-row page of restock_orders, so anything counted from that list alone
  // was wrong once the table outgrew it.
  const [procOverview, setProcOverview] = useState<any>(null)
  // Expense totals counted from the accounting epoch (books_opened_at).
  const [expenses, setExpenses] = useState<any>(null)
  const [vendorSummary, setVendorSummary] = useState<Record<string, any>>({})
  // Money actually paid out, per payment event — the record of "I sent this
  // much to this vendor on this day".
  const [vendorPayments, setVendorPayments] = useState<any[]>([])
  const [vendorFilter, setVendorFilter] = useState<'all' | 'outstanding' | 'settled'>('all')
  const [vendorSearch, setVendorSearch] = useState('')

  // Payroll
  const [employees, setEmployees] = useState<any[]>([])
  const [salaryPayments, setSalaryPayments] = useState<any[]>([])
  const [payingEmp, setPayingEmp] = useState<string | null>(null)
  const [payingAll, setPayingAll] = useState(false)
  const [totalPayroll, setTotalPayroll] = useState(0)
  // Salaries actually PAID since the epoch. Distinct from totalPayroll, which
  // is the monthly headcount cost: an unpaid salary is a commitment, not an
  // incurred expense, and counting it would leave Total Expenses non-zero the
  // moment the books were opened.
  const [payrollExpense, setPayrollExpense] = useState(0)
  const [historyVendor, setHistoryVendor] = useState<any | null>(null)
  const [confirmingDelivery, setConfirmingDelivery] = useState<string | null>(null)
  const [activeExpenseIdx, setActiveExpenseIdx] = useState<number | null>(null)
  const [hoverExpenseIdx, setHoverExpenseIdx] = useState<number | null>(null)

  // Spendable cash. Derived from the cash_ledger, never a typed-in figure:
  // every sale credits it and every payment debits it through database
  // triggers, so it reflects what actually happened rather than what was last
  // entered by hand.
  const [cash, setCash] = useState<{
    balance: number; total_in: number; total_out: number
    deposits: number; cashouts: number; revenue: number; spending: number
    movements: number
    month_in: number; month_out: number; month_net: number; prev_month_net: number
  } | null>(null)
  const [cashMoves, setCashMoves] = useState<any[]>([])
  const [moneyModal, setMoneyModal] = useState<'deposit' | 'cashout' | null>(null)
  const [moneyAmount, setMoneyAmount] = useState('')
  const [moneyNote, setMoneyNote] = useState('')
  const [moneyBusy, setMoneyBusy] = useState(false)
  const [moneyErr, setMoneyErr] = useState('')

  const cashBalance = cash?.balance ?? 0
  const negative = cashBalance < 0

  // Modals
  const [selectedTxn, setSelectedTxn] = useState<any | null>(null)
  const [showRecord, setShowRecord] = useState(false)
  const [recForm, setRecForm] = useState({ description: '', amount: '', type: 'expense', vendor: '' })
  const [recSuccess, setRecSuccess] = useState(false)
  const [selectedKpi, setSelectedKpi] = useState<string | null>(null)

  useEffect(() => {
    fetchAll()
    fetchCashBalance()
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSelectedTxn(null); setShowRecord(false); setSelectedKpi(null); setMoneyModal(null); setHistoryVendor(null) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // Revenue, procurement spend and payroll all move from other pages and from
  // the agents, so this page has to follow the data rather than snapshot it.
  useLiveData(
    'payment-live',
    ['sales_transactions', 'restock_orders', 'salary_payments', 'employees', 'shipments', 'vendors', 'cash_ledger'],
    () => { fetchAll({ silent: true }); fetchCashBalance() },
  )

  async function confirmDelivery(orderId: string) {
    setConfirmingDelivery(orderId)
    const order = vendorOrders.find((o: any) => o.id === orderId)
    const updates: any = { status: 'Delivered' }
    // Safety net: if this order somehow never got a payment timestamp
    // (e.g. placed before paid_at existed), back-fill it now.
    if (!order?.paid_at) updates.paid_at = new Date().toISOString()
    const { error } = await supabase.from('restock_orders').update(updates).eq('id', orderId)
    if (error) console.error('confirmDelivery failed:', error.message)
    // Silent: the row is already updated, so a full-page spinner here just
    // makes settling a bill feel like a reload. Every other page picks the
    // change up through its restock_orders subscription.
    await fetchAll({ silent: true })
    setConfirmingDelivery(null)
  }

  /**
   * Settles every outstanding bill for one vendor.
   *
   * The work happens in pay_vendor_dues() rather than here, because a payment
   * has to be one atomic decision: selecting the unpaid bills in the browser
   * and writing them back would let the autopay agent settle one of them in
   * the gap, and the row-level lock in the function is what prevents paying
   * the same bill twice. The cash debit, the "bill settled" notification and
   * the overdraft alert all follow from database triggers.
   */
  async function payVendorDues(vendorId: string, company: string, outstanding: number) {
    if (outstanding <= 0 || payingVendor) return

    // No confirm dialog. The button was asked to pay in one click, and a
    // browser confirm() both adds a second click and cannot be styled. The
    // safeguard is Undo in the result banner instead — a confirm interrupts
    // every correct payment and gets dismissed reflexively, whereas an undo
    // is there for the mistake that actually happened.
    setPayingVendor(vendorId)
    setPayResult(null)
    try {
      const { data, error } = await supabase.rpc('pay_vendor_dues', { p_vendor_id: vendorId })
      if (error) throw error
      const res: any = data || {}
      const count = Number(res.paid_count ?? 0)
      setPayResult(count === 0
        // Not an error: the autopay agent may have settled these between the
        // page loading and the click.
        ? { ok: true, msg: `${company} had nothing left to pay.` }
        : {
            ok: true,
            msg: `Paid ${company} ${fmt(Number(res.paid_amount) || 0)} across ${count} bill${count === 1 ? '' : 's'}.`,
            // Exactly the bills this click settled, so an undo can never
            // reverse one that something else paid in the meantime.
            orderIds: Array.isArray(res.order_ids) ? res.order_ids : [],
          })
      await Promise.all([fetchAll({ silent: true }), fetchCashBalance()])
    } catch (err: any) {
      console.error('pay_vendor_dues failed:', err)
      setPayResult({ ok: false, msg: err?.message || 'The payment could not be completed.' })
    } finally {
      setPayingVendor(null)
    }
  }

  /** Reverses a payment: bills unpaid, cash returned, settled notice removed. */
  async function undoPayment(orderIds: string[]) {
    if (!orderIds.length || undoing) return
    setUndoing(true)
    try {
      const { data, error } = await supabase.rpc('undo_vendor_payment', { p_order_ids: orderIds })
      if (error) throw error
      const n = Number((data as any)?.undone_count ?? 0)
      setPayResult({ ok: true, msg: `Payment reversed — ${n} bill${n === 1 ? '' : 's'} is unpaid again and the money is back in your balance.` })
      await Promise.all([fetchAll({ silent: true }), fetchCashBalance()])
    } catch (err: any) {
      console.error('undo_vendor_payment failed:', err)
      setPayResult({ ok: false, msg: err?.message || 'The payment could not be reversed.' })
    } finally {
      setUndoing(false)
    }
  }

  async function fetchCashBalance() {
    const [{ data: bal }, { data: moves }] = await Promise.all([
      supabase.rpc('get_cash_balance'),
      supabase.from('cash_ledger').select('*').order('created_at', { ascending: false }).limit(60),
    ])
    const row: any = Array.isArray(bal) ? bal[0] : bal
    setCash(row ? {
      balance: Number(row.balance) || 0,
      total_in: Number(row.total_in) || 0,
      total_out: Number(row.total_out) || 0,
      deposits: Number(row.deposits) || 0,
      cashouts: Number(row.cashouts) || 0,
      revenue: Number(row.revenue) || 0,
      spending: Number(row.spending) || 0,
      movements: Number(row.movements) || 0,
      month_in: Number(row.month_in) || 0,
      month_out: Number(row.month_out) || 0,
      month_net: Number(row.month_net) || 0,
      prev_month_net: Number(row.prev_month_net) || 0,
    } : null)
    setCashMoves((moves as any[]) || [])
  }

  /** Add money to, or take money out of, the spendable balance. */
  async function submitMoney() {
    const amount = parseFloat(moneyAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setMoneyErr('Enter an amount greater than zero.')
      return
    }
    setMoneyBusy(true)
    setMoneyErr('')
    const { error } = await supabase.rpc(
      moneyModal === 'cashout' ? 'cash_withdraw' : 'cash_deposit',
      { p_amount: amount, p_note: moneyNote || null },
    )
    if (error) {
      setMoneyErr(error.message)
    } else {
      setMoneyModal(null)
      setMoneyAmount('')
      setMoneyNote('')
      await fetchCashBalance()
    }
    setMoneyBusy(false)
  }

  // saveCashBalance is gone deliberately: the balance is no longer a figure
  // anyone types. It is the sum of the ledger, so it changes only by adding
  // money, cashing out, or a real sale or payment happening.

  async function fetchAll({ silent = false }: { silent?: boolean } = {}) {
    if (!silent) setLoading(true)
    try {
      setFetchError(null)
      const now = new Date()
      const currentMonth = now.getMonth() + 1
      const currentYear  = now.getFullYear()

      const [
        { data: sales },
        { data: shipments },
        { data: restockRaw },
        { data: vendorData },
        { data: empData },
        { data: salaryData },
        { data: manualRaw },
        { data: procRows },
        { data: vendorRollup },
        { data: paymentFeed },
        { data: expenseRows },
      ] = await Promise.all([
        // `id` breaks the tie: sale_date is a DATE, so a whole day's rows
        // compare equal and a just-placed order could fall outside the 200
        // this page keeps.
        supabase.from('sales_transactions')
          .select('id, sale_date, created_at, quantity_sold, products(name, unit_price, family)')
          .order('sale_date', { ascending: false })
          .order('id', { ascending: false })
          .limit(200),
        supabase.from('shipments')
          .select('id, tracking_no, carrier, status_code, price, created_at, recipient_city')
          .order('created_at', { ascending: false }).limit(200),
        supabase.from('restock_orders').select('*').order('ordered_at', { ascending: false }).limit(200),
        supabase.from('vendors').select('*'),
        supabase.from('employees').select('*').order('name'),
        supabase.from('salary_payments').select('*')
          .eq('payment_month', currentMonth).eq('payment_year', currentYear),
        // Was public.financial_transactions — a table that does not exist in
        // this database, so every manual entry silently went nowhere. Manual
        // money movements are cash_ledger rows now.
        supabase.from('cash_ledger')
          .select('*')
          .in('kind', ['deposit', 'cashout', 'adjustment'])
          .order('created_at', { ascending: false }).limit(200),
        supabase.rpc('get_procurement_overview'),
        supabase.rpc('get_vendor_payment_summary'),
        supabase.rpc('get_vendor_payments', { p_limit: 50 }),
        supabase.rpc('get_expense_overview'),
      ])

      // The accounting epoch. Everything before it is retained in the tables
      // but excluded from every expense figure, so the books can be opened at
      // a chosen moment without destroying history.
      const exp0: any = Array.isArray(expenseRows) ? expenseRows[0] : expenseRows
      setExpenses(exp0 || null)
      const epoch = exp0?.opened_at ? new Date(exp0.opened_at).getTime() : 0

      const proc0 = Array.isArray(procRows) ? procRows[0] : procRows
      setProcOverview(proc0 || null)
      setVendorSummary(Object.fromEntries(
        ((vendorRollup as any[]) || []).map(r => [r.vendor_id, r]),
      ))
      setVendorPayments((paymentFeed as any[]) || [])

      // `sale_date` is a DATE, so `new Date('2026-09-19')` is midnight UTC.
      // Every sale therefore sorted below any expense from the same day that
      // carries a real timestamp, and today's sales sank beneath a purchase
      // order raised minutes later. Sorting by `created_at` instead is wrong
      // too: the backfilled history was inserted in bulk days after the dates
      // it represents. So take the *day* from sale_date and the *clock time*
      // from created_at — business date preserved, sensible ordering within it.
      // `exact` records whether we actually know a clock time. Rows that only
      // carry a business date get a sort anchor but must not display a
      // fabricated time.
      //
      // Declared here, above its first use. It used to sit further down, below
      // the epoch filter that calls it — and because that call is inside a
      // `.filter` callback, TypeScript accepted it (a closure *might* run
      // later) while `.filter` in fact invokes it immediately, hitting the
      // const's temporal dead zone. The resulting ReferenceError aborted this
      // function partway, so every figure assigned after that line stayed at
      // its initial value: revenue, expenses, vendors, payroll and the P&L
      // report all read zero while the cards populated earlier looked fine.
      const saleStamp = (s: any): { at: number; exact: boolean } => {
        const day = String(s.sale_date || '').slice(0, 10)
        if (!day) return { at: 0, exact: false }
        const created = s.created_at ? new Date(s.created_at) : null
        // created_at is the real moment only when it lands on the sale's own
        // day. Where it doesn't, the row came from the bulk history backfill
        // and its insert time says nothing about when the sale happened.
        if (created && !isNaN(created.getTime()) && dayIn(created, DB_DATE_TZ) === day) {
          return { at: created.getTime(), exact: true }
        }
        // Midday, so a historical sale sorts within its day rather than at the
        // midnight boundary it would otherwise share with every dated record.
        const noon = new Date(`${day}T12:00:00Z`).getTime()
        return { at: isNaN(noon) ? 0 : noon, exact: false }
      }

      // Rows from before the epoch are dropped here, so the ledger, the monthly
      // chart and the breakdowns all agree with the totals instead of showing
      // history the books no longer count.
      //
      // Sales are filtered too. They used to be exempt, which left Total
      // Revenue at $60.5M against $0 of expenses and a nonsensical 100% margin
      // the moment the books were reopened. Resetting one side of a P&L is not
      // a reset. saleStamp is used rather than sale_date so a sale is placed at
      // the moment it actually happened.
      const salesArr   = ((sales as any[]) || []).filter(s => saleStamp(s).at >= epoch)
      const shipArr    = ((shipments  as any[]) || []).filter(s => stampOf(s.created_at) >= epoch)
      const restockArr = ((restockRaw as any[]) || []).filter(r => stampOf(r.ordered_at) >= epoch)
      const vendorArr  = (vendorData as any[]) || []
      const empArr     = (empData    as any[]) || []
      const salArr     = (salaryData as any[]) || []
      const manualArr  = (manualRaw  as any[]) || []

      // ── Manual cash movements (Add Money / Cash Out).
      // cash_ledger speaks direction 'in'/'out'; the ledger below speaks
      // 'income'/'expense'. Translated here rather than at every consumer.
      let manualIncome = 0, manualExpense = 0
      const manualLedger = manualArr.map((m: any, i: number) => {
        const amt = Math.round(Number(m.amount) || 0)
        const isIn = m.direction === 'in'
        if (isIn) manualIncome += amt
        else manualExpense += amt
        return {
          id: `CASH-${m.id || i}`,
          type: isIn ? 'income' : 'expense',
          category: isIn ? 'Money added' : 'Cash out',
          description: m.description || (isIn ? 'Money added' : 'Cash withdrawn'),
          amount: amt,
          date: m.created_at,
          sortAt: new Date(m.created_at || 0).getTime() || 0,
          hasTime: !!m.created_at,
          status: 'Completed',
          vendor: '',
        }
      })

      // Raise salary_payments rows only for Active staff. Inactive and On
      // Leave employees should never appear as owing or paid, so no row is
      // created for them in the first place.
      const missingEmpIds = empArr
        .filter(e => isPayable(e) && !salArr.find((s: any) => s.employee_id === e.id))
        .map(e => e.id)
      if (missingEmpIds.length > 0) {
        await supabase.from('salary_payments').insert(
          missingEmpIds.map(id => {
            const emp = empArr.find(e => e.id === id)
            return { employee_id: id, amount: emp?.monthly_salary || 0, payment_month: currentMonth, payment_year: currentYear, status: 'Due' }
          })
        )
        const { data: refreshed } = await supabase.from('salary_payments').select('*').eq('payment_month', currentMonth).eq('payment_year', currentYear)
        setSalaryPayments((refreshed as any[]) || salArr)
      } else {
        setSalaryPayments(salArr)
      }

      setEmployees(empArr)
      // Monthly payroll cost is what Active staff are owed. Including Inactive
      // and On Leave employees overstated it and dragged the profit line down.
      const payroll = empArr.filter(isPayable).reduce((a: number, e: any) => a + Number(e.monthly_salary || 0), 0)
      setTotalPayroll(payroll)
      setPayrollExpense(Math.round(Number(exp0?.payroll_paid ?? 0) || 0))

      const stamp = stampOf

      // ── Revenue ledger (display rows only)
      //
      // These are the sales rows this page fetched for its transaction list,
      // and that query carries `.limit(200)`. Their total is NOT the
      // business's revenue and there is deliberately no running sum here any
      // more — one used to feed the Total Revenue card, which is how a display
      // limit became an accounting figure. totalRevenue comes from the
      // server-side ledger aggregate instead; see its derivation below.
      const saleLedger = salesArr.map(s => {
        const p = Array.isArray(s.products) ? s.products[0] : s.products
        const amount = Math.round((s.quantity_sold || 0) * parseFloat(p?.unit_price || '0'))
        const { at, exact } = saleStamp(s)
        return { id: `TXN-${s.id}`, type: 'income', category: 'Sale', description: p?.name || 'Product Sale', family: p?.family || '', amount, date: s.sale_date, sortAt: at, hasTime: exact, status: 'Completed' }
      })
      // Money you add is capital, not a sale. It raises the spendable balance
      // and appears in the flow below, but counting it as revenue would flatter
      // the profit figure with your own deposits.

      // ── Shipping ledger
      let ship = 0
      const shipLedger = shipArr.map(s => {
        const cost = parseFloat(s.price || '0')
        ship += cost
        return { id: `SHP-${s.id}`, type: 'expense', category: 'Shipping', description: `${s.carrier || 'Carrier'} · ${s.recipient_city || 'Delivery'}`, amount: Math.round(cost), date: s.created_at, sortAt: stamp(s.created_at), hasTime: !!s.created_at, status: Number(s.status_code) >= 700 ? 'Completed' : Number(s.status_code) >= 500 ? 'In Transit' : 'Pending' }
      })
      setTotalShipping(Math.round(Number(exp0?.shipping ?? ship) || 0))

      // ── Procurement ledger
      let proc = 0
      const procLedger = restockArr.map((r, i) => {
        const amount = Math.round(Number(r.total_cost) || 0)
        proc += amount
        const firstItem = Array.isArray(r.items) && r.items[0] ? r.items[0].product_name : null
        const itemCount = Array.isArray(r.items) ? r.items.length : 0
        const vendorLabel = r.vendor_name || vendorArr.find((v: any) => v.id === r.vendor_id)?.name || 'Vendor'
        const description = firstItem
          ? (itemCount > 1 ? `${firstItem} +${itemCount - 1} more · ${vendorLabel}` : `${firstItem} · ${vendorLabel}`)
          : `Purchase Order · ${vendorLabel}`
        // A purchase order sits in the ledger on the day money moved. Unpaid,
        // that is the order date — a bill raised. Once settled it becomes
        // paid_at, so the payment surfaces at the top of Recent Money Flow the
        // moment you make it. Previously a bill raised weeks earlier stayed
        // buried at its original date after you paid it, which is why paying a
        // vendor appeared to change nothing.
        const at = r.paid_at || r.ordered_at || r.created_at || r.eta
        return {
          id: `PO-${r.id || i}`, type: 'expense', category: 'Procurement',
          description: r.paid_at ? `Paid · ${description}` : description,
          amount, date: at, sortAt: stamp(at),
          hasTime: !!(r.paid_at || r.ordered_at || r.created_at),
          status: r.paid_at ? 'Completed' : 'Pending',
          vendor: vendorLabel,
          orderedAt: r.ordered_at || r.created_at || null,
          paidAt: r.paid_at || null,
        }
      })
      // Spend totals come from the server-side aggregates: the ledger only
      // fetches 200 restock_orders, and these figures must cover the whole
      // table from the epoch onward.
      // A cashout is money leaving the account, not procurement. It reduces the
      // balance; adding it here would report it as a cost of doing business.
      const procCommitted = Number(exp0?.procurement ?? proc0?.total_committed ?? proc) || 0
      setTotalProcurement(Math.round(procCommitted))

      // ── Payroll ledger entries (must be defined before combined)
      // Active staff only. This was mapping over every employee, so Nasir Alam
      // (Inactive) and Sizen Miller (On Leave) showed as $5,000 of pending
      // payroll in the money flow — the same phantom debt already removed from
      // the Employees and Payment summaries.
      const payrollLedger = empArr.filter(isPayable).map((e: any) => {
        const sp = salArr.find((s: any) => s.employee_id === e.id)
        const payDate = sp?.paid_at || new Date(currentYear, currentMonth - 1, 1).toISOString()
        return {
          id: `SAL-${e.id}`,
          type: 'expense',
          category: 'Payroll',
          description: `${e.name} — ${e.role}`,
          amount: Number(e.monthly_salary || 0),
          date: payDate,
          sortAt: stamp(payDate),
          // An unpaid row has no payment moment yet — payDate is a synthesised
          // 1st-of-month placeholder, so there is no real time to show.
          hasTime: !!sp?.paid_at,
          status: sp?.status === 'Paid' ? 'Completed' : 'Pending',
          vendor: '',
        }
      })

      // ── Combined ledger sorted by date
      // Every source array is already epoch-filtered, income included, so the
      // ledger adds up to the totals shown above it.
      const combined = [...saleLedger, ...shipLedger, ...procLedger, ...payrollLedger, ...manualLedger]
        .filter((t: any) => (t.sortAt || 0) >= epoch)
        .sort((a: any, b: any) => (b.sortAt || 0) - (a.sortAt || 0))
      setAllTransactions(combined)

      // ── Monthly chart
      //
      // Aggregated server-side, NOT bucketed from the arrays above. Those are
      // the page's display fetches and each carries .limit(200); six months of
      // history drawn from the most recent 200 sales is about a day and a half
      // of trading in the newest bar and nothing in the other five. Same
      // defect that made the Total Revenue card read $225,158 against $23.7M
      // of expenses -- a page limit standing in for an accounting figure.
      const { data: flowRows } = await supabase.rpc('get_monthly_cashflow', { p_months: 6 })
      const flowByMonth: Record<string, { income: number; expenses: number }> = {}
      for (const r of (flowRows as any[]) || []) {
        const d = new Date(r.month_start + 'T00:00:00')
        flowByMonth[`${d.getFullYear()}-${d.getMonth()}`] = {
          income: Number(r.income) || 0,
          expenses: Number(r.expenses) || 0,
        }
      }

      const last6: { key: string; label: string }[] = []
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        last6.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleString('en', { month: 'short' }) })
      }

      // The four per-month buckets that used to be built here -- revByMonth,
      // shipByMonth, procByMonth and payByMonth -- are gone. Each one summed a
      // page fetch capped at 200 rows, which is why the chart under a $397M
      // business could only ever draw about a day and a half of trading. Every
      // movement they were reconstructing is already a cash_ledger row, so
      // get_monthly_cashflow aggregates the ledger directly and the numbers
      // cannot drift from the totals above them again.

      setMonthlyData(last6.map(({ key, label }) => {
        const f = flowByMonth[key] || { income: 0, expenses: 0 }
        const income   = Math.round(f.income)
        const expenses = Math.round(f.expenses)
        return { month: label, income, expenses, profit: income - expenses }
      }))

      // ── Expense breakdown (payroll = actually paid since the epoch)
      const payrollTotal = Number(exp0?.payroll_paid ?? 0) || 0
      setExpenseBreakdown([
        { name: 'Payroll',     value: Math.max(Math.round(payrollTotal), 1), color: '#a78bfa' },
        { name: 'Procurement', value: Math.max(Math.round(procCommitted), 1), color: '#f43f5e' },
        { name: 'Shipping',    value: Math.max(Math.round(Number(exp0?.shipping ?? ship) || 0), 1), color: '#f59e0b' },
        // "Operations" used to sit here as Math.round(rev * 0.04) — a slice of
        // the expense donut computed from revenue, with no rent, utility or
        // overhead record behind it anywhere in the database. It moved when
        // revenue moved and never when a cost was incurred, which is the
        // opposite of what an expense does. The breakdown now shows the three
        // categories the cash ledger actually records.
      ])

      setVendors(vendorArr)
      setVendorOrders(restockArr)
    } catch (err: any) {
      // Surfaced, not just logged. This function assigns roughly thirty pieces
      // of state; a throw partway leaves every figure after it at its initial
      // value, and a page of zeros is indistinguishable from a correct page
      // just after the books were reset. That is how a ReferenceError here sat
      // unnoticed behind plausible-looking $0 cards.
      console.error('Payment fetch:', err)
      setFetchError(err?.message || String(err))
    } finally {
      if (!silent) setLoading(false)
    }
  }

  // Revenue comes from the cash ledger's server-side total, scoped to the same
  // accounting epoch the expense figures use.
  //
  // It used to be the sum of `salesArr`, the sales rows this page fetches for
  // its transaction list — and that query carries `.limit(200)`. So the card
  // compared about ninety minutes of revenue against a full-epoch expense
  // aggregate, and reported a catastrophic loss on a profitable business:
  // $225,158 of revenue against $23,769,701 of expenses, a net of -$23.5M,
  // when actual revenue over the same window was $397,328,233.
  //
  // A display limit had become an accounting figure. Both sides of this
  // subtraction now come from the same server-side aggregate, so raising or
  // lowering the transaction list's page size cannot move the P&L again.
  const totalRevenue   = Math.round(cash?.revenue ?? 0)

  // Payroll contributes what has actually been paid since the books opened,
  // not the standing monthly cost.
  const totalExpenses  = totalShipping + totalProcurement + payrollExpense
  const netProfit      = totalRevenue - totalExpenses
  const profitMargin   = totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 1000) / 10 : 0
  // Real money in minus money out this calendar month, from the cash ledger.
  // This was `totalRevenue * 0.13` — 13% of revenue is not cash flow, and it
  // moved only when revenue did.
  const cashFlow       = cash?.month_net ?? 0
  const cashFlowPrev   = cash?.prev_month_net ?? 0
  const cashFlowDelta  = cashFlowPrev !== 0
    ? Math.round(((cashFlow - cashFlowPrev) / Math.abs(cashFlowPrev)) * 1000) / 10
    : null

  // Expense Breakdown donut — detail panel metadata per category
  const expenseTotal  = expenseBreakdown.reduce((a, x) => a + x.value, 0)
  // Hover previews on top of whatever's pinned by a click; leaving the chart
  // falls back to the pinned slice instead of clearing the panel.
  const displayExpenseIdx = hoverExpenseIdx ?? activeExpenseIdx
  const activeExpense = displayExpenseIdx !== null ? expenseBreakdown[displayExpenseIdx] : null
  const activeExpensePct = activeExpense && expenseTotal > 0 ? Math.round((activeExpense.value / expenseTotal) * 100) : 0
  const expenseMetaFor = (name: string) => {
    const shippingCount = allTransactions.filter(t => t.category === 'Shipping').length
    const map: Record<string, { count: number; tier: string; insight: string }> = {
      Payroll: {
        count: employees.length,
        tier: 'Fixed Cost',
        insight: `${employees.length} employee${employees.length !== 1 ? 's' : ''} on payroll. Recurring monthly cost — pay from the Payroll tab.`,
      },
      Procurement: {
        count: vendorOrders.length,
        tier: 'Variable Cost',
        insight: `${vendorOrders.length} purchase order${vendorOrders.length !== 1 ? 's' : ''} across ${vendors.length} vendor${vendors.length !== 1 ? 's' : ''}. Paid once delivery is confirmed.`,
      },
      Shipping: {
        count: shippingCount,
        tier: 'Variable Cost',
        insight: `${shippingCount} shipment${shippingCount !== 1 ? 's' : ''} booked. Tracked live from the Logistics page.`,
      },

    }
    const meta = map[name] || { count: 0, tier: 'Expense', insight: '' }
    const value = expenseBreakdown.find(e => e.name === name)?.value || 0
    const avg = meta.count > 0 ? value / meta.count : 0
    const revenuePct = totalRevenue > 0 ? Math.round((value / totalRevenue) * 1000) / 10 : 0
    return { ...meta, avg, revenuePct, value }
  }
  const activeExpenseMeta = activeExpense ? expenseMetaFor(activeExpense.name) : null

  const filteredLedger = allTransactions.filter(t => {
    if (ledgerFilter === 'income')  return t.type === 'income'
    if (ledgerFilter === 'expense') return t.type === 'expense'
    if (ledgerFilter === 'pending') return t.status === 'Pending'
    return true
  })

  const kpiCards = [
    // change was a hardcoded '+12.4%' that never moved. With the books freshly
    // opened it would have claimed growth against a period that is no longer
    // counted, so it now reports what actually happened.
    { label: 'Total Revenue',   value: fmt(totalRevenue),         color: '#22d3a8',
      sub: expenses?.opened_at ? `Since ${locale.fmtDate(expenses.opened_at)}` : 'All sales income',
      icon: TrendingUp,
      change: totalRevenue === 0 ? 'books opened' : fmt(totalRevenue), up: true },
    // The subtitle names the epoch so a zero total reads as "the books just
    // opened" rather than "something is broken".
    { label: 'Total Expenses',  value: fmt(totalExpenses),        color: '#f43f5e',
      sub: expenses?.opened_at ? `Since ${locale.fmtDate(expenses.opened_at)}` : 'Payroll + Procurement + Shipping',
      icon: TrendingDown,
      change: totalExpenses === 0 ? 'books opened' : fmt(totalExpenses), up: false },
    { label: 'Net Profit',      value: fmt(Math.abs(netProfit)),  color: netProfit >= 0 ? '#6C63FF' : '#f43f5e', sub: `${profitMargin >= 0 ? '+' : ''}${profitMargin}% margin`, icon: Wallet, change: `${profitMargin}%`, up: netProfit >= 0 },
    { label: 'Monthly Cash Flow', value: fmt(cashFlow),           color: '#00D4FF',
      sub: (cash?.movements ?? 0) === 0
        ? 'No cash movements yet'
        : `${fmt(cash?.month_in ?? 0)} in · ${fmt(cash?.month_out ?? 0)} out`,
      icon: ArrowRightLeft,
      change: cashFlowDelta !== null ? `${cashFlowDelta >= 0 ? '+' : ''}${cashFlowDelta}%` : 'this month',
      up: cashFlow >= 0 },
  ]

  const tabLabels: Record<Tab, string> = {
    overview: 'Overview',
    ledger:   'Ledger',
    vendors:  'Vendor Payments',
    payroll:  'Payroll',
    reports:  'P&L Reports',
  }

  const categoryColor = (cat: string) =>
    cat === 'Sale' ? '#22d3a8' : cat === 'Shipping' ? '#f59e0b' : cat === 'Payroll' ? '#a78bfa' : '#f43f5e'

  return (
    <div className="page-enter">

      {/* Header */}
      <div className="page-header page-header-row">
        <div>
          <h1>Financial Control Center</h1>
          <p>Complete money flow — revenue, expenses, vendor payments &amp; profit reports</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => fetchAll()}><RefreshCw size={14} /></button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => { setRecForm({ description: '', amount: '', type: 'expense', vendor: '' }); setRecSuccess(false); setShowRecord(true) }}
          >
            <Plus size={14} /> Record Payment
          </button>
        </div>
      </div>

      {fetchError && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 18,
          padding: '12px 16px', borderRadius: 'var(--r-md)',
          background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.3)',
        }}>
          <AlertCircle size={16} color="#f43f5e" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#f43f5e' }}>
              These figures are incomplete — loading the financial data failed.
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 3, wordBreak: 'break-word' }}>
              {fetchError} · Any $0 below may be a failure, not a real total.
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', flexShrink: 0 }}
            onClick={() => fetchAll()}>Retry</button>
        </div>
      )}

      {/* KPI cards */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 22, flexWrap: 'wrap' }}>
        {kpiCards.map(card => (
          <div
            key={card.label}
            className="stat-card"
            style={{ flex: '1 1 190px', '--card-glow': `${card.color}33`, transition: 'box-shadow 0.25s ease, transform 0.18s ease', cursor: 'pointer', position: 'relative' } as any}
            onClick={() => setSelectedKpi(card.label)}
            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = `0 0 0 1px ${card.color}99, 0 0 30px ${card.color}77, 0 0 60px ${card.color}44`; el.style.transform = 'translateY(-3px)' }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = ''; el.style.transform = '' }}
          >
            <div className="stat-card-icon"><card.icon size={18} color={card.color} /></div>
            <div className="stat-card-label">{card.label}</div>
            <div className="stat-card-value">{loading ? '—' : card.value}</div>
            <div className={`stat-card-change ${card.up ? 'text-success' : 'text-danger'}`}>
              {card.up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />} {card.change}
            </div>
            <div style={{ fontSize: 10, color: `${card.color}99`, marginTop: 5 }}>{card.sub}</div>
            <div style={{ fontSize: 9, color: `${card.color}66`, marginTop: 10, fontWeight: 600, letterSpacing: 0.5 }}>Click for details →</div>
          </div>
        ))}
      </div>

      {/* Spendable cash account */}
      <div style={{ marginBottom: 22, padding: '20px 24px', borderRadius: 16, background: negative ? 'rgba(244,63,94,0.06)' : 'rgba(34,211,168,0.06)', border: `1px solid ${negative ? 'rgba(244,63,94,0.28)' : 'rgba(34,211,168,0.2)'}`, display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap', transition: 'box-shadow 0.2s' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = negative ? '0 0 0 1px rgba(244,63,94,0.45), 0 0 24px rgba(244,63,94,0.15)' : '0 0 0 1px rgba(34,211,168,0.4), 0 0 24px rgba(34,211,168,0.15)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '' }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: negative ? 'rgba(244,63,94,0.15)' : 'rgba(34,211,168,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Wallet size={20} color={negative ? '#f43f5e' : '#22d3a8'} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 4, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Available to spend
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 28, fontWeight: 800, color: negative ? '#f43f5e' : '#22d3a8' }}>
              {fmt(cashBalance)}
            </span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { setMoneyModal('deposit'); setMoneyAmount(''); setMoneyNote(''); setMoneyErr('') }}
              style={{ fontSize: 12, color: '#22d3a8', borderColor: 'rgba(34,211,168,0.3)' }}
            >
              <Plus size={12} /> Add Money
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { setMoneyModal('cashout'); setMoneyAmount(''); setMoneyNote(''); setMoneyErr('') }}
              style={{ fontSize: 12, color: '#f59e0b', borderColor: 'rgba(245,158,11,0.3)' }}
            >
              <ArrowDownRight size={12} /> Cash Out
            </button>
          </div>
          {/* Where the figure came from, so it never has to be taken on trust. */}
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 6 }}>
            {fmt(cash?.deposits ?? 0)} added · {fmt(cash?.revenue ?? 0)} from sales ·
            {' '}{fmt(cash?.spending ?? 0)} spent · {fmt(cash?.cashouts ?? 0)} cashed out
          </div>
          {negative && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 8, fontSize: 12, color: '#f43f5e', fontWeight: 600 }}>
              <AlertCircle size={13} /> Overdrawn — add money to cover further spending.
            </div>
          )}
        </div>
        {/* Cash actually paid to vendors, alongside what is still owed. Both
            are click-throughs to the vendor tab, where the individual payments
            are listed. */}
        <div
          onClick={() => setTab('vendors')}
          title="View vendor payments"
          style={{ textAlign: 'right', flexShrink: 0, cursor: 'pointer' }}
        >
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>Paid to vendors</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#22d3a8' }}>
            {fmt(Number(procOverview?.paid_amount ?? 0))}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 2 }}>
            {fmt(Number(procOverview?.paid_this_month ?? 0))} this month
          </div>
        </div>
        <div
          onClick={() => setTab('vendors')}
          title="View outstanding bills"
          style={{ textAlign: 'right', flexShrink: 0, cursor: 'pointer' }}
        >
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>Owed to vendors</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: Number(procOverview?.outstanding ?? 0) > 0 ? '#f43f5e' : '#22d3a8' }}>
            {fmt(Number(procOverview?.outstanding ?? 0))}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 2 }}>
            {Number(procOverview?.open_orders ?? 0).toLocaleString()} unpaid bills
          </div>
        </div>
        {/* "After expenses" used to subtract totalExpenses from a hand-typed
            balance. The balance is now debited as each payment happens, so
            subtracting them again would double-count. What is useful instead is
            how much has moved through the account. */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>Money in / out</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#22d3a8' }}>
            {fmt(cash?.total_in ?? 0)}
            <span style={{ color: 'rgba(255,255,255,0.25)', fontWeight: 400 }}> / </span>
            <span style={{ color: '#f43f5e' }}>{fmt(cash?.total_out ?? 0)}</span>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 2 }}>
            {(cash?.movements ?? 0).toLocaleString()} movements
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 22, background: 'rgba(255,255,255,0.03)', padding: 6, borderRadius: 14, width: 'fit-content', border: '1px solid rgba(255,255,255,0.07)' }}>
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '8px 22px', borderRadius: 10, border: 'none', cursor: 'pointer',
              background: tab === t ? 'rgba(108,99,255,0.25)' : 'transparent',
              color: tab === t ? '#a78bfa' : 'rgba(255,255,255,0.4)',
              fontWeight: 600, fontSize: 13,
              boxShadow: tab === t ? '0 0 0 1px rgba(108,99,255,0.45), 0 0 16px rgba(108,99,255,0.2)' : 'none',
              transition: 'all 0.2s ease',
            }}
          >{tabLabels[t]}</button>
        ))}
      </div>

      {/* ══════════ TAB: OVERVIEW ══════════ */}
      {tab === 'overview' && (
        <>
          {/* Revenue vs Expenses area chart */}
          <div className="glass-card" style={{ marginBottom: 16 }}>
            <div className="section-title">
              Monthly Revenue vs Expenses
              <span className="badge badge-success">Live</span>
            </div>
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyData}>
                  <defs>
                    <linearGradient id="payIncGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#22d3a8" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#22d3a8" stopOpacity={0}    />
                    </linearGradient>
                    <linearGradient id="payExpGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#f43f5e" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}    />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `${symbol}${Math.round(v / 1000)}k`} />
                  <Tooltip
                    cursor={false}
                    contentStyle={{ background: 'rgba(5,8,16,0.96)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '10px 16px' }}
                    formatter={(v: any, name: string) => [`${symbol}${Number(v).toLocaleString()}`, name === 'income' ? 'Revenue' : 'Expenses']}
                  />
                  <Area type="monotone" dataKey="income"   stroke="#22d3a8" strokeWidth={2.5} fill="url(#payIncGrad)" name="income" dot={{ r: 4, fill: '#22d3a8' }} activeDot={{ r: 7, stroke: '#fff', strokeWidth: 1.5, filter: 'drop-shadow(0 0 8px #22d3a8)' }} />
                  <Area type="monotone" dataKey="expenses" stroke="#f43f5e" strokeWidth={2}   fill="url(#payExpGrad)" name="expenses" strokeDasharray="5 3" dot={{ r: 3, fill: '#f43f5e' }} activeDot={{ r: 6, stroke: '#fff', strokeWidth: 1.5 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: 'flex', gap: 20, marginTop: 14, justifyContent: 'center' }}>
              {[{ label: 'Revenue', color: '#22d3a8' }, { label: 'Expenses', color: '#f43f5e', dash: true }].map(l => (
                <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>
                  <svg width="24" height="3"><line x1="0" y1="1.5" x2="24" y2="1.5" stroke={l.color} strokeWidth="2.5" strokeDasharray={l.dash ? '5 3' : undefined} /></svg>
                  {l.label}
                </div>
              ))}
            </div>
          </div>

          {/* Expense Breakdown — full width with side detail panel (matches Carrier Usage style) */}
          <div className="glass-card" style={{ marginBottom: 16 }}>
            <div className="section-title" style={{ marginBottom: 16 }}>Expense Breakdown</div>
            <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
              {/* Donut chart */}
              <div style={{ flex: '0 0 260px' }}>
                <PieChart width={260} height={240}>
                  <Pie
                    data={expenseBreakdown}
                    cx="50%" cy="50%"
                    innerRadius={60} outerRadius={95}
                    paddingAngle={4}
                    dataKey="value"
                    activeIndex={displayExpenseIdx ?? undefined}
                    activeShape={GlowSlice}
                    onMouseEnter={(_, idx) => setHoverExpenseIdx(idx)}
                    onMouseLeave={() => setHoverExpenseIdx(null)}
                    onClick={(_, idx) => setActiveExpenseIdx(prev => prev === idx ? null : idx)}
                    style={{ cursor: 'pointer' }}
                  >
                    {expenseBreakdown.map((e, i) => (
                      <Cell
                        key={i}
                        fill={e.color}
                        opacity={displayExpenseIdx === null || displayExpenseIdx === i ? 1 : 0.3}
                        style={{ transition: 'opacity 0.2s ease' }}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    cursor={false}
                    contentStyle={{ background: 'rgba(5,8,16,0.96)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '8px 14px' }}
                    labelStyle={{ display: 'none' }}
                    itemStyle={{ color: '#fff' }}
                    wrapperStyle={{ outline: 'none' }}
                    formatter={(v: any, _: any, props: any) => {
                      const c = props?.payload?.color ?? '#fff'
                      return [<span style={{ color: c, fontWeight: 700 }}>{fmt(v)}</span>, <span style={{ color: '#fff', fontWeight: 600 }}>{props?.payload?.name}</span>]
                    }}
                  />
                </PieChart>

                {/* Legend dots */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', justifyContent: 'center' }}>
                  {expenseBreakdown.map((e, i) => {
                    const pct = expenseTotal > 0 ? Math.round((e.value / expenseTotal) * 100) : 0
                    return (
                      <div
                        key={e.name}
                        onClick={() => setActiveExpenseIdx(prev => prev === i ? null : i)}
                        onMouseEnter={() => setHoverExpenseIdx(i)}
                        onMouseLeave={() => setHoverExpenseIdx(null)}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer',
                          opacity: displayExpenseIdx === null || displayExpenseIdx === i ? 1 : 0.4,
                          transition: 'opacity 0.2s ease' }}
                      >
                        <div style={{ width: 9, height: 9, borderRadius: 3, background: e.color,
                          boxShadow: displayExpenseIdx === i ? `0 0 8px ${e.color}` : 'none',
                          transition: 'box-shadow 0.2s ease' }} />
                        <span style={{ color: displayExpenseIdx === i ? '#fff' : 'rgba(255,255,255,0.5)', fontWeight: displayExpenseIdx === i ? 700 : 400 }}>{e.name}</span>
                        <span style={{ color: e.color, fontWeight: 700 }}>{pct}%</span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Divider */}
              <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,0.07)', flexShrink: 0 }} />

              {/* Detail panel */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {activeExpense && activeExpenseMeta ? (
                  <div style={{ animation: 'pageIn 0.2s ease-out' }}>
                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                      <div style={{ width: 14, height: 14, borderRadius: 4, background: activeExpense.color, flexShrink: 0,
                        boxShadow: `0 0 10px ${activeExpense.color}, 0 0 20px ${activeExpense.color}88` }} />
                      <h3 style={{ fontSize: 22, fontWeight: 800, color: activeExpense.color, margin: 0 }}>{activeExpense.name}</h3>
                      <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 20, background: `${activeExpense.color}22`, color: activeExpense.color, border: `1px solid ${activeExpense.color}44`, fontWeight: 600 }}>
                        {activeExpenseMeta.tier}
                      </span>
                    </div>

                    {/* Share bar */}
                    <div style={{ marginBottom: 18 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>Share of Total Expenses</span>
                        <span style={{ fontSize: 14, fontWeight: 800, color: activeExpense.color }}>{activeExpensePct}%</span>
                      </div>
                      <div style={{ height: 10, background: 'rgba(255,255,255,0.06)', borderRadius: 6, overflow: 'hidden' }}>
                        <div style={{ width: `${activeExpensePct}%`, height: '100%', background: activeExpense.color, borderRadius: 6,
                          boxShadow: `0 0 10px ${activeExpense.color}99`, transition: 'width 0.4s ease' }} />
                      </div>
                    </div>

                    {/* Stats grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                      {[
                        { label: 'Amount',        value: fmt(activeExpenseMeta.value),        color: activeExpense.color },
                        { label: '% of Revenue',  value: `${activeExpenseMeta.revenuePct}%`,   color: '#22d3a8' },
                        { label: 'Transactions',  value: activeExpenseMeta.count.toString(),   color: '#00D4FF' },
                        { label: 'Avg / Txn',     value: fmt(activeExpenseMeta.avg),            color: '#f59e0b' },
                      ].map(s => (
                        <div key={s.label} style={{ padding: '12px 14px', borderRadius: 10,
                          background: `${s.color}09`, border: `1px solid ${s.color}22` }}>
                          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 5 }}>{s.label}</div>
                          <div style={{ fontSize: 15, fontWeight: 800, color: s.color }}>{s.value}</div>
                        </div>
                      ))}
                    </div>

                    {/* Insight note */}
                    <div style={{ padding: '12px 16px', borderRadius: 10,
                      background: `${activeExpense.color}0d`, border: `1px solid ${activeExpense.color}33` }}>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>Insight</div>
                      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', lineHeight: 1.5 }}>{activeExpenseMeta.insight}</div>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    height: '100%', gap: 12, padding: '20px 0' }}>
                    <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(255,255,255,0.04)',
                      border: '1px dashed rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Wallet size={22} color="rgba(255,255,255,0.2)" />
                    </div>
                    <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', textAlign: 'center', maxWidth: 220 }}>
                      Hover or click a slice to see expense category details
                    </p>
                    <div style={{ display: 'flex', gap: 14, marginTop: 4 }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>Total Expenses</div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: '#f43f5e' }}>{fmt(expenseTotal)}</div>
                      </div>
                      <div style={{ width: 1, background: 'rgba(255,255,255,0.08)' }} />
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>Profit Margin</div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: netProfit >= 0 ? '#6C63FF' : '#f43f5e' }}>{profitMargin >= 0 ? '+' : ''}{profitMargin}%</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Recent money flow */}
          <div className="glass-card">
            <div className="section-title">
              Recent Money Flow
              <button className="btn btn-ghost btn-sm" onClick={() => setTab('ledger')}>Full Ledger →</button>
            </div>
            <table className="data-table">
              <thead>
                <tr><th>Date</th><th>Time</th><th>Type</th><th>Description</th><th>Amount</th><th>Status</th></tr>
              </thead>
              <tbody>
                {allTransactions.slice(0, 10).map(t => (
                  <tr key={t.id} onClick={() => setSelectedTxn(t)}
                    style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(108,99,255,0.08)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
                  >
                    <td style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, whiteSpace: 'nowrap' }}>
                      {ledgerDate(t)}
                    </td>
                    <td style={{ color: 'rgba(255,255,255,0.38)', fontSize: 12, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {ledgerTime(t)}
                    </td>
                    <td>
                      <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 10, fontWeight: 700, background: `${categoryColor(t.category)}18`, color: categoryColor(t.category) }}>{t.category}</span>
                    </td>
                    <td style={{ fontWeight: 500, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description}</td>
                    <td style={{ fontWeight: 800, color: t.type === 'income' ? '#22d3a8' : '#f43f5e', fontSize: 14 }}>
                      {t.type === 'income' ? '+' : '−'}${t.amount.toLocaleString()}
                    </td>
                    <td>
                      <span className={`badge ${t.status === 'Completed' ? 'badge-success' : t.status === 'In Transit' ? 'badge-accent' : 'badge-warning'}`}>
                        {t.status === 'Completed' ? <CheckCircle size={10} /> : <Clock size={10} />} {t.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {allTransactions.length === 0 && !loading && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: 28, color: 'rgba(255,255,255,0.3)' }}>No transactions found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ══════════ TAB: LEDGER ══════════ */}
      {tab === 'ledger' && (
        <div className="glass-card">
          <div className="section-title" style={{ flexWrap: 'wrap', gap: 10 }}>
            <span>Full Transaction Ledger</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
              {(['all', 'income', 'expense', 'pending'] as const).map(f => (
                <button key={f} onClick={() => setLedgerFilter(f)} style={{ padding: '5px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: ledgerFilter === f ? 'rgba(108,99,255,0.25)' : 'rgba(255,255,255,0.05)', color: ledgerFilter === f ? '#a78bfa' : 'rgba(255,255,255,0.45)', fontWeight: 600, fontSize: 12, boxShadow: ledgerFilter === f ? '0 0 0 1px rgba(108,99,255,0.45)' : 'none', transition: 'all 0.2s' }}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', marginLeft: 4 }}>{filteredLedger.length} entries</span>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr><th>Date</th><th>Time</th><th>Ref #</th><th>Category</th><th>Description</th><th>Amount</th><th>Status</th></tr>
              </thead>
              <tbody>
                {filteredLedger.map(t => (
                  <tr key={t.id} onClick={() => setSelectedTxn(t)}
                    style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(108,99,255,0.08)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
                  >
                    <td style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, whiteSpace: 'nowrap' }}>
                      {ledgerDate(t, true)}
                    </td>
                    <td style={{ color: 'rgba(255,255,255,0.38)', fontSize: 12, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {ledgerTime(t)}
                    </td>
                    <td><span title={t.id} style={{ color: '#a78bfa', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' }}>{shortRef(t.id)}</span></td>
                    <td>
                      <span style={{ fontSize: 10, padding: '3px 9px', borderRadius: 10, fontWeight: 700, background: `${categoryColor(t.category)}18`, color: categoryColor(t.category) }}>{t.category}</span>
                    </td>
                    <td style={{ fontWeight: 500 }}>{t.description}</td>
                    <td style={{ fontWeight: 800, color: t.type === 'income' ? '#22d3a8' : '#f43f5e', fontSize: 14 }}>
                      {t.type === 'income' ? '+' : '−'}${t.amount.toLocaleString()}
                    </td>
                    <td>
                      <span className={`badge ${t.status === 'Completed' ? 'badge-success' : t.status === 'In Transit' ? 'badge-accent' : 'badge-warning'}`}>{t.status}</span>
                    </td>
                  </tr>
                ))}
                {filteredLedger.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 28, color: 'rgba(255,255,255,0.3)' }}>No entries match the current filter</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Ledger summary footer */}
          {filteredLedger.length > 0 && (
            <div style={{ display: 'flex', gap: 16, marginTop: 16, padding: '14px 16px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', flexWrap: 'wrap' }}>
              {[
                { label: 'Total In',  value: fmt(filteredLedger.filter(t => t.type === 'income').reduce((a, t) => a + t.amount, 0)),  color: '#22d3a8' },
                { label: 'Total Out', value: fmt(filteredLedger.filter(t => t.type === 'expense').reduce((a, t) => a + t.amount, 0)), color: '#f43f5e' },
                { label: 'Net',       value: fmt(Math.abs(filteredLedger.reduce((a, t) => a + (t.type === 'income' ? t.amount : -t.amount), 0))), color: '#a78bfa' },
                { label: 'Entries',   value: filteredLedger.length.toString(), color: '#00D4FF' },
              ].map(s => (
                <div key={s.label} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                  <span style={{ color: 'rgba(255,255,255,0.4)' }}>{s.label}:</span>
                  <span style={{ color: s.color, fontWeight: 700 }}>{s.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════ TAB: VENDOR PAYMENTS ══════════ */}
      {tab === 'vendors' && (
        <>
          {/* ── Procurement summary ── */}
          <div className="glass-card" style={{ marginBottom: 16 }}>
            <div className="section-title">Accounts Payable</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
              {[
                { label: 'Vendors',          value: vendors.length.toString(),                                 color: '#a78bfa' },
                { label: 'Purchase Orders',  value: (procOverview?.total_orders ?? 0).toLocaleString(),        color: '#00D4FF' },
                { label: 'Outstanding',      value: fmt(Number(procOverview?.outstanding ?? 0)),               color: '#f43f5e',
                  sub: `${Number(procOverview?.open_orders ?? 0).toLocaleString()} unpaid bill${Number(procOverview?.open_orders ?? 0) === 1 ? '' : 's'}` },
                { label: 'Paid Out (Total)', value: fmt(Number(procOverview?.paid_amount ?? 0)),               color: '#22d3a8',
                  sub: `${Number(procOverview?.paid_orders ?? 0).toLocaleString()} bill${Number(procOverview?.paid_orders ?? 0) === 1 ? '' : 's'} settled` },
                { label: 'Paid This Month',  value: fmt(Number(procOverview?.paid_this_month ?? 0)),           color: '#00D4FF',
                  sub: `${fmt(Number(procOverview?.paid_today ?? 0))} today` },
                { label: 'Total Committed',  value: fmt(Number(procOverview?.total_committed ?? 0)),           color: '#f59e0b' },
              ].map(s => (
                <div key={s.label} style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 5 }}>{s.label}</div>
                  <div style={{ fontSize: 21, fontWeight: 800, color: s.color }}>{s.value}</div>
                  {s.sub && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 3 }}>{s.sub}</div>}
                </div>
              ))}
            </div>
          </div>

          {/* ── Vendor directory ── */}
          <div className="glass-card" style={{ marginBottom: 16 }}>
            <div className="section-title" style={{ flexWrap: 'wrap', gap: 10 }}>
              <span>Vendors</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' }}>
                <input
                  value={vendorSearch}
                  onChange={e => setVendorSearch(e.target.value)}
                  placeholder="Search vendor…"
                  className="glass-input"
                  style={{ fontSize: 12, padding: '6px 10px', width: 170 }}
                />
                {([
                  ['all', 'All'],
                  ['outstanding', 'Owing'],
                  ['settled', 'Settled'],
                ] as const).map(([key, label]) => (
                  <button key={key} onClick={() => setVendorFilter(key)}
                    style={{
                      fontSize: 11, padding: '6px 12px', borderRadius: 9, cursor: 'pointer', fontWeight: 600,
                      background: vendorFilter === key ? 'rgba(108,99,255,0.2)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${vendorFilter === key ? 'rgba(108,99,255,0.5)' : 'rgba(255,255,255,0.08)'}`,
                      color: vendorFilter === key ? '#a78bfa' : 'rgba(255,255,255,0.45)',
                    }}
                  >{label}</button>
                ))}
              </div>
            </div>

            {payResult && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12,
                padding: '10px 14px', borderRadius: 10, fontSize: 12.5,
                background: payResult.ok ? 'rgba(34,211,168,0.1)' : 'rgba(244,63,94,0.1)',
                border: `1px solid ${payResult.ok ? 'rgba(34,211,168,0.3)' : 'rgba(244,63,94,0.3)'}`,
                color: payResult.ok ? '#22d3a8' : '#f43f5e',
              }}>
                {payResult.ok ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
                <span style={{ minWidth: 0 }}>{payResult.msg}</span>

                {/* This replaces the confirm dialog. It stays until dismissed
                    rather than fading, so a payment made by mistake is still
                    reversible a minute later. */}
                {payResult.ok && !!payResult.orderIds?.length && (
                  <button
                    onClick={() => undoPayment(payResult.orderIds!)}
                    disabled={undoing}
                    style={{
                      marginLeft: 'auto', flexShrink: 0, padding: '5px 12px', borderRadius: 8,
                      background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.22)',
                      color: '#fff', fontWeight: 700, fontSize: 11.5,
                      cursor: undoing ? 'default' : 'pointer', opacity: undoing ? 0.5 : 1,
                      display: 'flex', alignItems: 'center', gap: 5,
                    }}
                  >
                    <RotateCcw size={12} /> {undoing ? 'Undoing…' : 'Undo'}
                  </button>
                )}

                <button
                  onClick={() => setPayResult(null)}
                  style={{ marginLeft: payResult.ok && payResult.orderIds?.length ? 0 : 'auto', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px', opacity: 0.6 }}
                  aria-label="Dismiss"
                >×</button>
              </div>
            )}

            {(() => {
              // Per-vendor figures come from the server roll-up. Deriving them
              // from `vendorOrders` meant filtering an already-truncated 200-row
              // page, so most vendors showed $0 against real unpaid balances.
              const rows = vendors
                .map(v => {
                  const s = vendorSummary[v.id] || {}
                  return {
                    v,
                    orders:      Number(s.order_count ?? 0),
                    paid:        Number(s.paid_amount ?? 0),
                    outstanding: Number(s.outstanding ?? 0),
                    inTransit:   Number(s.in_transit ?? 0),
                  }
                })
                .filter(r => vendorFilter === 'all'
                  || (vendorFilter === 'outstanding' && r.outstanding > 0)
                  || (vendorFilter === 'settled' && r.outstanding === 0))
                .filter(r => {
                  const q = vendorSearch.trim().toLowerCase()
                  return !q || `${r.v.company} ${r.v.name} ${r.v.category}`.toLowerCase().includes(q)
                })
                // Biggest bill first — that is the one that needs attention.
                .sort((a, b) => b.outstanding - a.outstanding || b.orders - a.orders)

              if (vendors.length === 0 && !loading) {
                return (
                  <div style={{ textAlign: 'center', padding: 44, color: 'rgba(255,255,255,0.3)' }}>
                    <Building2 size={38} style={{ opacity: 0.25, display: 'block', margin: '0 auto 12px' }} />
                    <p style={{ margin: 0 }}>No vendors found. Add vendors in the Restock section.</p>
                  </div>
                )
              }
              if (rows.length === 0) {
                return (
                  <div style={{ textAlign: 'center', padding: 36, color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>
                    No vendors match this filter.
                  </div>
                )
              }

              return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 12 }}>
                  {rows.map(({ v, orders, paid, outstanding, inTransit }) => {
                    const owing  = outstanding > 0
                    const accent = owing ? '#f43f5e' : '#22d3a8'
                    return (
                      <div key={v.id}
                        style={{
                          display: 'flex', flexDirection: 'column', padding: 16, borderRadius: 14,
                          // Solid enough that the page artwork behind does not
                          // wash the numbers out, which it did at 7% opacity.
                          background: 'rgba(10,14,30,0.72)',
                          border: `1px solid ${accent}33`, transition: 'box-shadow 0.2s, transform 0.15s',
                        }}
                        onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = `0 0 0 1px ${accent}55, 0 0 22px ${accent}22`; el.style.transform = 'translateY(-2px)' }}
                        onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = ''; el.style.transform = '' }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
                          <div style={{ minWidth: 0 }}>
                            <div title={v.company} style={{ fontWeight: 700, color: '#fff', fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.company}</div>
                            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 2 }}>{v.category}</div>
                          </div>
                          <span style={{ flexShrink: 0, fontSize: 9, padding: '3px 8px', borderRadius: 7, background: `${accent}1e`, color: accent, fontWeight: 700, border: `1px solid ${accent}44`, whiteSpace: 'nowrap' }}>
                            {owing ? 'OWING' : 'SETTLED'}
                          </span>
                        </div>

                        {/* Outstanding is the headline: it is what a payment changes. */}
                        <div style={{ padding: '10px 12px', borderRadius: 10, background: owing ? 'rgba(244,63,94,0.08)' : 'rgba(34,211,168,0.07)', border: `1px solid ${accent}2a`, marginBottom: 10 }}>
                          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 2 }}>Outstanding</div>
                          <div style={{ fontSize: 19, fontWeight: 800, color: accent }}>{fmt(outstanding)}</div>
                        </div>

                        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                          {[
                            { label: 'Orders',  value: orders.toLocaleString(), color: '#a78bfa' },
                            { label: 'Paid',    value: fmt(paid),               color: '#22d3a8' },
                            { label: 'Transit', value: inTransit.toLocaleString(), color: '#f59e0b' },
                            { label: 'Lead',    value: `${v.lead_time_days || '—'}d`, color: '#00D4FF' },
                          ].map(s => (
                            <div key={s.label} style={{ flex: 1, minWidth: 0, textAlign: 'center', padding: '7px 2px', borderRadius: 7, background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.06)' }}>
                              <div style={{ fontSize: 12, fontWeight: 800, color: s.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.value}</div>
                              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s.label}</div>
                            </div>
                          ))}
                        </div>

                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 10, lineHeight: 1.5, marginTop: 'auto' }}>
                          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={v.email || ''}>
                            <span style={{ color: 'rgba(255,255,255,0.55)' }}>{v.name}</span>{v.email ? ` · ${v.email}` : ''}
                          </div>
                          {/* Bills are settled on delivery, not at order time —
                              the old card said "paid on order" regardless. */}
                          <span style={{ color: 'rgba(255,255,255,0.4)' }}>{v.payment_terms || 'Standard terms'} · settled on delivery</span>
                        </div>

                        {/* Pay is offered only where there is something to
                            pay. A "Pay $0" button on a settled vendor is a
                            control that cannot do anything. */}
                        {owing && (() => {
                          const busy = payingVendor === v.id
                          const blocked = payingVendor !== null && !busy
                          return (
                            <button
                              onClick={() => payVendorDues(v.id, v.company, outstanding)}
                              disabled={busy || blocked}
                              title={`Settle every unpaid bill for ${v.company}`}
                              style={{
                                width: '100%', padding: '9px', borderRadius: 9, marginBottom: 8,
                                background: busy ? 'rgba(34,211,168,0.1)' : 'rgba(34,211,168,0.16)',
                                border: '1px solid rgba(34,211,168,0.45)', color: '#22d3a8',
                                fontWeight: 700, fontSize: 12, transition: 'box-shadow 0.2s',
                                cursor: busy || blocked ? 'default' : 'pointer',
                                opacity: blocked ? 0.45 : 1,
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                              }}
                              onMouseEnter={e => { if (!busy && !blocked) (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 1px rgba(34,211,168,0.7), 0 0 14px rgba(34,211,168,0.3)' }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '' }}
                            >
                              {busy
                                ? 'Paying…'
                                : <><DollarSign size={13} /> Pay {fmt(outstanding)}</>}
                            </button>
                          )
                        })()}

                        <button
                          onClick={() => setHistoryVendor(v)}
                          style={{ width: '100%', padding: '8px', borderRadius: 9, background: 'rgba(108,99,255,0.12)', border: '1px solid rgba(108,99,255,0.3)', color: '#a78bfa', fontWeight: 600, cursor: 'pointer', fontSize: 11.5, transition: 'box-shadow 0.2s' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 1px rgba(108,99,255,0.5), 0 0 12px rgba(108,99,255,0.25)' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '' }}
                        >View Order History →</button>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>

          {/* ── Money actually paid out ──
              The explicit "I sent this much to this vendor" record. Settling a
              bill used to leave no trace beyond a status badge. */}
          <div className="glass-card" style={{ marginBottom: 16 }}>
            <div className="section-title">
              Payments Made
              <span className="badge badge-success">
                {fmt(Number(procOverview?.paid_amount ?? 0))} across {Number(procOverview?.paid_orders ?? 0).toLocaleString()} bill{Number(procOverview?.paid_orders ?? 0) === 1 ? '' : 's'}
              </span>
            </div>
            {vendorPayments.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 32, color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>
                No vendor payments yet. Confirm a delivery below to settle a bill.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr><th>Paid On</th><th>Time</th><th>Vendor</th><th>For</th><th>Amount</th><th>Ordered</th></tr>
                  </thead>
                  <tbody>
                    {vendorPayments.slice(0, 12).map(p => (
                      <tr key={p.order_id}>
                        <td style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, whiteSpace: 'nowrap' }}>
                          {ledgerDate({ sortAt: stampOf(p.paid_at) }, true)}
                        </td>
                        <td style={{ color: 'rgba(255,255,255,0.38)', fontSize: 12, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                          {ledgerTime({ sortAt: stampOf(p.paid_at), hasTime: !!p.paid_at })}
                        </td>
                        <td style={{ fontWeight: 600, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.vendor_name}>
                          {p.vendor_name}
                        </td>
                        <td style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>
                          {p.item_label}{Number(p.item_count) > 1 ? ` +${Number(p.item_count) - 1} more` : ''}
                        </td>
                        <td style={{ fontWeight: 800, color: '#f43f5e', whiteSpace: 'nowrap' }}>−{fmt(Number(p.amount) || 0)}</td>
                        <td style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, whiteSpace: 'nowrap' }}>
                          {p.ordered_at ? ledgerDate({ sortAt: stampOf(p.ordered_at) }, true) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Recent purchase orders. Deliberately not "all": this list is the
              most recent 200 of {total_orders}, and the badge used to report
              the page size as if it were the whole table. */}
          {vendorOrders.length > 0 && (
            <div className="glass-card">
              <div className="section-title">
                Recent Purchase Orders
                <span className="badge badge-accent">
                  showing {Math.min(vendorOrders.length, 20)} of {Number(procOverview?.total_orders ?? vendorOrders.length).toLocaleString()}
                </span>
                <span className="badge badge-warning">{Number(procOverview?.open_orders ?? 0).toLocaleString()} unpaid</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr><th>PO #</th><th>Product</th><th>Vendor</th><th>Qty</th><th>Amount Paid</th><th>Delivery</th><th>Paid On</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    {vendorOrders.slice(0, 20).map((o, i) => {
                      const firstItem = Array.isArray(o.items) && o.items[0] ? o.items[0] : null
                      const itemCount = Array.isArray(o.items) ? o.items.length : 0
                      const totalQty  = Array.isArray(o.items) ? o.items.reduce((s: number, it: any) => s + (it.quantity || 0), 0) : 0
                      const delivered = (o.status || '').toLowerCase() === 'delivered'
                      const cancelled = (o.status || '').toLowerCase() === 'cancelled'
                      const dColor    = delivered ? '#22d3a8' : cancelled ? '#f43f5e' : '#f59e0b'
                      return (
                        <tr key={i}>
                          <td><span style={{ color: '#a78bfa', fontWeight: 600, fontSize: 12 }}>PO-{String(o.id || i + 1).slice(-8).toUpperCase()}</span></td>
                          <td style={{ fontWeight: 500 }}>{firstItem?.product_name || 'Order'}{itemCount > 1 ? ` +${itemCount - 1} more` : ''}</td>
                          <td style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>{o.vendor_name || 'Unassigned'}</td>
                          <td style={{ fontWeight: 600 }}>{totalQty} units</td>
                          <td style={{ color: o.paid_at ? '#22d3a8' : '#f59e0b', fontWeight: 700 }}>{fmt(Math.round(Number(o.total_cost) || 0))}{!o.paid_at && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontWeight: 500 }}> due</span>}</td>
                          <td><span className="badge" style={{ background: `${dColor}1e`, color: dColor }}>{o.status || 'Pending'}</span></td>
                          <td style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>{o.paid_at ? fmtDate(o.paid_at) : '—'}</td>
                          <td>
                            {!delivered && !cancelled ? (
                              <button
                                disabled={confirmingDelivery === o.id}
                                onClick={() => confirmDelivery(o.id)}
                                style={{ fontSize: 11, padding: '5px 10px', borderRadius: 7, background: 'rgba(34,211,168,0.14)', border: '1px solid rgba(34,211,168,0.4)', color: '#22d3a8', fontWeight: 600, cursor: confirmingDelivery === o.id ? 'wait' : 'pointer', opacity: confirmingDelivery === o.id ? 0.6 : 1, whiteSpace: 'nowrap' }}
                              >
                                {confirmingDelivery === o.id ? '⏳' : '✓ Confirm Delivery'}
                              </button>
                            ) : (
                              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {historyVendor && (
            <VendorHistoryModal
              vendor={historyVendor}
              orders={vendorOrders.filter(o => o.vendor_id === historyVendor.id)}
              onClose={() => setHistoryVendor(null)}
              onConfirmDelivery={confirmDelivery}
              confirmingId={confirmingDelivery}
            />
          )}
        </>
      )}

      {/* ══════════ TAB: PAYROLL ══════════ */}
      {tab === 'payroll' && (() => {
        const now = new Date()
        const currentMonth = now.getMonth() + 1
        const currentYear  = now.getFullYear()
        const monthName    = now.toLocaleString('en', { month: 'long' })

        // Payroll only ever concerns Active staff. Rows belonging to someone
        // who has since gone Inactive or On Leave are excluded from both the
        // totals and from "Pay All Due", so they can never be swept into a
        // payment run.
        const payableIds = new Set(employees.filter(isPayable).map(e => e.id))
        const payrollRows = salaryPayments.filter(p => payableIds.has(p.employee_id))

        const paidEmps   = payrollRows.filter(p => p.status === 'Paid')
        const dueEmps    = payrollRows.filter(p => p.status !== 'Paid')
        const paidAmount = paidEmps.reduce((a: number, p: any) => a + Number(p.amount), 0)
        const dueAmount  = dueEmps.reduce((a: number, p: any)  => a + Number(p.amount), 0)

        const payEmp = async (empId: string) => {
          // Last line of defence: even if a Pay button is somehow rendered for
          // a non-Active employee, refuse rather than raise a payment.
          if (!payableIds.has(empId)) return
          setPayingEmp(empId)
          const sp = salaryPayments.find(p => p.employee_id === empId)
          if (sp) {
            await supabase.from('salary_payments').update({ status: 'Paid', paid_at: new Date().toISOString() }).eq('id', sp.id)
          } else {
            const emp = employees.find(e => e.id === empId)
            await supabase.from('salary_payments').insert({ employee_id: empId, amount: emp?.monthly_salary || 0, payment_month: currentMonth, payment_year: currentYear, status: 'Paid', paid_at: new Date().toISOString() })
          }
          setSalaryPayments(prev => prev.map(p => p.employee_id === empId ? { ...p, status: 'Paid', paid_at: new Date().toISOString() } : p))
          setPayingEmp(null)
        }
        const payAll = async () => {
          setPayingAll(true)
          const dueIds = dueEmps.map((p: any) => p.id).filter(Boolean)
          if (dueIds.length > 0) await supabase.from('salary_payments').update({ status: 'Paid', paid_at: new Date().toISOString() }).in('id', dueIds)
          // Only flip the rows that were actually paid — the previous version
          // marked every row Paid locally, including non-payable staff, so the
          // UI showed Inactive employees as paid until the next refetch.
          const paidSet = new Set(dueIds)
          setSalaryPayments(prev => prev.map(p =>
            paidSet.has(p.id) ? { ...p, status: 'Paid', paid_at: new Date().toISOString() } : p
          ))
          setPayingAll(false)
        }

        const roleColor: Record<string, string> = {
          'Warehouse Supervisor': '#6C63FF', 'Receiving Clerk': '#00D4FF', 'Stocker': '#22d3a8',
          'Packer': '#f59e0b', 'Logistic': '#FF6B9D', 'Cleaner': '#38bdf8', 'Security': '#a78bfa',
        }

        return (
          <>
            {/* Payroll KPI row */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
              {[
                { label: 'Total Monthly Payroll', value: `${symbol}${totalPayroll.toLocaleString()}`,  color: '#a78bfa', sub: `${employees.length} employees`, icon: Users },
                { label: 'Paid This Month',       value: `${symbol}${paidAmount.toLocaleString()}`,    color: '#22d3a8', sub: `${paidEmps.length} employees paid`, icon: UserCheck },
                { label: 'Outstanding (Due)',      value: `${symbol}${dueAmount.toLocaleString()}`,     color: dueAmount > 0 ? '#f43f5e' : '#22d3a8', sub: `${dueEmps.length} due`, icon: Clock },
                { label: 'Payroll Period',         value: monthName,                            color: '#00D4FF', sub: currentYear.toString(), icon: TrendingUp },
              ].map(card => (
                <div key={card.label}
                  style={{ flex: '1 1 180px', padding: '18px 20px', borderRadius: 16, background: `${card.color}0d`, border: `1px solid ${card.color}33`, transition: 'box-shadow 0.25s, transform 0.18s' }}
                  onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = `0 0 0 1px ${card.color}77, 0 0 24px ${card.color}44`; el.style.transform = 'translateY(-2px)' }}
                  onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = ''; el.style.transform = '' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <card.icon size={15} color={card.color} />
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>{card.label}</span>
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: card.color, marginBottom: 3 }}>{card.value}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>{card.sub}</div>
                </div>
              ))}
            </div>

            {/* Pay All banner */}
            <div className="glass-card" style={{ marginBottom: 16, padding: '16px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14, background: dueAmount > 0 ? 'rgba(244,63,94,0.06)' : 'rgba(34,211,168,0.05)', border: `1px solid ${dueAmount > 0 ? 'rgba(244,63,94,0.25)' : 'rgba(34,211,168,0.2)'}` }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#fff', marginBottom: 3 }}>{monthName} {currentYear} Payroll Run</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                  {dueEmps.length > 0 ? `${dueEmps.length} employees unpaid · ${symbol}${dueAmount.toLocaleString()} outstanding` : '✓ All employees paid for this month'}
                </div>
              </div>
              {dueEmps.length > 0 && (
                <button onClick={payAll} disabled={payingAll}
                  style={{ padding: '10px 22px', borderRadius: 11, background: 'rgba(34,211,168,0.2)', border: '1px solid rgba(34,211,168,0.5)', color: '#22d3a8', fontWeight: 700, cursor: 'pointer', fontSize: 13, transition: 'box-shadow 0.2s' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 1px rgba(34,211,168,0.7), 0 0 20px rgba(34,211,168,0.3)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '' }}
                >
                  {payingAll ? 'Processing…' : `✓ Pay All Due · ${symbol}${dueAmount.toLocaleString()}`}
                </button>
              )}
            </div>

            {/* Employee salary table */}
            <div className="glass-card">
              <div className="section-title">
                Employee Salary Status
                <span className="badge badge-accent">{employees.length} total</span>
              </div>
              <table className="data-table">
                <thead>
                  <tr><th>Employee</th><th>Role</th><th>Monthly Salary</th><th>Status</th><th>Paid At</th><th>Action</th></tr>
                </thead>
                <tbody>
                  {employees.map(emp => {
                    const sp      = salaryPayments.find(p => p.employee_id === emp.id)
                    const payable = isPayable(emp)
                    const isPaid  = payable && sp?.status === 'Paid'
                    const col     = roleColor[emp.role] || '#a78bfa'
                    return (
                      <tr key={emp.id} style={{ transition: 'background 0.15s' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(108,99,255,0.06)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
                      >
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ width: 36, height: 36, borderRadius: 10, background: `${col}22`, border: `1px solid ${col}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: col, flexShrink: 0 }}>
                              {(emp.name || '?').charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div style={{ fontWeight: 600, color: '#fff', fontSize: 13 }}>{emp.name}</div>
                              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>{emp.email || 'No email'}</div>
                            </div>
                          </div>
                        </td>
                        <td><span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 8, background: `${col}18`, color: col, fontWeight: 600 }}>{emp.role}</span></td>
                        <td style={{ fontWeight: 700, color: '#a78bfa', fontSize: 15 }}>${Number(emp.monthly_salary || 0).toLocaleString()}</td>
                        <td>
                          {!payable ? (
                            <span className="badge" style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.45)', border: '1px solid rgba(255,255,255,0.12)' }}>
                              Not on payroll · {emp.status}
                            </span>
                          ) : (
                            <span className={`badge ${isPaid ? 'badge-success' : 'badge-danger'}`}>
                              {isPaid ? <CheckCircle size={10} /> : <Clock size={10} />} {isPaid ? 'Paid' : 'Due'}
                            </span>
                          )}
                        </td>
                        <td style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
                          {payable && sp?.paid_at ? fmtDate(sp.paid_at, { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}
                        </td>
                        <td>
                          {!payable ? (
                            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>—</span>
                          ) : !isPaid ? (
                            <button onClick={() => payEmp(emp.id)} disabled={payingEmp === emp.id}
                              style={{ padding: '6px 16px', borderRadius: 8, background: 'rgba(34,211,168,0.15)', border: '1px solid rgba(34,211,168,0.4)', color: '#22d3a8', fontWeight: 600, cursor: 'pointer', fontSize: 12, transition: 'box-shadow 0.2s' }}
                              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 1px rgba(34,211,168,0.6), 0 0 12px rgba(34,211,168,0.2)' }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '' }}
                            >
                              {payingEmp === emp.id ? 'Paying…' : `Pay ${symbol}${Number(emp.monthly_salary || 0).toLocaleString()}`}
                            </button>
                          ) : (
                            <span style={{ fontSize: 12, color: '#22d3a877', fontWeight: 500 }}>✓ Completed</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {employees.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: 36, color: 'rgba(255,255,255,0.3)' }}>
                      <Users size={34} style={{ display: 'block', margin: '0 auto 12px', opacity: 0.2 }} />
                      No employees found. Add employees in the Employees section.
                    </td></tr>
                  )}
                </tbody>
              </table>
              {employees.length > 0 && (
                <div style={{ display: 'flex', gap: 16, marginTop: 16, padding: '14px 18px', borderRadius: 12, background: 'rgba(167,139,250,0.07)', border: '1px solid rgba(167,139,250,0.2)', flexWrap: 'wrap' }}>
                  {[
                    { label: 'Total Payroll',  value: `${symbol}${totalPayroll.toLocaleString()}`,  color: '#a78bfa' },
                    { label: 'Paid',           value: `${symbol}${paidAmount.toLocaleString()} (${paidEmps.length})`, color: '#22d3a8' },
                    { label: 'Due',            value: `${symbol}${dueAmount.toLocaleString()} (${dueEmps.length})`,   color: dueAmount > 0 ? '#f43f5e' : '#22d3a8' },
                    { label: 'Completion',     value: `${employees.length > 0 ? Math.round((paidEmps.length / employees.length) * 100) : 0}%`, color: '#00D4FF' },
                  ].map(s => (
                    <div key={s.label} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                      <span style={{ color: 'rgba(255,255,255,0.4)' }}>{s.label}:</span>
                      <span style={{ color: s.color, fontWeight: 700 }}>{s.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )
      })()}

      {/* ══════════ TAB: P&L REPORTS ══════════ */}
      {tab === 'reports' && (
        <>
          <div className="grid-21" style={{ marginBottom: 16 }}>
            {/* Monthly grouped bar chart */}
            <div className="glass-card">
              <div className="section-title">Monthly P&amp;L Breakdown</div>
              <div style={{ height: 250 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyData} barGap={6} barCategoryGap="30%">
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `${symbol}${Math.round(v / 1000)}k`} />
                    <Tooltip
                      cursor={false}
                      contentStyle={{ background: 'rgba(5,8,16,0.96)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '10px 16px' }}
                      formatter={(v: any, name: string) => [`${symbol}${Number(v).toLocaleString()}`, name === 'income' ? 'Revenue' : 'Expenses']}
                    />
                    <Bar dataKey="income"   fill="#22d3a8" radius={[5,5,0,0]} name="income"   activeBar={{ fill: '#22d3a8', filter: 'drop-shadow(0 0 8px #22d3a8) brightness(1.2)' }} />
                    <Bar dataKey="expenses" fill="#f43f5e" radius={[5,5,0,0]} name="expenses" activeBar={{ fill: '#f43f5e', filter: 'drop-shadow(0 0 8px #f43f5e) brightness(1.2)' }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Financial summary */}
            <div className="glass-card">
              <div className="section-title">Financial Summary</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {[
                  { label: 'Gross Revenue',       value: fmt(totalRevenue),        pct: 100,                    color: '#22d3a8' },
                  { label: 'Payroll Costs',       value: fmt(totalPayroll),        pct: totalRevenue > 0 ? (totalPayroll / totalRevenue) * 100 : 0,      color: '#a78bfa' },
                  { label: 'Procurement Costs',   value: fmt(totalProcurement),    pct: totalRevenue > 0 ? (totalProcurement / totalRevenue) * 100 : 0,  color: '#f43f5e' },
                  { label: 'Shipping Costs',      value: fmt(totalShipping),       pct: totalRevenue > 0 ? (totalShipping / totalRevenue) * 100 : 0,     color: '#f59e0b' },
                  { label: 'Net Profit',          value: fmt(Math.abs(netProfit)), pct: Math.abs(profitMargin), color: netProfit >= 0 ? '#a78bfa' : '#f43f5e' },
                ].map(row => (
                  <div key={row.label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 13 }}>
                      <span style={{ color: 'rgba(255,255,255,0.65)', fontWeight: 500 }}>{row.label}</span>
                      <span style={{ color: row.color, fontWeight: 700 }}>{row.value}</span>
                    </div>
                    <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.06)' }}>
                      <div style={{ height: '100%', borderRadius: 3, width: `${Math.min(Math.max(row.pct, 0), 100)}%`, background: row.color, boxShadow: `0 0 6px ${row.color}66`, transition: 'width 0.6s ease' }} />
                    </div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 3 }}>{row.pct.toFixed(1)}% of revenue</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Month-by-month P&L table */}
          <div className="glass-card">
            <div className="section-title">
              Month-by-Month P&amp;L Statement
              <span className="badge badge-accent">Last 6 Months</span>
            </div>
            <table className="data-table">
              <thead>
                <tr><th>Month</th><th>Revenue</th><th>Expenses</th><th>Gross Profit</th><th>Margin</th><th>vs Prior Month</th></tr>
              </thead>
              <tbody>
                {monthlyData.map((row, i) => {
                  const profit = row.income - row.expenses
                  const margin = row.income > 0 ? Math.round((profit / row.income) * 100) : 0
                  const prev   = monthlyData[i - 1]
                  const trend  = prev && prev.income > 0 ? Math.round(((row.income - prev.income) / prev.income) * 100) : null
                  return (
                    <tr key={row.month}>
                      <td style={{ fontWeight: 700, color: '#fff' }}>{row.month}</td>
                      <td style={{ color: '#22d3a8', fontWeight: 700 }}>{fmt(row.income)}</td>
                      <td style={{ color: '#f43f5e', fontWeight: 600 }}>{fmt(row.expenses)}</td>
                      <td style={{ fontWeight: 700, color: profit >= 0 ? '#a78bfa' : '#f43f5e' }}>
                        {profit >= 0 ? '+' : ''}{fmt(profit)}
                      </td>
                      <td>
                        <span style={{ color: margin >= 50 ? '#22d3a8' : margin >= 20 ? '#f59e0b' : '#f43f5e', fontWeight: 700 }}>{margin}%</span>
                      </td>
                      <td>
                        {trend !== null ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: trend >= 0 ? '#22d3a8' : '#f43f5e', fontWeight: 600 }}>
                            {trend >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                            {trend > 0 ? '+' : ''}{trend}%
                          </span>
                        ) : <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12 }}>—</span>}
                      </td>
                    </tr>
                  )
                })}
                {monthlyData.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: 28, color: 'rgba(255,255,255,0.3)' }}>No financial data available yet</td></tr>
                )}
              </tbody>
            </table>

            {/* Totals row */}
            {monthlyData.length > 0 && (
              <div style={{ display: 'flex', gap: 12, marginTop: 16, padding: '14px 18px', borderRadius: 12, background: 'rgba(108,99,255,0.07)', border: '1px solid rgba(108,99,255,0.25)', flexWrap: 'wrap' }}>
                {[
                  { label: 'Period Revenue',  value: fmt(monthlyData.reduce((a, r) => a + r.income, 0)),   color: '#22d3a8' },
                  { label: 'Period Expenses', value: fmt(monthlyData.reduce((a, r) => a + r.expenses, 0)), color: '#f43f5e' },
                  { label: 'Total Profit',    value: fmt(Math.abs(monthlyData.reduce((a, r) => a + r.profit, 0))), color: '#a78bfa' },
                  { label: 'Avg Margin',      value: `${Math.round(monthlyData.reduce((a, r) => a + (r.income > 0 ? (r.profit / r.income) * 100 : 0), 0) / Math.max(monthlyData.length, 1))}%`, color: '#00D4FF' },
                ].map(s => (
                  <div key={s.label} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                    <span style={{ color: 'rgba(255,255,255,0.4)' }}>{s.label}:</span>
                    <span style={{ color: s.color, fontWeight: 700 }}>{s.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ══════════ KPI DETAIL MODAL ══════════ */}
      {selectedKpi && createPortal(
        (() => {
          const colorMap: Record<string, string> = {
            'Total Revenue':     '#22d3a8',
            'Total Expenses':    '#f43f5e',
            'Net Profit':        netProfit >= 0 ? '#6C63FF' : '#f43f5e',
            'Monthly Cash Flow': '#00D4FF',
          }
          const kc = colorMap[selectedKpi] || '#a78bfa'

          const revTxns  = allTransactions.filter(t => t.type === 'income')
          const pendTxns = allTransactions.filter(t => t.status === 'Pending')

          const famMap: Record<string, number> = {}
          revTxns.forEach(t => { const k = t.family || 'Other'; famMap[k] = (famMap[k] || 0) + t.amount })
          const topFamilies = Object.entries(famMap).sort((a, b) => b[1] - a[1]).slice(0, 5)
          const famMax = topFamilies[0]?.[1] || 1

          const avgSale = revTxns.length > 0 ? Math.round(totalRevenue / revTxns.length) : 0
          const maxSale = revTxns.reduce((m, t) => Math.max(m, t.amount), 0)

          const pendingExpAmt  = pendTxns.filter(t => t.type === 'expense').reduce((a, t) => a + t.amount, 0)
          const inTransitCount = allTransactions.filter(t => t.status === 'In Transit').length
          const unpaidSalaryAmt = salaryPayments.filter((p: any) => p.status !== 'Paid').reduce((a: number, p: any) => a + Number(p.amount), 0)

          const bestMonth = monthlyData.length > 0 ? monthlyData.reduce((b, r) => r.income > b.income ? r : b, monthlyData[0]) : null
          const maxProfitVal = Math.max(...monthlyData.map(r => Math.abs(r.income - r.expenses)), 1)

          const bigValue =
            selectedKpi === 'Total Revenue'    ? fmt(totalRevenue) :
            selectedKpi === 'Total Expenses'   ? fmt(totalExpenses) :
            selectedKpi === 'Net Profit'       ? `${netProfit >= 0 ? '+' : '−'}${fmt(Math.abs(netProfit))}` :
            fmt(cashFlow)

          const bigSub =
            selectedKpi === 'Total Revenue'    ? `${revTxns.length.toLocaleString()} total transactions` :
            selectedKpi === 'Total Expenses'   ? `${((totalExpenses / Math.max(totalRevenue, 1)) * 100).toFixed(1)}% of total revenue` :
            selectedKpi === 'Net Profit'       ? `${profitMargin >= 0 ? '+' : ''}${profitMargin}% profit margin` :
            'Estimated available cash this month'

          return (
            <div onClick={() => setSelectedKpi(null)} style={{ position: 'fixed', inset: 0, zIndex: 10001, background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
              <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 700, background: 'rgba(6,10,22,0.99)', border: `1px solid ${kc}44`, borderRadius: 26, padding: 38, boxShadow: `0 32px 100px rgba(0,0,0,0.85), 0 0 80px ${kc}1a`, animation: 'pageIn 0.22s ease-out', maxHeight: '88vh', overflowY: 'auto' }}>

                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 30 }}>
                  <div>
                    <div style={{ fontSize: 10, color: kc, fontWeight: 700, letterSpacing: 2, marginBottom: 5, textTransform: 'uppercase' }}>Financial Detail</div>
                    <h2 style={{ fontSize: 24, fontWeight: 900, color: '#fff', margin: 0 }}>{selectedKpi}</h2>
                  </div>
                  <button onClick={() => setSelectedKpi(null)} style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${kc}33`, borderRadius: 10, padding: '8px 12px', cursor: 'pointer', color: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center' }}><X size={16} /></button>
                </div>

                {/* Big value */}
                <div style={{ textAlign: 'center', marginBottom: 34, padding: '26px 0', borderRadius: 20, background: `${kc}08`, border: `1px solid ${kc}22` }}>
                  <div style={{ fontSize: 62, fontWeight: 900, color: kc, textShadow: `0 0 60px ${kc}55`, letterSpacing: -3, lineHeight: 1 }}>{bigValue}</div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 10, fontWeight: 500 }}>{bigSub}</div>
                </div>

                {/* ── REVENUE ── */}
                {selectedKpi === 'Total Revenue' && (<>
                  <div style={{ display: 'flex', gap: 12, marginBottom: 28 }}>
                    {[
                      { label: 'Total Transactions', value: revTxns.length.toLocaleString(), color: '#22d3a8' },
                      { label: 'Avg. Sale Value',    value: fmt(avgSale),                    color: '#a78bfa' },
                      { label: 'Largest Sale',       value: fmt(maxSale),                    color: '#f59e0b' },
                    ].map(s => (
                      <div key={s.label} style={{ flex: 1, padding: '16px 12px', borderRadius: 14, background: `${s.color}0d`, border: `1px solid ${s.color}33`, textAlign: 'center' }}>
                        <div style={{ fontSize: 22, fontWeight: 800, color: s.color, marginBottom: 4 }}>{s.value}</div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginBottom: 26 }}>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: 700, marginBottom: 14, textTransform: 'uppercase', letterSpacing: 1 }}>Revenue by Product Family</div>
                    {topFamilies.length > 0 ? topFamilies.map(([fam, val], i) => {
                      const fc = ['#22d3a8','#a78bfa','#f59e0b','#00D4FF','#f43f5e'][i] || '#a78bfa'
                      const pct = Math.round((val / famMax) * 100)
                      return (
                        <div key={fam} style={{ marginBottom: 14 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                            <span style={{ color: '#fff', fontWeight: 600 }}>{fam}</span>
                            <span style={{ color: fc, fontWeight: 700 }}>{fmt(val)} <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400, fontSize: 11 }}>({Math.round((val / Math.max(totalRevenue,1))*100)}%)</span></span>
                          </div>
                          <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.06)' }}>
                            <div style={{ height: '100%', borderRadius: 4, width: `${pct}%`, background: fc, boxShadow: `0 0 10px ${fc}66`, transition: 'width 0.6s ease' }} />
                          </div>
                        </div>
                      )
                    }) : <div style={{ textAlign: 'center', padding: 24, color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>No product family data available</div>}
                  </div>
                  <div style={{ marginBottom: 26 }}>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: 700, marginBottom: 14, textTransform: 'uppercase', letterSpacing: 1 }}>Top Recent Sales</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {revTxns.slice(0, 5).map(t => (
                        <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: 10, background: 'rgba(34,211,168,0.06)', border: '1px solid rgba(34,211,168,0.1)' }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{t.description}</div>
                            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{t.date ? fmtDate(t.date, { month: 'short', day: 'numeric' }) : '—'} · {t.family || 'General'}</div>
                          </div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: '#22d3a8' }}>+${t.amount.toLocaleString()}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <button onClick={() => { setSelectedKpi(null); setTab('ledger'); setLedgerFilter('income') }} style={{ width: '100%', padding: 13, borderRadius: 12, background: 'rgba(34,211,168,0.12)', border: '1px solid rgba(34,211,168,0.4)', color: '#22d3a8', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>View All Sales in Ledger →</button>
                </>)}

                {/* ── EXPENSES ── */}
                {selectedKpi === 'Total Expenses' && (<>
                  <div style={{ display: 'flex', gap: 12, marginBottom: 28 }}>
                    {[
                      { label: 'Payroll',     value: fmt(payrollExpense),   color: '#a78bfa', pct: totalExpenses > 0 ? Math.round((payrollExpense/totalExpenses)*100) : 0 },
                      { label: 'Procurement', value: fmt(totalProcurement), color: '#f43f5e', pct: totalExpenses > 0 ? Math.round((totalProcurement/totalExpenses)*100) : 0 },
                      { label: 'Shipping',    value: fmt(totalShipping),    color: '#f59e0b', pct: totalExpenses > 0 ? Math.round((totalShipping/totalExpenses)*100) : 0 },
                    ].map(s => (
                      <div key={s.label} style={{ flex: 1, padding: '16px 12px', borderRadius: 14, background: `${s.color}0d`, border: `1px solid ${s.color}33`, textAlign: 'center' }}>
                        <div style={{ fontSize: 11, color: s.color, fontWeight: 700, marginBottom: 3 }}>{s.pct}% of expenses</div>
                        <div style={{ fontSize: 19, fontWeight: 800, color: '#fff', marginBottom: 4 }}>{s.value}</div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginBottom: 26 }}>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: 700, marginBottom: 14, textTransform: 'uppercase', letterSpacing: 1 }}>Expense Breakdown vs Revenue</div>
                    {expenseBreakdown.map(e => {
                      const pctOfRev = totalRevenue > 0 ? Math.round((e.value/totalRevenue)*100) : 0
                      const pctOfExp = totalExpenses > 0 ? Math.round((e.value/totalExpenses)*100) : 0
                      return (
                        <div key={e.name} style={{ marginBottom: 16 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ width: 10, height: 10, borderRadius: 2, background: e.color, display: 'inline-block', boxShadow: `0 0 6px ${e.color}` }} />
                              <span style={{ color: '#fff', fontWeight: 600 }}>{e.name}</span>
                            </span>
                            <span style={{ color: e.color, fontWeight: 700 }}>{fmt(e.value)} <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400, fontSize: 11 }}>({pctOfExp}% exp · {pctOfRev}% rev)</span></span>
                          </div>
                          <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.06)' }}>
                            <div style={{ height: '100%', borderRadius: 4, width: `${pctOfExp}%`, background: e.color, boxShadow: `0 0 10px ${e.color}66`, transition: 'width 0.6s ease' }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  {pendingExpAmt > 0 && (
                    <div style={{ padding: '16px 20px', borderRadius: 14, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', marginBottom: 14 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b', marginBottom: 3 }}>Pending Payments</div>
                          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>{pendTxns.filter(t => t.type === 'expense').length} transactions awaiting settlement</div>
                        </div>
                        <div style={{ fontSize: 22, fontWeight: 900, color: '#f59e0b' }}>{fmt(pendingExpAmt)}</div>
                      </div>
                    </div>
                  )}
                  {inTransitCount > 0 && (
                    <div style={{ padding: '16px 20px', borderRadius: 14, background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.25)', marginBottom: 22 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#00D4FF', marginBottom: 3 }}>Shipments In Transit</div>
                          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>Orders currently being delivered</div>
                        </div>
                        <div style={{ fontSize: 22, fontWeight: 900, color: '#00D4FF' }}>{inTransitCount}</div>
                      </div>
                    </div>
                  )}
                  <button onClick={() => { setSelectedKpi(null); setTab('ledger'); setLedgerFilter('expense') }} style={{ width: '100%', padding: 13, borderRadius: 12, background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.4)', color: '#f43f5e', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>View All Expenses in Ledger →</button>
                </>)}

                {/* ── NET PROFIT ── */}
                {selectedKpi === 'Net Profit' && (<>
                  <div style={{ display: 'flex', gap: 12, marginBottom: 28 }}>
                    {[
                      { label: 'Total Revenue',  value: fmt(totalRevenue),  color: '#22d3a8' },
                      { label: 'Total Expenses', value: fmt(totalExpenses), color: '#f43f5e' },
                      { label: 'Profit Margin',  value: `${profitMargin}%`, color: netProfit >= 0 ? '#6C63FF' : '#f43f5e' },
                    ].map(s => (
                      <div key={s.label} style={{ flex: 1, padding: '16px 12px', borderRadius: 14, background: `${s.color}0d`, border: `1px solid ${s.color}33`, textAlign: 'center' }}>
                        <div style={{ fontSize: 19, fontWeight: 800, color: s.color, marginBottom: 4 }}>{s.value}</div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginBottom: 26 }}>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: 700, marginBottom: 14, textTransform: 'uppercase', letterSpacing: 1 }}>Revenue vs Expenses vs Profit</div>
                    {[
                      { label: 'Revenue',    value: totalRevenue,        color: '#22d3a8' },
                      { label: 'Expenses',   value: totalExpenses,       color: '#f43f5e' },
                      { label: 'Net Profit', value: Math.abs(netProfit), color: netProfit >= 0 ? '#6C63FF' : '#f43f5e' },
                    ].map(row => {
                      const pct = Math.round((row.value / Math.max(totalRevenue, 1)) * 100)
                      return (
                        <div key={row.label} style={{ marginBottom: 16 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                            <span style={{ color: '#fff', fontWeight: 600 }}>{row.label}</span>
                            <span style={{ color: row.color, fontWeight: 700 }}>{fmt(row.value)}</span>
                          </div>
                          <div style={{ height: 10, borderRadius: 5, background: 'rgba(255,255,255,0.06)' }}>
                            <div style={{ height: '100%', borderRadius: 5, width: `${Math.min(pct, 100)}%`, background: row.color, boxShadow: `0 0 12px ${row.color}55`, transition: 'width 0.6s ease' }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  {monthlyData.length > 0 && (
                    <div style={{ marginBottom: 26 }}>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: 700, marginBottom: 14, textTransform: 'uppercase', letterSpacing: 1 }}>Monthly Profit Trend</div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 90, padding: '0 4px' }}>
                        {monthlyData.map((row, i) => {
                          const profit = row.income - row.expenses
                          const barH = Math.max(Math.round((Math.abs(profit) / maxProfitVal) * 72), 6)
                          const bc = profit >= 0 ? '#6C63FF' : '#f43f5e'
                          return (
                            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                              <div style={{ width: '100%', height: barH, borderRadius: 4, background: bc, boxShadow: `0 0 8px ${bc}55`, transition: 'height 0.4s ease' }} />
                              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>{row.month}</div>
                              <div style={{ fontSize: 9, color: bc, fontWeight: 700 }}>{profit >= 0 ? '+' : ''}{Math.round(profit / 1000)}k</div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  {bestMonth && (
                    <div style={{ padding: '16px 20px', borderRadius: 14, background: 'rgba(108,99,255,0.1)', border: '1px solid rgba(108,99,255,0.3)', marginBottom: 22 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#a78bfa', marginBottom: 3 }}>Best Month: {bestMonth.month}</div>
                          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>Highest revenue in the tracked period</div>
                        </div>
                        <div style={{ fontSize: 22, fontWeight: 900, color: '#a78bfa' }}>{fmt(bestMonth.income)}</div>
                      </div>
                    </div>
                  )}
                  <button onClick={() => { setSelectedKpi(null); setTab('reports') }} style={{ width: '100%', padding: 13, borderRadius: 12, background: 'rgba(108,99,255,0.12)', border: '1px solid rgba(108,99,255,0.4)', color: '#a78bfa', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>Open Full P&amp;L Reports →</button>
                </>)}

                {/* ── CASH FLOW ── */}
                {selectedKpi === 'Monthly Cash Flow' && (<>
                  <div style={{ display: 'flex', gap: 12, marginBottom: 28 }}>
                    {[
                      // Actual cash movements, not revenue/expense accruals —
                      // this panel is about money that moved.
                      { label: 'In this month',  value: fmt(cash?.month_in ?? 0),  color: '#22d3a8', icon: '▲' },
                      { label: 'Out this month', value: fmt(cash?.month_out ?? 0), color: '#f43f5e', icon: '▼' },
                      { label: 'Net this month', value: fmt(cashFlow),             color: cashFlow >= 0 ? '#00D4FF' : '#f43f5e', icon: '⇄' },
                    ].map(s => (
                      <div key={s.label} style={{ flex: 1, padding: '16px 12px', borderRadius: 14, background: `${s.color}0d`, border: `1px solid ${s.color}33`, textAlign: 'center' }}>
                        <div style={{ fontSize: 18, color: s.color, marginBottom: 4, fontWeight: 700 }}>{s.icon}</div>
                        <div style={{ fontSize: 19, fontWeight: 800, color: '#fff', marginBottom: 4 }}>{s.value}</div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginBottom: 26 }}>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: 700, marginBottom: 14, textTransform: 'uppercase', letterSpacing: 1 }}>Cash Flow Breakdown</div>
                    {[
                      { label: 'Sales Revenue',    value: totalRevenue,     color: '#22d3a8', dir: 'in'  as const },
                      { label: 'Payroll Payments', value: totalPayroll,     color: '#a78bfa', dir: 'out' as const },
                      { label: 'Procurement',      value: totalProcurement, color: '#f43f5e', dir: 'out' as const },
                      { label: 'Shipping Costs',   value: totalShipping,    color: '#f59e0b', dir: 'out' as const },
                    ].map(row => (
                      <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', marginBottom: 8, borderRadius: 12, background: `${row.color}08`, border: `1px solid ${row.color}22` }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 13, color: row.dir === 'in' ? '#22d3a8' : '#f43f5e', fontWeight: 800 }}>{row.dir === 'in' ? '▲' : '▼'}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{row.label}</span>
                        </div>
                        <span style={{ fontSize: 15, fontWeight: 800, color: row.color }}>{row.dir === 'in' ? '+' : '−'}{fmt(row.value)}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ padding: '18px 20px', borderRadius: 14, background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.3)', marginBottom: 22 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#00D4FF', marginBottom: 14 }}>Pending Cash Movements</div>
                    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                      {[
                        { label: 'Pending Expenses',    value: fmt(pendingExpAmt),  color: '#f59e0b' },
                        { label: 'Shipments In Transit', value: `${inTransitCount} orders`, color: '#00D4FF' },
                        { label: 'Unpaid Salaries',     value: fmt(unpaidSalaryAmt), color: '#a78bfa' },
                      ].map(s => (
                        <div key={s.label}>
                          <div style={{ fontSize: 18, fontWeight: 800, color: s.color, marginBottom: 3 }}>{s.value}</div>
                          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{s.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <button onClick={() => { setSelectedKpi(null); setTab('ledger') }} style={{ width: '100%', padding: 13, borderRadius: 12, background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.4)', color: '#00D4FF', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>View Full Ledger →</button>
                </>)}

              </div>
            </div>
          )
        })(),
        document.body
      )}

      {/* ══════════ TRANSACTION DETAIL MODAL ══════════ */}
      {selectedTxn && createPortal(
        <div onClick={() => setSelectedTxn(null)} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, background: 'rgba(8,12,28,0.98)', border: `1px solid ${selectedTxn.type === 'income' ? 'rgba(34,211,168,0.45)' : 'rgba(244,63,94,0.45)'}`, borderRadius: 22, padding: 32, boxShadow: '0 32px 80px rgba(0,0,0,0.8)', animation: 'pageIn 0.2s ease-out' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <h2 style={{ fontSize: 20, fontWeight: 800, color: '#fff', margin: 0 }}>Transaction Detail</h2>
                  <span style={{ fontSize: 10, padding: '3px 9px', borderRadius: 8, background: selectedTxn.type === 'income' ? 'rgba(34,211,168,0.15)' : 'rgba(244,63,94,0.15)', color: selectedTxn.type === 'income' ? '#22d3a8' : '#f43f5e', fontWeight: 700 }}>
                    {selectedTxn.type === 'income' ? 'INCOME' : 'EXPENSE'}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', margin: 0 }}>{selectedTxn.id}</p>
              </div>
              <button onClick={() => setSelectedTxn(null)} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '7px 11px', cursor: 'pointer', color: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center' }}><X size={16} /></button>
            </div>
            <div style={{ textAlign: 'center', fontSize: 40, fontWeight: 900, color: selectedTxn.type === 'income' ? '#22d3a8' : '#f43f5e', marginBottom: 28, textShadow: `0 0 30px ${selectedTxn.type === 'income' ? '#22d3a888' : '#f43f5e88'}` }}>
              {selectedTxn.type === 'income' ? '+' : '−'}${selectedTxn.amount.toLocaleString()}
            </div>
            {[
              { label: 'Reference',    value: selectedTxn.id },
              { label: 'Category',     value: selectedTxn.category },
              { label: 'Description',  value: selectedTxn.description },
              { label: 'Date',         value: selectedTxn.sortAt ? locale.fmtDate(new Date(selectedTxn.sortAt), { year: 'numeric', month: 'long' }) : '—' },
              // Naming the zone matters here: the same instant reads
              // differently depending on the Settings choice.
              { label: 'Time',         value: `${ledgerTime(selectedTxn)}${selectedTxn.hasTime ? ` (${locale.timezone})` : ''}` },
              // A settled bill has two moments worth seeing: when it was
              // raised and when the money actually left.
              ...(selectedTxn.orderedAt ? [{ label: 'Ordered On', value: ledgerDate({ sortAt: stampOf(selectedTxn.orderedAt) }, true) }] : []),
              ...(selectedTxn.paidAt ? [{ label: 'Settled On', value: `${ledgerDate({ sortAt: stampOf(selectedTxn.paidAt) }, true)} · ${ledgerTime({ sortAt: stampOf(selectedTxn.paidAt), hasTime: true })}` }] : []),
              { label: 'Status',       value: selectedTxn.status },
              ...(selectedTxn.vendor ? [{ label: 'Vendor', value: selectedTxn.vendor }] : []),
            ].map(row => (
              <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{row.label}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: row.label === 'Status' ? (selectedTxn.status === 'Completed' ? '#22d3a8' : '#f59e0b') : '#fff' }}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}

      {/* ══════════ ADD MONEY / CASH OUT ══════════ */}
      {moneyModal && createPortal(
        <div onClick={() => !moneyBusy && setMoneyModal(null)} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: 'rgba(8,12,28,0.98)', border: `1px solid ${moneyModal === 'cashout' ? 'rgba(245,158,11,0.45)' : 'rgba(34,211,168,0.45)'}`, borderRadius: 22, padding: 30, boxShadow: '0 32px 80px rgba(0,0,0,0.8)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <h2 style={{ margin: 0, fontSize: 18, color: '#fff' }}>
                {moneyModal === 'cashout' ? 'Cash out' : 'Add money'}
              </h2>
              <button onClick={() => setMoneyModal(null)} disabled={moneyBusy} style={{ background: 'none', border: 'none', color: 'var(--clr-text-muted)', cursor: 'pointer', padding: 4 }}>
                <X size={18} />
              </button>
            </div>
            <p style={{ margin: '0 0 18px', fontSize: 12.5, color: 'var(--clr-text-muted)' }}>
              Balance now {fmt(cashBalance)}
            </p>

            <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Amount</label>
            <input
              autoFocus type="number" min={0} step="0.01"
              value={moneyAmount}
              onChange={e => setMoneyAmount(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitMoney() }}
              placeholder="0.00"
              style={{ width: '100%', padding: '11px 13px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', fontSize: 18, fontWeight: 700, outline: 'none', marginBottom: 14 }}
            />

            <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Note (optional)</label>
            <input
              value={moneyNote}
              onChange={e => setMoneyNote(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitMoney() }}
              placeholder={moneyModal === 'cashout' ? 'Owner drawing, transfer out…' : 'Capital injection, loan…'}
              style={{ width: '100%', padding: '10px 13px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', fontSize: 13, outline: 'none', marginBottom: 14 }}
            />

            {(() => {
              const amt = parseFloat(moneyAmount)
              if (!Number.isFinite(amt) || amt <= 0) return null
              const after = moneyModal === 'cashout' ? cashBalance - amt : cashBalance + amt
              return (
                <div style={{ padding: 12, borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', fontSize: 13, marginBottom: 14, display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--clr-text-muted)' }}>Balance after</span>
                  <strong style={{ color: after < 0 ? '#f43f5e' : '#22d3a8' }}>{fmt(after)}</strong>
                </div>
              )
            })()}

            {moneyErr && (
              <div style={{ padding: 11, borderRadius: 10, background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.3)', color: '#f43f5e', fontSize: 12.5, marginBottom: 14 }}>
                {moneyErr}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-primary" onClick={submitMoney} disabled={moneyBusy} style={{ flex: 1, justifyContent: 'center' }}>
                {moneyBusy ? 'Saving…' : moneyModal === 'cashout' ? 'Cash out' : 'Add money'}
              </button>
              <button className="btn" onClick={() => setMoneyModal(null)} disabled={moneyBusy}>Cancel</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ══════════ RECORD PAYMENT MODAL ══════════ */}
      {showRecord && createPortal(
        <div onClick={() => setShowRecord(false)} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, background: 'rgba(8,12,28,0.98)', border: '1px solid rgba(108,99,255,0.45)', borderRadius: 22, padding: 32, boxShadow: '0 32px 80px rgba(0,0,0,0.8)', animation: 'pageIn 0.2s ease-out' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 4 }}>Record Payment</h2>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', margin: 0 }}>Log any money movement to the ledger</p>
              </div>
              <button onClick={() => setShowRecord(false)} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(108,99,255,0.4)', borderRadius: 10, padding: '7px 11px', cursor: 'pointer', color: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center' }}><X size={16} /></button>
            </div>

            {recSuccess ? (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <CheckCircle size={52} color="#22d3a8" style={{ display: 'block', margin: '0 auto 16px' }} />
                <div style={{ fontSize: 18, fontWeight: 700, color: '#22d3a8', marginBottom: 8 }}>Payment Recorded!</div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginBottom: 24 }}>{recForm.description} · ${parseInt(recForm.amount || '0').toLocaleString()}</div>
                <button onClick={() => setShowRecord(false)} style={{ padding: '11px 28px', borderRadius: 10, background: 'rgba(34,211,168,0.15)', border: '1px solid rgba(34,211,168,0.4)', color: '#22d3a8', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>Done</button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Type toggle */}
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 8, fontWeight: 600 }}>Payment Type</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[{ v: 'income', label: '+ Income', color: '#22d3a8' }, { v: 'expense', label: '− Expense', color: '#f43f5e' }].map(opt => (
                      <button key={opt.v} onClick={() => setRecForm(f => ({ ...f, type: opt.v }))}
                        style={{ flex: 1, padding: '11px', borderRadius: 10, background: recForm.type === opt.v ? `${opt.color}1e` : 'rgba(255,255,255,0.04)', border: `1px solid ${recForm.type === opt.v ? `${opt.color}55` : 'rgba(255,255,255,0.1)'}`, color: recForm.type === opt.v ? opt.color : 'rgba(255,255,255,0.4)', fontWeight: 700, cursor: 'pointer', fontSize: 14, transition: 'all 0.2s' }}
                      >{opt.label}</button>
                    ))}
                  </div>
                </div>

                {/* Fields */}
                {[
                  { label: 'Description', key: 'description', placeholder: 'e.g. Engine Parts Co. payment', type: 'text' },
                  { label: 'Amount ($)',  key: 'amount',      placeholder: 'e.g. 4500',                    type: 'number' },
                  { label: 'Vendor / Source (optional)', key: 'vendor', placeholder: 'e.g. AutoParts Ltd.', type: 'text' },
                ].map(field => (
                  <div key={field.key}>
                    <label style={{ display: 'block', fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6, fontWeight: 600 }}>{field.label}</label>
                    <input
                      type={field.type} value={(recForm as any)[field.key]}
                      onChange={e => setRecForm(f => ({ ...f, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                      style={{ width: '100%', padding: '11px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>
                ))}

                <button
                  disabled={!recForm.description || !recForm.amount}
                  onClick={async () => {
                    const amt = parseInt(recForm.amount) || 0
                    const now = new Date().toISOString()
                    const { error } = await supabase.from('financial_transactions').insert({
                      type: recForm.type,
                      category: recForm.type === 'income' ? 'Sale' : 'Procurement',
                      description: recForm.description,
                      amount: amt,
                      vendor: recForm.vendor || null,
                      status: 'Completed',
                      date: now,
                      created_at: now,
                    })
                    if (error) console.error('financial_transactions insert failed:', error.message)
                    await fetchAll() // re-fetch so totals, charts, and ledger all stay consistent
                    setRecSuccess(true)
                  }}
                  style={{ padding: '13px', borderRadius: 12, background: recForm.description && recForm.amount ? 'rgba(108,99,255,0.25)' : 'rgba(255,255,255,0.05)', border: `1px solid ${recForm.description && recForm.amount ? 'rgba(108,99,255,0.55)' : 'rgba(255,255,255,0.1)'}`, color: recForm.description && recForm.amount ? '#a78bfa' : 'rgba(255,255,255,0.3)', fontWeight: 700, cursor: recForm.description && recForm.amount ? 'pointer' : 'not-allowed', fontSize: 14, marginTop: 4, transition: 'box-shadow 0.2s' }}
                  onMouseEnter={e => { if (recForm.description && recForm.amount) (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 1px rgba(108,99,255,0.7), 0 0 20px rgba(108,99,255,0.3)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '' }}
                >
                  Record Payment
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

    </div>
  )
}
