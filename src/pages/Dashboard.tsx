import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabaseClient'
import { useLocale } from '../lib/locale'
import { placeRestockOrder, skuFor, COST_RATIO, type EmailVendor } from '../lib/restock'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell,
} from 'recharts'
import {
  Package, TrendingUp, TrendingDown, DollarSign, Activity,
  AlertTriangle, RefreshCw, ArrowUpRight, ArrowDownRight,
  ShoppingCart, X, Send, CheckCircle, Truck,
} from 'lucide-react'

function CustomTooltip({ active, payload, label }: any) {
  const { symbol } = useLocale()
  if (!active || !payload?.length) return null
  return (
    <div className="custom-tooltip">
      <p style={{ color: 'var(--clr-text-muted)', marginBottom: 6, fontSize: 12 }}>{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color, marginBottom: 2 }}>
          {p.name}: <strong>{p.name === 'Sales' ? symbol : ''}{p.value.toLocaleString()}</strong>
        </p>
      ))}
    </div>
  )
}

function MiniCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        flex: '1 1 120px', padding: '14px 16px', borderRadius: 12,
        background: `${color}0d`, border: `1px solid ${color}33`,
        transition: 'box-shadow 0.2s ease, border-color 0.2s ease', cursor: 'default',
      }}
      onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = `0 0 0 1px ${color}66, 0 0 18px ${color}55`; el.style.borderColor = `${color}88` }}
      onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = ''; el.style.borderColor = `${color}33` }}
    >
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color }}>{value}</div>
    </div>
  )
}

/** Small pill button used on every low-stock row. */
function RestockButton({ onClick, done, size = 'sm' }: { onClick: () => void; done?: boolean; size?: 'sm' | 'md' }) {
  const pad = size === 'md' ? '7px 14px' : '5px 11px'
  const font = size === 'md' ? 12 : 11
  if (done) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, padding: pad, borderRadius: 20,
        fontSize: font, fontWeight: 700, background: 'rgba(34,211,168,0.15)',
        color: '#22d3a8', border: '1px solid rgba(34,211,168,0.4)', whiteSpace: 'nowrap',
      }}>
        <CheckCircle size={size === 'md' ? 14 : 12} /> Restocked
      </span>
    )
  }
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick() }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, padding: pad, borderRadius: 20,
        fontSize: font, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
        background: 'rgba(108,99,255,0.18)', color: '#a78bfa',
        border: '1px solid rgba(108,99,255,0.5)', transition: 'box-shadow 0.2s, transform 0.15s',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement
        el.style.boxShadow = '0 0 0 1px rgba(108,99,255,0.7), 0 0 16px rgba(108,99,255,0.5)'
        el.style.transform = 'translateY(-1px)'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement
        el.style.boxShadow = ''; el.style.transform = ''
      }}
    >
      <Truck size={size === 'md' ? 14 : 12} /> Restock
    </button>
  )
}

/**
 * Confirm-and-send panel for restocking one low-stock product.
 *
 * Vendors are matched to a product by category == product family. Most
 * families have no vendor yet, so rather than dead-ending the button we fall
 * back to letting the user pick any active vendor.
 */
function QuickRestockModal({ alert, vendors, onClose, onDone }: {
  alert: any
  vendors: EmailVendor[]
  onClose: () => void
  onDone: (name: string, vendorCompany: string) => void
}) {
  const { symbol } = useLocale()
  const matching = vendors.filter(v => v.category === alert.family)
  const [vendorId, setVendorId] = useState(matching[0]?.id ?? vendors[0]?.id ?? '')
  const [qty, setQty] = useState<number>(alert.suggested)
  const [notes, setNotes] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'error'>('idle')
  const [error, setError] = useState('')

  const vendor = vendors.find(v => v.id === vendorId)
  const unitCost = alert.unit_price * COST_RATIO
  const total = qty * unitCost
  // Lead time drives the delivery date the vendor sees in the email.
  const eta = new Date()
  eta.setDate(eta.getDate() + (vendor?.lead_time_days ?? 7))
  const etaStr = eta.toISOString().split('T')[0]

  async function submit() {
    if (!vendor) { setError('Select a vendor first.'); setState('error'); return }
    if (qty < 1) { setError('Order quantity must be at least 1.'); setState('error'); return }
    setState('sending'); setError('')
    try {
      await placeRestockOrder({
        vendor,
        items: [{
          product_name: alert.name,
          sku: skuFor(alert.product_id),
          quantity: qty,
          unit_cost: Number(unitCost.toFixed(2)),
        }],
        notes,
        expectedDelivery: etaStr,
        inventoryId: alert.inventory_id,
        currentStock: alert.current_stock,
      })
      onDone(alert.name, vendor.company)
    } catch (err: any) {
      setError(err?.text || err?.message || 'Could not place the order.')
      setState('error')
    }
  }

  const field: React.CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: 9, fontSize: 13,
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff',
  }

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 10001, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, background: 'rgba(8,12,28,0.98)', border: '1px solid rgba(108,99,255,0.4)', borderRadius: 22, padding: 28, boxShadow: '0 0 0 1px rgba(108,99,255,0.15), 0 32px 80px rgba(0,0,0,0.8)', animation: 'pageIn 0.2s ease-out', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 }}>
          <div>
            <h2 style={{ fontSize: 19, fontWeight: 800, color: '#fff', marginBottom: 4 }}>Restock Product</h2>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', margin: 0 }}>{alert.name}</p>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(108,99,255,0.4)', borderRadius: 10, padding: '7px 11px', cursor: 'pointer', color: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center' }}><X size={16} /></button>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
          {[
            { label: 'In Stock', value: String(alert.current_stock), color: '#f43f5e' },
            { label: 'Reorder At', value: String(alert.reorder_level ?? '—'), color: '#f59e0b' },
            { label: 'Order Total', value: `${symbol}${total.toFixed(2)}`, color: '#22d3a8' },
          ].map(s => (
            <div key={s.label} style={{ flex: '1 1 90px', padding: '10px 12px', borderRadius: 9, background: `${s.color}0d`, border: `1px solid ${s.color}22` }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        {vendors.length === 0 ? (
          <div style={{ padding: '14px 16px', borderRadius: 10, background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.35)', fontSize: 12, color: '#fda4af', lineHeight: 1.6 }}>
            No vendors exist yet. Add one on the <strong style={{ color: '#fff' }}>Restock</strong> page before ordering.
          </div>
        ) : (
          <>
            <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 5 }}>
              Vendor {matching.length === 0 && <span style={{ color: '#f59e0b' }}>· none registered for {alert.family || 'this category'}</span>}
            </label>
            <select value={vendorId} onChange={e => setVendorId(e.target.value)} style={{ ...field, marginBottom: 14 }}>
              {vendors.map(v => (
                <option key={v.id} value={v.id} style={{ background: '#0b1020' }}>
                  {v.company} — {v.category}{v.email ? '' : ' (no email)'}
                </option>
              ))}
            </select>

            <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 5 }}>Quantity</label>
                <input type="number" min={1} value={qty} onChange={e => setQty(parseInt(e.target.value) || 0)} style={field} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 5 }}>Expected Delivery</label>
                <input type="date" value={etaStr} readOnly style={{ ...field, opacity: 0.65 }} />
              </div>
            </div>

            <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 5 }}>Notes (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Anything the vendor should know…" style={{ ...field, resize: 'vertical', marginBottom: 8 }} />

            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', lineHeight: 1.6, marginBottom: 16 }}>
              Emails the purchase order to <strong style={{ color: '#a78bfa' }}>{vendor?.email || 'no address on file'}</strong>,
              logs it under Restock orders, and raises stock to <strong style={{ color: '#fff' }}>{alert.current_stock + qty}</strong>.
            </p>

            {state === 'error' && (
              <div style={{ padding: '11px 14px', borderRadius: 9, background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.4)', fontSize: 12, color: '#fda4af', marginBottom: 14, lineHeight: 1.6, wordBreak: 'break-word' }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-ghost" onClick={onClose} disabled={state === 'sending'} style={{ flex: '0 0 auto' }}>Cancel</button>
              <button
                className="btn"
                onClick={submit}
                disabled={state === 'sending' || !vendor?.email}
                style={{ flex: 1, justifyContent: 'center', opacity: state === 'sending' || !vendor?.email ? 0.6 : 1 }}
              >
                {state === 'sending'
                  ? <><RefreshCw size={14} className="spin" /> Sending…</>
                  : <><Send size={14} /> Send Order & Mark Restocked</>}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}

function StatModal({ card, onClose, data, onRestock, restocked }: {
  card: string; onClose: () => void
  data: { rawStats: any; salesData: any[]; recentOrders: any[]; alerts: any[] }
  onRestock: (a: any) => void
  restocked: Set<string>
}) {
  const { symbol, moneyShort: fmt } = useLocale()
  const { rawStats, salesData, recentOrders, alerts } = data

  const glowMap: Record<string, string> = {
    orders: '#6C63FF', revenue: '#00D4FF', today: '#22d3a8', lowstock: '#f43f5e',
  }
  const titleMap: Record<string, string> = {
    orders: 'Total Orders', revenue: 'Revenue Overview',
    today: 'Orders Today', lowstock: 'Low Stock Items',
  }
  const subtitleMap: Record<string, string> = {
    orders:   'Full order history and daily breakdown',
    revenue:  'Revenue trends and daily performance',
    today:    "Today's order activity vs recent days",
    lowstock: 'Products requiring restock attention',
  }
  const accent = glowMap[card] || '#6C63FF'

  const dailyAvgRev = salesData.length ? Math.round(salesData.reduce((a, d) => a + d.sales, 0) / salesData.length) : 0
  const bestDay = salesData.length ? salesData.reduce((a, b) => a.sales > b.sales ? a : b) : null
  const criticalAlerts = alerts.filter(a => a.color === '#f43f5e')
  const restockCost = alerts.reduce((s, a) => s + a.suggested * (a.unit_price || 0) * COST_RATIO, 0)

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'rgba(8,12,28,0.98)', border: `1px solid ${accent}33`,
          boxShadow: `0 0 0 1px ${accent}22, 0 0 40px ${accent}22, 0 32px 80px rgba(0,0,0,0.8)`,
          borderRadius: 22, padding: 32, width: '100%', maxWidth: 660,
          maxHeight: '88vh', overflowY: 'auto', animation: 'pageIn 0.2s ease-out',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 26 }}>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 4 }}>{titleMap[card]}</h2>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>{subtitleMap[card]}</p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${accent}44`, borderRadius: 10, padding: '7px 11px', cursor: 'pointer', color: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center', transition: 'box-shadow 0.2s' }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = `0 0 0 1px ${accent}77, 0 0 14px ${accent}55` }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '' }}
          ><X size={16} /></button>
        </div>

        {/* ── TOTAL ORDERS ── */}
        {card === 'orders' && (
          <>
            <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
              <MiniCard label="Total Orders"  value={rawStats.totalOrders.toLocaleString()} color="#6C63FF" />
              <MiniCard label="Orders Today"  value={rawStats.ordersToday.toString()}        color="#22d3a8" />
              <MiniCard label="This Month"    value={rawStats.ordersThisMonth.toLocaleString()} color="#00D4FF" />
              <MiniCard label="MoM Growth"    value={rawStats.orderPct ?? '—'}               color="#f59e0b" />
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>Daily Revenue (Last 7 Days)</div>
            <div style={{ height: 200, marginBottom: 24 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={salesData} barCategoryGap="35%">
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="time" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `${symbol}${v/1000}k`} />
                  <Tooltip cursor={false} contentStyle={{ background: 'rgba(5,8,16,0.96)', border: '1px solid #6C63FF44', borderRadius: 12, padding: '10px 16px' }} formatter={(v: any) => [`${symbol}${(+v).toLocaleString()}`, 'Revenue']} />
                  <Bar dataKey="sales" fill="#6C63FF" radius={[6,6,0,0]} activeBar={{ fill: '#6C63FF', strokeWidth: 0, filter: 'drop-shadow(0 0 8px #6C63FF) brightness(1.3)' }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 12 }}>Recent Orders</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  {['Order ID', 'Product', 'Amount', 'Status'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 0', color: 'rgba(255,255,255,0.35)', fontWeight: 600, fontSize: 11 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((o, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '10px 0', color: '#a78bfa', fontWeight: 600 }}>{o.id}</td>
                    <td style={{ padding: '10px 0', color: 'rgba(255,255,255,0.7)' }}>{o.product}</td>
                    <td style={{ padding: '10px 0', color: '#22d3a8', fontWeight: 700 }}>{o.amount}</td>
                    <td style={{ padding: '10px 0' }}><span className="badge badge-success">{o.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* ── REVENUE ── */}
        {card === 'revenue' && (
          <>
            <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
              <MiniCard label="Total Revenue"  value={fmt(rawStats.revenue)}     color="#00D4FF" />
              <MiniCard label="Daily Avg"      value={fmt(dailyAvgRev)}           color="#6C63FF" />
              <MiniCard label="Best Day"       value={bestDay?.time ?? '—'}       color="#22d3a8" />
              <MiniCard label="MoM Growth"     value={rawStats.revPct ?? '—'}     color="#f59e0b" />
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>Revenue — Last 7 Days</div>
            <div style={{ height: 210, marginBottom: 24 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={salesData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="time" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `${symbol}${v/1000}k`} />
                  <Tooltip contentStyle={{ background: 'rgba(5,8,16,0.96)', border: '1px solid #00D4FF44', borderRadius: 12, padding: '10px 16px' }} formatter={(v: any) => [`${symbol}${(+v).toLocaleString()}`, 'Revenue']} />
                  <Line type="monotone" dataKey="sales" stroke="#00D4FF" strokeWidth={3} dot={{ fill: '#00D4FF', r: 5, stroke: '#fff', strokeWidth: 1 }} activeDot={{ r: 8, stroke: '#fff', strokeWidth: 2, filter: 'drop-shadow(0 0 10px #00D4FF)' }} name="Revenue" />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 12 }}>Day-by-Day Breakdown</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {salesData.map((d, i) => {
                const maxVal = Math.max(...salesData.map(x => x.sales)) || 1
                const pct = (d.sales / maxVal) * 100
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', width: 36, flexShrink: 0 }}>{d.time}</span>
                    <div style={{ flex: 1, height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: '#00D4FF', borderRadius: 4, boxShadow: '0 0 8px #00D4FF88', transition: 'width 0.4s ease' }} />
                    </div>
                    <span style={{ fontSize: 12, color: '#00D4FF', fontWeight: 700, width: 70, textAlign: 'right' }}>${d.sales.toLocaleString()}</span>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* ── ORDERS TODAY ── */}
        {card === 'today' && (
          <>
            <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
              <MiniCard label="Orders Today"  value={rawStats.ordersToday.toString()}  color="#22d3a8" />
              <MiniCard label="Total Orders"  value={rawStats.totalOrders.toLocaleString()} color="#6C63FF" />
              <MiniCard
                label="vs Yesterday"
                value={`${rawStats.ordersToday - rawStats.ordersYesterday >= 0 ? '+' : ''}${rawStats.ordersToday - rawStats.ordersYesterday}`}
                color="#00D4FF"
              />
              <MiniCard label="Yesterday"     value={rawStats.ordersYesterday.toString()} color="#f59e0b" />
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>Daily Activity (Last 7 Days)</div>
            <div style={{ height: 200, marginBottom: 24 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={salesData} barCategoryGap="35%">
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="time" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `${symbol}${v/1000}k`} />
                  <Tooltip cursor={false} contentStyle={{ background: 'rgba(5,8,16,0.96)', border: '1px solid #22d3a844', borderRadius: 12, padding: '10px 16px' }} formatter={(v: any) => [`${symbol}${(+v).toLocaleString()}`, 'Revenue']} />
                  <Bar dataKey="sales" radius={[6,6,0,0]} activeBar={{ strokeWidth: 0, filter: 'drop-shadow(0 0 8px #22d3a8) brightness(1.3)' }}>
                    {salesData.map((_, i) => (
                      <Cell key={i} fill={i === salesData.length - 1 ? '#22d3a8' : 'rgba(34,211,168,0.4)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 12 }}>Latest Activity</div>
            {recentOrders.slice(0, 4).map((o, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{o.product}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{o.id} · {o.date}</div>
                </div>
                <span style={{ fontSize: 14, fontWeight: 800, color: '#22d3a8' }}>{o.amount}</span>
              </div>
            ))}
          </>
        )}

        {/* ── LOW STOCK ── */}
        {card === 'lowstock' && (
          <>
            <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
              <MiniCard label="Low Stock"    value={rawStats.lowStockCount.toString()} color="#f43f5e" />
              <MiniCard label="Critical"     value={criticalAlerts.length.toString()}  color="#f43f5e" />
              <MiniCard label="Warnings"     value={(alerts.length - criticalAlerts.length).toString()} color="#f59e0b" />
              {/* There is no stock-level history table, so a real month-over-month
                  comparison is not available. Show what restocking everything on
                  this list would actually cost instead of inventing a trend. */}
              <MiniCard label="Restock Cost" value={`${symbol}${Math.round(restockCost).toLocaleString()}`} color="#22d3a8" />
            </div>
            {alerts.length > 0 ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 14 }}>Stock Alerts — Action Required</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {alerts.map((a, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 12, background: `${a.color}0a`, border: `1px solid ${a.color}33` }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: `${a.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 0 10px ${a.color}44` }}>
                        <AlertTriangle size={16} color={a.color} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 3 }}>{a.text}</div>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                          {a.color === '#f43f5e' ? '🔴 Critical — out of stock' : '🟡 Warning — below reorder level'}
                          {' · '}suggest +{a.suggested}
                        </div>
                      </div>
                      <RestockButton onClick={() => onRestock(a)} done={restocked.has(a.name)} />
                      <span style={{ fontSize: 11, padding: '4px 10px', borderRadius: 20, background: `${a.color}22`, color: a.color, fontWeight: 700, border: `1px solid ${a.color}44` }}>
                        {a.color === '#f43f5e' ? 'CRITICAL' : 'LOW'}
                      </span>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 20, padding: '14px 18px', borderRadius: 12, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b', marginBottom: 4 }}>Recommended Action</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                    Hit <strong style={{ color: '#fff' }}>Restock</strong> on any row to email that vendor a purchase order and top the stock back up.
                    Restocking every item above costs about <strong style={{ color: '#22d3a8' }}>${Math.round(restockCost).toLocaleString()}</strong>.
                  </div>
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgba(255,255,255,0.3)' }}>
                <Package size={36} style={{ display: 'block', margin: '0 auto 12px', opacity: 0.3 }} />
                <p>All stock levels are healthy</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  )
}

export default function Dashboard() {
  const { symbol, moneyShort, fmtDate, fmtTime } = useLocale()
  const [salesData, setSalesData] = useState<any[]>([])
  const [recentOrders, setRecentOrders] = useState<any[]>([])
  const [alerts, setAlerts] = useState<any[]>([])
  const [stats, setStats] = useState<any[]>([])
  const [rawStats, setRawStats] = useState({
    totalOrders: 0, revenue: 0, ordersToday: 0, lowStockCount: 0,
    ordersThisMonth: 0, ordersLastMonth: 0, revenueThisMonth: 0, revenueLastMonth: 0,
    ordersYesterday: 0, outOfStock: 0,
    orderPct: null as string | null, revPct: null as string | null,
  })
  const [loading, setLoading] = useState(true)
  const [modalCard, setModalCard] = useState<string | null>(null)
  const [selectedAlert, setSelectedAlert] = useState<any | null>(null)
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null)
  const [showAllOrders, setShowAllOrders] = useState(false)
  const [vendors, setVendors] = useState<EmailVendor[]>([])
  const [restockTarget, setRestockTarget] = useState<any | null>(null)
  const [restocked, setRestocked] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState('')
  const [liveAt, setLiveAt] = useState<Date | null>(null)

  useEffect(() => { fetchDashboardData(); fetchVendors() }, [])
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { setModalCard(null); setSelectedOrder(null); setShowAllOrders(false); setRestockTarget(null) } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // ── Live updates ────────────────────────────────────────────────
  // Postgres change events push a refresh, so a sale rung up elsewhere or a
  // stock correction shows here without a manual reload. Events arrive in
  // bursts (a restock writes an order and an inventory row), so refetches are
  // debounced rather than fired per event.
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const scheduleRefetch = () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current)
      refetchTimer.current = setTimeout(() => { fetchDashboardData({ silent: true }) }, 600)
    }

    const channel = supabase
      .channel('dashboard-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_transactions' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restock_orders' }, scheduleRefetch)
      .subscribe()

    // Realtime drops silently when a tab is backgrounded or the socket dies,
    // so a slow poll backs it up. Only runs while the tab is visible.
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') fetchDashboardData({ silent: true })
    }, 60_000)

    const onVisible = () => { if (document.visibilityState === 'visible') fetchDashboardData({ silent: true }) }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current)
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(channel)
    }
  }, [])

  async function fetchVendors() {
    const { data } = await supabase
      .from('vendors')
      .select('id, name, company, email, category, payment_terms, lead_time_days, status')
      .eq('status', 'Active')
      .order('category')
    setVendors((data as EmailVendor[]) || [])
  }

  async function fetchDashboardData({ silent = false }: { silent?: boolean } = {}) {
    // A live refresh must not blank the page out from under the user, so only
    // the first/manual load shows the skeleton.
    if (!silent) setLoading(true)
    try {
      const today = new Date().toISOString().split('T')[0]

      // Two bounded reads replace what used to be "pull the whole sales table
      // and count it in JS". That read was capped at PostgREST's 1000-row
      // ceiling, so every total was computed from a slice of the table.
      //
      // The recent list also needs `id` as a tie-break: sale_date is a DATE,
      // so a day's worth of rows all compare equal and Postgres returns them
      // in whatever order it likes. A just-placed order sat somewhere in the
      // middle of today's ties and never reached the top 5.
      //
      // The overview is fetched first rather than alongside, because it
      // carries the accounting epoch and the recent-orders query needs it as
      // a server-side filter. Trimming those rows client-side would not work:
      // .limit(5) is applied before the response is sent, so filtering after
      // the fact can only shrink an already truncated list — five pre-reset
      // orders in, nothing out, even with newer sales further down the table.
      const overviewRes = await supabase.rpc('get_sales_overview')
      if (overviewRes.error) throw overviewRes.error

      const ov: any = Array.isArray(overviewRes.data) ? overviewRes.data[0] : overviewRes.data

      // Falling back to the epoch (rather than to "no filter") keeps a missing
      // value from silently readmitting the entire sales history.
      const epoch = ov?.opened_at ?? new Date(0).toISOString()

      const recentRes = await supabase
        .from('sales_transactions')
        .select(`id, sale_date, quantity_sold, on_promotion, products (name, unit_price, family)`)
        .gte('created_at', epoch)
        .order('sale_date', { ascending: false })
        .order('id', { ascending: false })
        .limit(5)

      if (recentRes.error) throw recentRes.error

      const recent = recentRes.data

      if (recent && ov) {
        // The KPI cards above stay epoch-scoped — they are the accounting
        // figures. This is a 7-day trend line, and drawing it from the epoch
        // renders a single point until a week has passed since the reset.
        const { data: dailyRev } = await supabase.rpc('get_daily_revenue', { days_back: 6, p_all_history: true })
        const dateRevMap: Record<string, number> = {}
        if (dailyRev) (dailyRev as any[]).forEach((r: any) => { dateRevMap[r.sale_date] = Number(r.revenue) })
        const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
        const chartData = Array.from({length: 7}, (_, i) => {
          const d = new Date(); d.setDate(d.getDate() - (6 - i))
          const dateStr = d.toISOString().split('T')[0]
          return { time: DAYS_SHORT[d.getDay()], sales: Math.round(dateRevMap[dateStr] || 0) }
        })
        setSalesData(chartData)

        setRecentOrders(recent.map((s: any) => {
          const product = Array.isArray(s.products) ? s.products[0] : s.products
          const unitPrice = Number(product?.unit_price) || 0
          return {
            id: `#ORD-${s.id}`,
            product: product?.name || 'Unknown product',
            family: product?.family || '—',
            quantity: s.quantity_sold,
            unitPrice,
            amount: `${symbol}${(s.quantity_sold * unitPrice).toLocaleString()}`,
            promo: !!s.on_promotion,
            status: 'Completed',
            date: s.sale_date === today ? 'Today' : s.sale_date,
          }
        }))

        // ── Real period-over-period deltas ──────────────────────────
        // Measured in SQL over the whole table. The month boundaries come
        // from the database clock too, so the comparison can't drift from
        // the dates the rows were actually written with.
        const totalOrders = Number(ov.total_orders) || 0
        const totalRevenue = Number(ov.total_revenue) || 0
        const ordersToday = Number(ov.orders_today) || 0
        const ordersYesterday = Number(ov.orders_yesterday) || 0
        const ordersThisMonth = Number(ov.orders_this_month) || 0
        const ordersLastMonth = Number(ov.orders_last_month) || 0
        const revenueThisMonth = Number(ov.revenue_this_month) || 0
        const revenueLastMonth = Number(ov.revenue_last_month) || 0

        // With no prior month to compare against, a percentage would be
        // meaningless — say "no prior month" rather than print a number.
        const pctChange = (curr: number, prev: number) =>
          prev > 0 ? `${curr >= prev ? '+' : ''}${(((curr - prev) / prev) * 100).toFixed(1)}%` : null

        const orderPct = pctChange(ordersThisMonth, ordersLastMonth)
        const revPct = pctChange(revenueThisMonth, revenueLastMonth)
        const todayDelta = ordersToday - ordersYesterday

        const { data: invData } = await supabase
          .from('inventory')
          .select('id, product_id, current_stock, reorder_level, products(id, name, family, unit_price)')
        const actualLowStock = invData?.filter((i: any) => i.current_stock <= i.reorder_level) || []
        const outOfStock = actualLowStock.filter((i: any) => i.current_stock === 0).length

        setRawStats({
          totalOrders, revenue: totalRevenue, ordersToday,
          lowStockCount: actualLowStock.length,
          ordersThisMonth, ordersLastMonth,
          revenueThisMonth, revenueLastMonth,
          ordersYesterday, outOfStock, orderPct, revPct,
        })

        setStats([
          { id: 'orders',   label: 'Total Orders',    value: totalOrders.toLocaleString(),
            change: orderPct ?? 'no prior month', up: (orderPct ?? '+').startsWith('+'), suffix: orderPct ? 'vs last month' : '',
            icon: ShoppingCart, color: '#6C63FF' },
          // Always-K formatting was fine while the total was capped at 1000
          // rows; against the real figure it reads "$434158K".
          { id: 'revenue',  label: 'Revenue',
            value: totalRevenue >= 1_000_000
              ? `${symbol}${(totalRevenue / 1_000_000).toFixed(1)}M`
              : `${symbol}${Math.round(totalRevenue / 1000)}K`,
            change: revPct ?? 'no prior month', up: (revPct ?? '+').startsWith('+'), suffix: revPct ? 'vs last month' : '',
            icon: DollarSign, color: '#00D4FF' },
          { id: 'today',    label: 'Orders Today',    value: ordersToday.toString(),
            change: `${todayDelta >= 0 ? '+' : ''}${todayDelta}`, up: todayDelta >= 0, suffix: 'vs yesterday',
            icon: TrendingUp, color: '#22d3a8' },
          { id: 'lowstock', label: 'Low Stock Items', value: actualLowStock.length.toString(),
            change: `${outOfStock} critical`, up: outOfStock === 0, suffix: 'out of stock',
            icon: Package, color: '#f43f5e' },
        ])

        // Keep every low-stock row. Slicing to 8 here was why the modal
        // reported "Critical 8 / Warnings 0" regardless of the real split.
        setAlerts(actualLowStock.map((i: any) => {
          const p = Array.isArray(i.products) ? i.products[0] : i.products
          const name = p?.name || 'Unknown Product'
          return {
            icon: AlertTriangle,
            color: i.current_stock === 0 ? '#f43f5e' : '#f59e0b',
            name,
            inventory_id: i.id,
            product_id: p?.id ?? i.product_id,
            family: p?.family || '',
            unit_price: Number(p?.unit_price) || 0,
            current_stock: i.current_stock,
            reorder_level: i.reorder_level,
            suggested: Math.max((i.reorder_level || 10) * 2 - i.current_stock, 10),
            text: `${name} is low: ${i.current_stock} left`,
            time: 'Active',
          }
        }))
        setLiveAt(new Date())
      }
    } catch (err) {
      console.error('Error fetching dashboard:', err)
    } finally {
      if (!silent) setLoading(false)
    }
  }

  function handleRestocked(name: string, vendorCompany: string) {
    setRestocked(prev => new Set(prev).add(name))
    setRestockTarget(null)
    setToast(`Purchase order emailed to ${vendorCompany} — ${name} marked restocked.`)
    setTimeout(() => setToast(''), 5000)
    fetchDashboardData({ silent: true })
  }

  const modalData = { rawStats, salesData, recentOrders, alerts }

  return (
    <div className="page-enter">
      <div className="page-header page-header-row">
        <div>
          <h1>Operational Dashboard</h1>
          <p>
            Real-time monitoring of your business status
            {liveAt && (
              <span style={{ marginLeft: 10, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#22d3a8' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22d3a8', boxShadow: '0 0 8px #22d3a8' }} />
                live · updated {fmtTime(liveAt)}
              </span>
            )}
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => fetchDashboardData()}><RefreshCw size={14} /></button>
      </div>

      {/* Stats */}
      <div className="stat-grid">
        {loading ? (
          [1,2,3,4].map(i => <div key={i} className="stat-card" style={{ height: 100, opacity: 0.1 }}></div>)
        ) : stats.map(s => (
          <div
            key={s.id}
            className="stat-card"
            onClick={() => setModalCard(s.id)}
            style={{ '--card-glow': `${s.color}33`, cursor: 'pointer', transition: 'box-shadow 0.25s ease, transform 0.18s ease' } as any}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement
              el.style.boxShadow = `0 0 0 1px ${s.color}99, 0 0 30px ${s.color}77, 0 0 60px ${s.color}44`
              el.style.transform = 'translateY(-2px)'
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement
              el.style.boxShadow = ''; el.style.transform = ''
            }}
          >
            <div className="stat-card-icon"><s.icon size={18} color={s.color} /></div>
            <div className="stat-card-label">{s.label}</div>
            <div className="stat-card-value">{s.value}</div>
            <div className={`stat-card-change ${s.up ? 'text-success' : 'text-danger'}`}>
              {s.up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
              {s.change}{s.suffix ? ` ${s.suffix}` : ''}
            </div>
            <div style={{ fontSize: 10, color: `${s.color}99`, marginTop: 5, fontWeight: 500 }}>Click for details →</div>
          </div>
        ))}
      </div>

      {modalCard && (
        <StatModal
          card={modalCard}
          onClose={() => setModalCard(null)}
          data={modalData}
          onRestock={setRestockTarget}
          restocked={restocked}
        />
      )}

      {restockTarget && (
        <QuickRestockModal
          alert={restockTarget}
          vendors={vendors}
          onClose={() => setRestockTarget(null)}
          onDone={handleRestocked}
        />
      )}

      {toast && createPortal(
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 10002,
          padding: '13px 20px', borderRadius: 12, fontSize: 13, fontWeight: 600, color: '#fff',
          background: 'rgba(8,12,28,0.97)', border: '1px solid rgba(34,211,168,0.5)',
          boxShadow: '0 0 24px rgba(34,211,168,0.3), 0 18px 50px rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', gap: 9, maxWidth: 'calc(100vw - 40px)',
        }}>
          <CheckCircle size={16} color="#22d3a8" /> {toast}
        </div>,
        document.body
      )}

      {/* ── ORDER DETAIL MODAL ── */}
      {selectedOrder && createPortal(
        <div onClick={() => setSelectedOrder(null)} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 500, background: 'rgba(8,12,28,0.98)', border: '1px solid rgba(108,99,255,0.4)', borderRadius: 22, padding: 32, boxShadow: '0 0 0 1px rgba(108,99,255,0.15), 0 32px 80px rgba(0,0,0,0.8)', animation: 'pageIn 0.2s ease-out' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 4 }}>Order Details</h2>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', margin: 0 }}>{selectedOrder.id}</p>
              </div>
              <button onClick={() => setSelectedOrder(null)} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(108,99,255,0.4)', borderRadius: 10, padding: '7px 11px', cursor: 'pointer', color: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center' }}><X size={16} /></button>
            </div>
            {[
              { label: 'Order ID',   value: selectedOrder.id,                              color: '#a78bfa' },
              { label: 'Product',    value: selectedOrder.product,                         color: 'rgba(255,255,255,0.7)' },
              { label: 'Category',   value: selectedOrder.family,                           color: '#00D4FF' },
              { label: 'Quantity',   value: `${selectedOrder.quantity} units`,              color: '#fff' },
              { label: 'Unit Price', value: `${symbol}${(selectedOrder.unitPrice ?? 0).toFixed(2)}`, color: '#fff' },
              { label: 'Amount',     value: selectedOrder.amount,                           color: '#22d3a8' },
              { label: 'Promotion',  value: selectedOrder.promo ? 'Yes — sold on promo' : 'No', color: selectedOrder.promo ? '#f59e0b' : 'rgba(255,255,255,0.4)' },
              { label: 'Date',       value: selectedOrder.date ? fmtDate(selectedOrder.date, { year: 'numeric', month: 'long', day: 'numeric' }) : '—', color: 'rgba(255,255,255,0.5)' },
            ].map(row => (
              <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{row.label}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: row.color }}>{row.value}</span>
              </div>
            ))}
            <div style={{ marginTop: 20, padding: '12px 16px', borderRadius: 10, background: 'rgba(34,211,168,0.07)', border: '1px solid rgba(34,211,168,0.25)' }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>Status</div>
              <span className={`badge ${selectedOrder.status === 'Completed' ? 'badge-success' : selectedOrder.status === 'Processing' ? 'badge-accent' : selectedOrder.status === 'Shipped' ? 'badge-info' : 'badge-warning'}`}>{selectedOrder.status}</span>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── VIEW ALL ORDERS MODAL ── */}
      {showAllOrders && createPortal(
        <div onClick={() => setShowAllOrders(false)} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 720, maxHeight: '88vh', overflowY: 'auto', background: 'rgba(8,12,28,0.98)', border: '1px solid rgba(108,99,255,0.4)', borderRadius: 22, padding: 32, boxShadow: '0 0 0 1px rgba(108,99,255,0.15), 0 32px 80px rgba(0,0,0,0.8)', animation: 'pageIn 0.2s ease-out' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 4 }}>All Recent Orders</h2>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', margin: 0 }}>{recentOrders.length} orders loaded · click any row for details</p>
              </div>
              <button onClick={() => setShowAllOrders(false)} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(108,99,255,0.4)', borderRadius: 10, padding: '7px 11px', cursor: 'pointer', color: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center' }}><X size={16} /></button>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  {['Order ID', 'Product', 'Category', 'Qty', 'Unit Price', 'Amount', 'Status', 'Date'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 0', color: 'rgba(255,255,255,0.35)', fontWeight: 600, fontSize: 11 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((o, i) => (
                  <tr
                    key={i}
                    onClick={() => { setShowAllOrders(false); setSelectedOrder(o) }}
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer', transition: 'background 0.15s' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(108,99,255,0.08)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
                  >
                    <td style={{ padding: '11px 0', color: '#a78bfa', fontWeight: 600 }}>{o.id}</td>
                    <td style={{ padding: '11px 0', color: '#fff' }}>
                      {o.product}
                      {o.promo && <span className="badge badge-warning" style={{ marginLeft: 8, fontSize: 9 }}>PROMO</span>}
                    </td>
                    <td style={{ padding: '11px 0', color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{o.family}</td>
                    <td style={{ padding: '11px 0', color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>{o.quantity}</td>
                    <td style={{ padding: '11px 0', color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>${o.unitPrice.toFixed(2)}</td>
                    <td style={{ padding: '11px 0', color: '#22d3a8', fontWeight: 700 }}>{o.amount}</td>
                    <td style={{ padding: '11px 0' }}><span className={`badge ${o.status === 'Completed' ? 'badge-success' : o.status === 'Processing' ? 'badge-accent' : 'badge-warning'}`}>{o.status}</span></td>
                    <td style={{ padding: '11px 0', color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>{o.date}</td>
                  </tr>
                ))}
                {recentOrders.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: '32px 0', color: 'rgba(255,255,255,0.3)' }}>No orders found</td></tr>}
              </tbody>
            </table>
          </div>
        </div>,
        document.body
      )}


      {/* Charts row */}
      <div className="glass-card mb-4" style={{ marginBottom: 16 }}>
        <div className="section-title">
          Sales Over Time (Live Data)
          <span className="badge badge-success">Connected</span>
        </div>
        <div className="chart-wrapper-lg">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={salesData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="time" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={v => `${symbol}${v/1000}k`} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="sales" stroke="#00D4FF" strokeWidth={3} dot={{ fill: '#00D4FF', strokeWidth: 2, r: 4 }} activeDot={{ r: 7, stroke: '#fff', strokeWidth: 1.5, filter: 'drop-shadow(0 0 10px #00D4FF)' }} name="Sales" connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid-21">
        <div className="glass-card">
          <div className="section-title">
            Recent Activity
            <button className="btn btn-ghost btn-sm" onClick={() => setShowAllOrders(true)}>View all</button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Order ID</th><th>Product</th><th>Category</th><th>Qty</th><th>Amount</th><th>Status</th><th>Date</th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.map(o => (
                <tr
                  key={o.id}
                  onClick={() => setSelectedOrder(o)}
                  style={{ cursor: 'pointer', transition: 'background 0.15s ease' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(108,99,255,0.09)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
                >
                  <td><span style={{ color: '#a89dff', fontWeight: 600 }}>{o.id}</span></td>
                  <td style={{ color: 'var(--clr-text-muted)' }}>
                    {o.product}
                    {o.promo && <span className="badge badge-warning" style={{ marginLeft: 8, fontSize: 9 }}>PROMO</span>}
                  </td>
                  <td style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{o.family}</td>
                  <td style={{ fontWeight: 600 }}>{o.quantity}</td>
                  <td style={{ fontWeight: 600 }}>{o.amount}</td>
                  <td><span className={`badge ${o.status === 'Completed' ? 'badge-success' : o.status === 'Processing' ? 'badge-accent' : o.status === 'Shipped' ? 'badge-info' : 'badge-warning'}`}>{o.status}</span></td>
                  <td style={{ color: 'var(--clr-text-muted)', fontSize: 12 }}>{o.date}</td>
                </tr>
              ))}
              {recentOrders.length === 0 && !loading && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 20 }}>No recent orders found</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="glass-card">
          <div className="section-title">
            Low Stock & Alerts
            {alerts.length > 8 && (
              <button className="btn btn-ghost btn-sm" onClick={() => setModalCard('lowstock')}>
                View all {alerts.length}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {alerts.slice(0, 8).map((a, i) => (
              <div key={i}>
                <div
                  onClick={() => setSelectedAlert(selectedAlert?.name === a.name ? null : a)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '11px 14px', borderRadius: 12, cursor: 'pointer',
                    background: selectedAlert?.name === a.name ? `${a.color}12` : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${selectedAlert?.name === a.name ? a.color + '55' : 'rgba(255,255,255,0.06)'}`,
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={e => {
                    const el = e.currentTarget as HTMLElement
                    el.style.boxShadow = `0 0 0 1px ${a.color}77, 0 0 16px ${a.color}55, 0 0 32px ${a.color}22`
                    el.style.borderColor = `${a.color}66`
                    el.style.background = `${a.color}0d`
                    el.style.transform = 'translateX(3px)'
                  }}
                  onMouseLeave={e => {
                    const el = e.currentTarget as HTMLElement
                    el.style.boxShadow = ''
                    el.style.borderColor = selectedAlert?.name === a.name ? `${a.color}55` : 'rgba(255,255,255,0.06)'
                    el.style.background = selectedAlert?.name === a.name ? `${a.color}12` : 'rgba(255,255,255,0.03)'
                    el.style.transform = ''
                  }}
                >
                  <div style={{
                    width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                    background: `${a.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: `0 0 12px ${a.color}55`,
                  }}>
                    <a.icon size={16} color={a.color} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 2 }}>{a.name}</p>
                    <p style={{ fontSize: 11, color: a.color === '#f43f5e' ? '#f43f5e99' : '#f59e0b99' }}>
                      {a.current_stock === 0 ? 'Out of stock' : `${a.current_stock} left · reorder at ${a.reorder_level}`}
                    </p>
                  </div>
                  <RestockButton onClick={() => setRestockTarget(a)} done={restocked.has(a.name)} />
                  <span style={{
                    fontSize: 10, padding: '3px 8px', borderRadius: 20, fontWeight: 700,
                    background: `${a.color}22`, color: a.color, border: `1px solid ${a.color}44`,
                  }}>
                    {a.color === '#f43f5e' ? 'CRITICAL' : 'LOW'}
                  </span>
                </div>

                {/* Expanded detail panel */}
                {selectedAlert?.name === a.name && (
                  <div style={{
                    margin: '4px 0 2px 46px', padding: '14px 16px', borderRadius: 10,
                    background: `${a.color}09`, border: `1px solid ${a.color}33`,
                    animation: 'pageIn 0.18s ease-out',
                  }}>
                    <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                      {[
                        { label: 'Current Stock', value: a.current_stock.toString(), color: a.color },
                        { label: 'Reorder Level',  value: a.reorder_level?.toString() ?? '—', color: '#f59e0b' },
                        { label: 'Suggested Order', value: `+${a.suggested} units`, color: '#22d3a8' },
                      ].map(s => (
                        <div key={s.label} style={{ flex: '1 1 80px', padding: '10px 12px', borderRadius: 8, background: `${s.color}0d`, border: `1px solid ${s.color}22` }}>
                          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>{s.label}</div>
                          <div style={{ fontSize: 15, fontWeight: 800, color: s.color }}>{s.value}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden', marginBottom: 10 }}>
                      <div style={{
                        width: `${Math.min((a.current_stock / Math.max(a.reorder_level * 2, 1)) * 100, 100)}%`,
                        height: '100%', background: a.color, borderRadius: 3,
                        boxShadow: `0 0 8px ${a.color}`, transition: 'width 0.4s ease',
                      }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', flex: '1 1 180px', margin: 0 }}>
                        Stock level at <strong style={{ color: a.color }}>{Math.round((a.current_stock / Math.max(a.reorder_level * 2, 1)) * 100)}%</strong> of optimal
                        {' · '}order <strong style={{ color: '#22d3a8' }}>+{a.suggested}</strong> from
                        {' '}<strong style={{ color: '#a78bfa' }}>{vendors.find(v => v.category === a.family)?.company || 'a vendor you pick'}</strong>.
                      </p>
                      <RestockButton onClick={() => setRestockTarget(a)} done={restocked.has(a.name)} size="md" />
                    </div>
                  </div>
                )}
              </div>
            ))}
            {alerts.length === 0 && !loading && <p style={{ textAlign: 'center', color: 'var(--clr-text-muted)', fontSize: 13 }}>No active alerts</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
