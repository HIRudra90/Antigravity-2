import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabaseClient'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, Sector,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import {
  DollarSign, TrendingUp, TrendingDown, CreditCard, CheckCircle, Clock,
  RefreshCw, X, ArrowUpRight, ArrowDownRight, Wallet, Building2,
  ArrowRightLeft, Plus, Truck, Package, Users, UserCheck, Pencil,
} from 'lucide-react'

const fmt = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M`
  : v >= 1_000 ? `$${(v / 1_000).toFixed(1)}k`
  : `$${Math.round(v).toLocaleString()}`

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

function VendorHistoryModal({ vendor, orders, onClose, onConfirmDelivery, confirmingId }: { vendor: any; orders: any[]; onClose: () => void; onConfirmDelivery: (id: string) => void; confirmingId: string | null }) {
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
                    Ordered {o.ordered_at ? new Date(o.ordered_at).toLocaleDateString() : '—'}
                    {o.paid_at && <> · Paid {new Date(o.paid_at).toLocaleDateString()}</>}
                    {o.expected_delivery && <> · ETA {new Date(o.expected_delivery).toLocaleDateString()}</>}
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
  const [tab, setTab] = useState<Tab>('overview')
  const [loading, setLoading] = useState(true)

  // Financial totals
  const [totalRevenue, setTotalRevenue] = useState(0)
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

  // Payroll
  const [employees, setEmployees] = useState<any[]>([])
  const [salaryPayments, setSalaryPayments] = useState<any[]>([])
  const [payingEmp, setPayingEmp] = useState<string | null>(null)
  const [payingAll, setPayingAll] = useState(false)
  const [totalPayroll, setTotalPayroll] = useState(0)
  const [historyVendor, setHistoryVendor] = useState<any | null>(null)
  const [confirmingDelivery, setConfirmingDelivery] = useState<string | null>(null)
  const [activeExpenseIdx, setActiveExpenseIdx] = useState<number | null>(null)
  const [hoverExpenseIdx, setHoverExpenseIdx] = useState<number | null>(null)

  // Cash balance
  const [cashBalance, setCashBalance] = useState(0)
  const [editingBalance, setEditingBalance] = useState(false)
  const [balanceInput, setBalanceInput] = useState('')
  const [savingBalance, setSavingBalance] = useState(false)

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
      if (e.key === 'Escape') { setSelectedTxn(null); setShowRecord(false); setSelectedKpi(null); setEditingBalance(false); setHistoryVendor(null) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  async function confirmDelivery(orderId: string) {
    setConfirmingDelivery(orderId)
    const order = vendorOrders.find((o: any) => o.id === orderId)
    const updates: any = { status: 'Delivered' }
    // Safety net: if this order somehow never got a payment timestamp
    // (e.g. placed before paid_at existed), back-fill it now.
    if (!order?.paid_at) updates.paid_at = new Date().toISOString()
    const { error } = await supabase.from('restock_orders').update(updates).eq('id', orderId)
    if (error) console.error('confirmDelivery failed:', error.message)
    await fetchAll()
    setConfirmingDelivery(null)
  }

  async function fetchCashBalance() {
    const { data } = await supabase.from('app_settings').select('setting_value').eq('setting_key', 'cash_balance').single()
    if (data) setCashBalance(Number(data.setting_value) || 0)
  }

  async function saveCashBalance(val: number) {
    setSavingBalance(true)
    setCashBalance(val) // update immediately — don't wait for DB
    setEditingBalance(false)
    const { error } = await supabase.from('app_settings').upsert(
      { setting_key: 'cash_balance', setting_value: String(val), updated_at: new Date().toISOString() },
      { onConflict: 'setting_key' }
    )
    if (error) console.error('cash_balance save failed:', error.message)
    setSavingBalance(false)
  }

  async function fetchAll() {
    setLoading(true)
    try {
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
      ] = await Promise.all([
        supabase.from('sales_transactions')
          .select('id, sale_date, quantity_sold, products(name, unit_price, family)')
          .order('sale_date', { ascending: false }).limit(200),
        supabase.from('shipments')
          .select('id, tracking_no, carrier, status_code, price, created_at, recipient_city')
          .order('created_at', { ascending: false }).limit(200),
        supabase.from('restock_orders').select('*').order('ordered_at', { ascending: false }).limit(200),
        supabase.from('vendors').select('*'),
        supabase.from('employees').select('*').order('name'),
        supabase.from('salary_payments').select('*')
          .eq('payment_month', currentMonth).eq('payment_year', currentYear),
        supabase.from('financial_transactions').select('*').order('created_at', { ascending: false }).limit(200),
      ])

      const salesArr   = (sales      as any[]) || []
      const shipArr    = (shipments  as any[]) || []
      const restockArr = (restockRaw as any[]) || []
      const vendorArr  = (vendorData as any[]) || []
      const empArr     = (empData    as any[]) || []
      const salArr     = (salaryData as any[]) || []
      const manualArr  = (manualRaw  as any[]) || []

      // ── Manual ledger entries (from Record Payment) — only true manual entries live here now
      let manualIncome = 0, manualExpense = 0
      const manualLedger = manualArr.map((m: any, i: number) => {
        const amt = Math.round(Number(m.amount) || 0)
        if (m.type === 'income') manualIncome += amt
        else manualExpense += amt
        return {
          id: `MAN-${m.id || i}`,
          type: m.type,
          category: m.category || (m.type === 'income' ? 'Sale' : 'Procurement'),
          description: m.description || 'Manual entry',
          amount: amt,
          date: m.date || m.created_at,
          status: m.status || 'Completed',
          vendor: m.vendor || '',
        }
      })

      // Ensure salary_payments rows exist for all employees this month
      const missingEmpIds = empArr.filter(e => !salArr.find((s: any) => s.employee_id === e.id)).map(e => e.id)
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
      const payroll = empArr.reduce((a: number, e: any) => a + Number(e.monthly_salary || 0), 0)
      setTotalPayroll(payroll)

      // ── Revenue ledger
      let rev = 0
      const saleLedger = salesArr.map(s => {
        const p = Array.isArray(s.products) ? s.products[0] : s.products
        const amount = Math.round((s.quantity_sold || 0) * parseFloat(p?.unit_price || '0'))
        rev += amount
        return { id: `TXN-${s.id}`, type: 'income', category: 'Sale', description: p?.name || 'Product Sale', family: p?.family || '', amount, date: s.sale_date, status: 'Completed' }
      })
      rev += manualIncome
      setTotalRevenue(rev)

      // ── Shipping ledger
      let ship = 0
      const shipLedger = shipArr.map(s => {
        const cost = parseFloat(s.price || '0')
        ship += cost
        return { id: `SHP-${s.id}`, type: 'expense', category: 'Shipping', description: `${s.carrier || 'Carrier'} · ${s.recipient_city || 'Delivery'}`, amount: Math.round(cost), date: s.created_at, status: Number(s.status_code) >= 700 ? 'Completed' : Number(s.status_code) >= 500 ? 'In Transit' : 'Pending' }
      })
      setTotalShipping(Math.round(ship))

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
        // Ledger status reflects whether payment cleared (paid_at), not delivery progress
        return { id: `PO-${r.id || i}`, type: 'expense', category: 'Procurement', description, amount, date: r.ordered_at || r.created_at || r.eta, status: r.paid_at ? 'Completed' : 'Pending', vendor: vendorLabel }
      })
      proc += manualExpense
      setTotalProcurement(Math.round(proc))

      // ── Payroll ledger entries (must be defined before combined)
      const payrollLedger = empArr.map((e: any) => {
        const sp = salArr.find((s: any) => s.employee_id === e.id)
        const payDate = sp?.paid_at || new Date(currentYear, currentMonth - 1, 1).toISOString()
        return {
          id: `SAL-${e.id}`,
          type: 'expense',
          category: 'Payroll',
          description: `${e.name} — ${e.role}`,
          amount: Number(e.monthly_salary || 0),
          date: payDate,
          status: sp?.status === 'Paid' ? 'Completed' : 'Pending',
          vendor: '',
        }
      })

      // ── Combined ledger sorted by date
      const combined = [...saleLedger, ...shipLedger, ...procLedger, ...payrollLedger, ...manualLedger]
        .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
      setAllTransactions(combined)

      // ── Monthly chart — fully computed from real records (no RPC dependency)
      const last6: { key: string; label: string }[] = []
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        last6.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleString('en', { month: 'short' }) })
      }

      const revByMonth: Record<string, number> = {}
      salesArr.forEach(s => {
        if (!s.sale_date) return
        const d = new Date(s.sale_date)
        const key = `${d.getFullYear()}-${d.getMonth()}`
        const p = Array.isArray(s.products) ? s.products[0] : s.products
        revByMonth[key] = (revByMonth[key] || 0) + (s.quantity_sold || 0) * parseFloat(p?.unit_price || '0')
      })

      const shipByMonth: Record<string, number> = {}
      shipArr.forEach(s => {
        if (!s.created_at) return
        const d = new Date(s.created_at)
        const key = `${d.getFullYear()}-${d.getMonth()}`
        shipByMonth[key] = (shipByMonth[key] || 0) + parseFloat(s.price || '0')
      })

      const procByMonth: Record<string, number> = {}
      restockArr.forEach(r => {
        const dateStr = r.ordered_at || r.created_at
        if (!dateStr) return
        const d = new Date(dateStr)
        const key = `${d.getFullYear()}-${d.getMonth()}`
        procByMonth[key] = (procByMonth[key] || 0) + (Number(r.total_cost) || 0)
      })

      manualArr.forEach((m: any) => {
        const dateStr = m.date || m.created_at
        if (!dateStr) return
        const d = new Date(dateStr)
        const key = `${d.getFullYear()}-${d.getMonth()}`
        const amt = Number(m.amount) || 0
        if (m.type === 'income') revByMonth[key] = (revByMonth[key] || 0) + amt
        else procByMonth[key] = (procByMonth[key] || 0) + amt
      })

      setMonthlyData(last6.map(({ key, label }) => {
        const income   = Math.round(revByMonth[key] || 0)
        const expenses = Math.round((shipByMonth[key] || 0) + (procByMonth[key] || 0) + payroll)
        return { month: label, income, expenses, profit: income - expenses }
      }))

      // ── Expense breakdown (now including payroll)
      const payrollTotal = empArr.reduce((a: number, e: any) => a + Number(e.monthly_salary || 0), 0)
      setExpenseBreakdown([
        { name: 'Payroll',     value: Math.max(Math.round(payrollTotal), 1), color: '#a78bfa' },
        { name: 'Procurement', value: Math.max(Math.round(proc), 1),    color: '#f43f5e' },
        { name: 'Shipping',    value: Math.max(Math.round(ship), 1),    color: '#f59e0b' },
        { name: 'Operations',  value: Math.max(Math.round(rev * 0.04), 1), color: '#6C63FF' },
      ])

      setVendors(vendorArr)
      setVendorOrders(restockArr)
    } catch (err) {
      console.error('Payment fetch:', err)
    } finally {
      setLoading(false)
    }
  }

  const totalExpenses  = totalShipping + totalProcurement + totalPayroll
  const netProfit      = totalRevenue - totalExpenses
  const profitMargin   = totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 1000) / 10 : 0
  const cashFlow       = totalRevenue > 0 ? Math.round(totalRevenue * 0.13) : 0

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
      Operations: {
        count: 1,
        tier: 'Estimated',
        insight: 'Estimated overhead (4% of revenue) — rent, utilities, and other costs not yet itemized in the ledger.',
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
    { label: 'Total Revenue',   value: fmt(totalRevenue),         color: '#22d3a8', sub: 'All sales income',         icon: TrendingUp,     change: '+12.4%', up: true },
    { label: 'Total Expenses',  value: fmt(totalExpenses),        color: '#f43f5e', sub: 'Payroll + Procurement + Shipping',   icon: TrendingDown,   change: '+3.1%',  up: false },
    { label: 'Net Profit',      value: fmt(Math.abs(netProfit)),  color: netProfit >= 0 ? '#6C63FF' : '#f43f5e', sub: `${profitMargin >= 0 ? '+' : ''}${profitMargin}% margin`, icon: Wallet, change: `${profitMargin}%`, up: netProfit >= 0 },
    { label: 'Monthly Cash Flow', value: fmt(cashFlow),           color: '#00D4FF', sub: 'Estimated this month',     icon: ArrowRightLeft, change: '+7.8%',  up: true },
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
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Financial Control Center</h1>
          <p>Complete money flow — revenue, expenses, vendor payments &amp; profit reports</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost btn-sm" onClick={fetchAll}><RefreshCw size={14} /></button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => { setRecForm({ description: '', amount: '', type: 'expense', vendor: '' }); setRecSuccess(false); setShowRecord(true) }}
          >
            <Plus size={14} /> Record Payment
          </button>
        </div>
      </div>

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

      {/* Cash Balance card */}
      <div style={{ marginBottom: 22, padding: '20px 24px', borderRadius: 16, background: 'rgba(34,211,168,0.06)', border: '1px solid rgba(34,211,168,0.2)', display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap', transition: 'box-shadow 0.2s' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 1px rgba(34,211,168,0.4), 0 0 24px rgba(34,211,168,0.15)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '' }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(34,211,168,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Wallet size={20} color="#22d3a8" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 4, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Cash Balance</div>
          {editingBalance ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20, color: '#22d3a8', fontWeight: 700 }}>$</span>
              <input
                autoFocus
                type="number"
                min={0}
                value={balanceInput}
                onChange={e => setBalanceInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveCashBalance(parseFloat(balanceInput) || 0); if (e.key === 'Escape') setEditingBalance(false) }}
                style={{ background: 'rgba(34,211,168,0.1)', border: '1px solid rgba(34,211,168,0.4)', borderRadius: 8, padding: '6px 12px', color: '#fff', fontSize: 22, fontWeight: 700, width: 180, outline: 'none' }}
              />
              <button className="btn btn-primary btn-sm" onClick={() => saveCashBalance(parseFloat(balanceInput) || 0)} disabled={savingBalance} style={{ fontSize: 13 }}>
                {savingBalance ? '…' : 'Save'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditingBalance(false)} style={{ fontSize: 13 }}>Cancel</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: '#22d3a8' }}>{fmt(cashBalance)}</span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => { setBalanceInput(String(cashBalance)); setEditingBalance(true) }}
                style={{ fontSize: 12, color: 'rgba(34,211,168,0.7)', borderColor: 'rgba(34,211,168,0.2)' }}
              >
                <Pencil size={12} /> Edit
              </button>
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>After expenses</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: cashBalance - totalExpenses >= 0 ? '#22d3a8' : '#f43f5e' }}>
            {fmt(cashBalance - totalExpenses)}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 2 }}>remaining after costs</div>
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
                  <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${Math.round(v / 1000)}k`} />
                  <Tooltip
                    cursor={false}
                    contentStyle={{ background: 'rgba(5,8,16,0.96)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '10px 16px' }}
                    formatter={(v: any, name: string) => [`$${Number(v).toLocaleString()}`, name === 'income' ? 'Revenue' : 'Expenses']}
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
                <tr><th>Date</th><th>Type</th><th>Description</th><th>Amount</th><th>Status</th></tr>
              </thead>
              <tbody>
                {allTransactions.slice(0, 10).map(t => (
                  <tr key={t.id} onClick={() => setSelectedTxn(t)}
                    style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(108,99,255,0.08)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
                  >
                    <td style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
                      {t.date ? new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
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
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: 28, color: 'rgba(255,255,255,0.3)' }}>No transactions found</td></tr>
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
                <tr><th>Date</th><th>Ref #</th><th>Category</th><th>Description</th><th>Amount</th><th>Status</th></tr>
              </thead>
              <tbody>
                {filteredLedger.map(t => (
                  <tr key={t.id} onClick={() => setSelectedTxn(t)}
                    style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(108,99,255,0.08)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
                  >
                    <td style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
                      {t.date ? new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}
                    </td>
                    <td><span style={{ color: '#a78bfa', fontWeight: 600, fontSize: 12 }}>{t.id}</span></td>
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
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: 28, color: 'rgba(255,255,255,0.3)' }}>No entries match the current filter</td></tr>
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
          {/* Vendor cards */}
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
            {vendors.length === 0 && !loading ? (
              <div style={{ textAlign: 'center', padding: '48px', color: 'rgba(255,255,255,0.3)', width: '100%' }}>
                <Building2 size={40} style={{ marginBottom: 14, opacity: 0.25, display: 'block', margin: '0 auto 14px' }} />
                <p>No vendors found. Add vendors in the Restock section.</p>
              </div>
            ) : vendors.slice(0, 6).map(v => {
              const vOrders     = vendorOrders.filter(o => o.vendor_id === v.id)
              const inTransit   = vOrders.filter(o => !['delivered', 'cancelled'].includes((o.status || '').toLowerCase()))
              const totalPaid   = vOrders.filter((o: any) => o.paid_at).reduce((a: number, o: any) => a + Math.round(Number(o.total_cost) || 0), 0)
              const accentCol   = inTransit.length > 0 ? '#f59e0b' : '#22d3a8'
              return (
                <div key={v.id}
                  style={{ flex: '1 1 260px', padding: 22, borderRadius: 18, background: `${accentCol}07`, border: `1px solid ${accentCol}33`, transition: 'box-shadow 0.25s, transform 0.18s' }}
                  onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = `0 0 0 1px ${accentCol}55, 0 0 28px ${accentCol}22`; el.style.transform = 'translateY(-2px)' }}
                  onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = ''; el.style.transform = '' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                    <div>
                      <div style={{ fontWeight: 700, color: '#fff', fontSize: 15, marginBottom: 3 }}>{v.company}</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{v.category}</div>
                    </div>
                    <span style={{ fontSize: 10, padding: '3px 9px', borderRadius: 8, background: `${accentCol}20`, color: accentCol, fontWeight: 700, border: `1px solid ${accentCol}44` }}>
                      {inTransit.length > 0 ? `${inTransit.length} IN TRANSIT` : 'ALL DELIVERED'}
                    </span>
                  </div>

                  {/* Stats row */}
                  <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                    {[
                      { label: 'Orders', value: vOrders.length.toString(), color: '#a78bfa' },
                      { label: 'Total Paid', value: fmt(totalPaid), color: '#22d3a8' },
                      { label: 'Lead', value: `${v.lead_time_days || '—'}d`, color: '#00D4FF' },
                    ].map(s => (
                      <div key={s.label} style={{ flex: 1, textAlign: 'center', padding: '9px 4px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                        <div style={{ fontSize: 15, fontWeight: 800, color: s.color }}>{s.value}</div>
                        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{s.label}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 14 }}>
                    <span style={{ color: 'rgba(255,255,255,0.6)' }}>{v.name}</span> · {v.email || 'No email'}<br />
                    <span style={{ color: accentCol }}>{v.payment_terms || 'Standard terms'} · paid on order</span>
                  </div>

                  <button
                    onClick={() => setHistoryVendor(v)}
                    style={{ width: '100%', padding: '9px', borderRadius: 9, background: 'rgba(108,99,255,0.12)', border: '1px solid rgba(108,99,255,0.3)', color: '#a78bfa', fontWeight: 600, cursor: 'pointer', fontSize: 12, transition: 'box-shadow 0.2s' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 1px rgba(108,99,255,0.5), 0 0 12px rgba(108,99,255,0.25)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '' }}
                  >View Order History →</button>
                </div>
              )
            })}
          </div>

          {/* Full purchase order history */}
          {vendorOrders.length > 0 && (
            <div className="glass-card">
              <div className="section-title">
                Purchase Order History
                <span className="badge badge-accent">{vendorOrders.length} total</span>
                <span className="badge badge-warning">{vendorOrders.filter(o => !['delivered', 'cancelled'].includes((o.status || '').toLowerCase())).length} in transit</span>
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
                          <td style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>{o.paid_at ? new Date(o.paid_at).toLocaleDateString() : '—'}</td>
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
        const paidEmps   = salaryPayments.filter(p => p.status === 'Paid')
        const dueEmps    = salaryPayments.filter(p => p.status !== 'Paid')
        const paidAmount = paidEmps.reduce((a: number, p: any) => a + Number(p.amount), 0)
        const dueAmount  = dueEmps.reduce((a: number, p: any)  => a + Number(p.amount), 0)

        const payEmp = async (empId: string) => {
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
          setSalaryPayments(prev => prev.map(p => ({ ...p, status: 'Paid', paid_at: p.paid_at || new Date().toISOString() })))
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
                { label: 'Total Monthly Payroll', value: `$${totalPayroll.toLocaleString()}`,  color: '#a78bfa', sub: `${employees.length} employees`, icon: Users },
                { label: 'Paid This Month',       value: `$${paidAmount.toLocaleString()}`,    color: '#22d3a8', sub: `${paidEmps.length} employees paid`, icon: UserCheck },
                { label: 'Outstanding (Due)',      value: `$${dueAmount.toLocaleString()}`,     color: dueAmount > 0 ? '#f43f5e' : '#22d3a8', sub: `${dueEmps.length} due`, icon: Clock },
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
                  {dueEmps.length > 0 ? `${dueEmps.length} employees unpaid · $${dueAmount.toLocaleString()} outstanding` : '✓ All employees paid for this month'}
                </div>
              </div>
              {dueEmps.length > 0 && (
                <button onClick={payAll} disabled={payingAll}
                  style={{ padding: '10px 22px', borderRadius: 11, background: 'rgba(34,211,168,0.2)', border: '1px solid rgba(34,211,168,0.5)', color: '#22d3a8', fontWeight: 700, cursor: 'pointer', fontSize: 13, transition: 'box-shadow 0.2s' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 1px rgba(34,211,168,0.7), 0 0 20px rgba(34,211,168,0.3)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '' }}
                >
                  {payingAll ? 'Processing…' : `✓ Pay All Due · $${dueAmount.toLocaleString()}`}
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
                    const sp     = salaryPayments.find(p => p.employee_id === emp.id)
                    const isPaid = sp?.status === 'Paid'
                    const col    = roleColor[emp.role] || '#a78bfa'
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
                          <span className={`badge ${isPaid ? 'badge-success' : 'badge-danger'}`}>
                            {isPaid ? <CheckCircle size={10} /> : <Clock size={10} />} {isPaid ? 'Paid' : 'Due'}
                          </span>
                        </td>
                        <td style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
                          {sp?.paid_at ? new Date(sp.paid_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}
                        </td>
                        <td>
                          {!isPaid ? (
                            <button onClick={() => payEmp(emp.id)} disabled={payingEmp === emp.id}
                              style={{ padding: '6px 16px', borderRadius: 8, background: 'rgba(34,211,168,0.15)', border: '1px solid rgba(34,211,168,0.4)', color: '#22d3a8', fontWeight: 600, cursor: 'pointer', fontSize: 12, transition: 'box-shadow 0.2s' }}
                              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 1px rgba(34,211,168,0.6), 0 0 12px rgba(34,211,168,0.2)' }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '' }}
                            >
                              {payingEmp === emp.id ? 'Paying…' : `Pay $${Number(emp.monthly_salary || 0).toLocaleString()}`}
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
                    { label: 'Total Payroll',  value: `$${totalPayroll.toLocaleString()}`,  color: '#a78bfa' },
                    { label: 'Paid',           value: `$${paidAmount.toLocaleString()} (${paidEmps.length})`, color: '#22d3a8' },
                    { label: 'Due',            value: `$${dueAmount.toLocaleString()} (${dueEmps.length})`,   color: dueAmount > 0 ? '#f43f5e' : '#22d3a8' },
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
                    <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${Math.round(v / 1000)}k`} />
                    <Tooltip
                      cursor={false}
                      contentStyle={{ background: 'rgba(5,8,16,0.96)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '10px 16px' }}
                      formatter={(v: any, name: string) => [`$${Number(v).toLocaleString()}`, name === 'income' ? 'Revenue' : 'Expenses']}
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
                  { label: 'Operating Expenses',  value: fmt(totalRevenue * 0.04), pct: 4,                    color: '#6C63FF' },
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
                            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{t.date ? new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'} · {t.family || 'General'}</div>
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
                      { label: 'Payroll',     value: fmt(totalPayroll),     color: '#a78bfa', pct: totalExpenses > 0 ? Math.round((totalPayroll/totalExpenses)*100) : 0 },
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
                      { label: 'Total Inflow',  value: fmt(totalRevenue),  color: '#22d3a8', icon: '▲' },
                      { label: 'Total Outflow', value: fmt(totalExpenses), color: '#f43f5e', icon: '▼' },
                      { label: 'Net Position',  value: fmt(cashFlow),      color: '#00D4FF', icon: '⇄' },
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
              { label: 'Date',         value: selectedTxn.date ? new Date(selectedTxn.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—' },
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
