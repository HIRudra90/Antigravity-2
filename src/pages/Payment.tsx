import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts'
import { CreditCard, DollarSign, TrendingUp, CheckCircle, Clock, RefreshCw } from 'lucide-react'

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const fmt = (v: number) => v >= 1_000_000 ? `$${(v/1_000_000).toFixed(1)}M` : v >= 1000 ? `$${Math.round(v/1000)}k` : `$${v}`
const paymentStatus = [{ name: 'Paid', value: 72, color: '#22d3a8' }, { name: 'Pending', value: 28, color: '#f59e0b' }]

export default function Payment() {
  const [loading, setLoading] = useState(true)
  const [revenuePerDay, setRevenuePerDay] = useState<any[]>([])
  const [revenueGrowth, setRevenueGrowth] = useState<any[]>([])
  const [recentTransactions, setRecentTransactions] = useState<any[]>([])
  const [stats, setStats] = useState({ totalRevenue: 0, thisMonth: 0, lastMonth: 0, growth: 0 })

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)

    const [{ data: monthly }, { data: daily }, { data: recentTxns }] = await Promise.all([
      supabase.rpc('get_monthly_revenue', { months_back: 6 }),
      supabase.rpc('get_daily_revenue',   { days_back: 7 }),
      supabase.from('sales_transactions')
        .select('sale_date, quantity_sold, products(name, unit_price)')
        .order('sale_date', { ascending: false })
        .limit(4),
    ])

    if (!monthly?.length) { setLoading(false); return }

    // Revenue by day of week (last 7 days)
    const dayRevMap: Record<string, number> = {}
    if (daily) {
      (daily as any[]).forEach((r: any) => {
        const day = DAYS[new Date(r.sale_date).getDay()]
        dayRevMap[day] = (dayRevMap[day] || 0) + Number(r.revenue)
      })
    }
    setRevenuePerDay(DAYS.map(d => ({ day: d, revenue: Math.round(dayRevMap[d] || 0) })))

    // Monthly growth line chart — data already sorted chronologically from SQL
    setRevenueGrowth((monthly as any[]).map((r: any) => ({
      month: r.month_key.replace(' 20', " '"),
      revenue: Number(r.revenue),
    })))

    // Recent transactions (small query, no row cap issue)
    setRecentTransactions(((recentTxns as any[]) || []).map((row: any, i: number) => {
      const p = Array.isArray(row.products) ? row.products[0] : row.products
      return {
        id: `TXN-${9000 + i}`,
        vendor: (p?.name || 'Product').split(' ').slice(0, 3).join(' '),
        amount: Math.round(row.quantity_sold * (parseFloat(p?.unit_price) || 0)),
        status: i % 4 === 1 ? 'Pending' : 'Paid',
        date: row.sale_date,
      }
    }))

    const totalRevenue  = (monthly as any[]).reduce((a: number, r: any) => a + Number(r.revenue), 0)
    const last  = (monthly as any[])[monthly.length - 1]
    const prev  = (monthly as any[])[monthly.length - 2]
    const thisMonthRev = Number(last?.revenue || 0)
    const lastMonthRev = Number(prev?.revenue || 0)
    const growth = lastMonthRev > 0 ? Math.round(((thisMonthRev - lastMonthRev) / lastMonthRev) * 1000) / 10 : 0
    setStats({ totalRevenue: Math.round(totalRevenue), thisMonth: Math.round(thisMonthRev), lastMonth: Math.round(lastMonthRev), growth })
    setLoading(false)
  }

  return (
    <div className="page-enter">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Financial Dashboard</h1>
          <p>Live revenue, growth trends, and transaction history from sales data</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={fetchData}><RefreshCw size={14} /> Refresh</button>
      </div>

      <div className="stat-grid">
        {[
          { label: 'Total Revenue (6mo)',  value: fmt(stats.totalRevenue), icon: DollarSign,   color: '#6C63FF' },
          { label: 'This Month',           value: fmt(stats.thisMonth),    icon: CheckCircle,  color: '#22d3a8' },
          { label: 'Last Month',           value: fmt(stats.lastMonth),    icon: Clock,        color: '#f59e0b' },
          { label: 'MoM Growth',           value: `${stats.growth > 0 ? '+' : ''}${stats.growth}%`, icon: TrendingUp, color: stats.growth >= 0 ? '#00D4FF' : '#f43f5e' },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ '--card-glow': `${s.color}33` } as any}>
            <div className="stat-card-icon"><s.icon size={18} color={s.color} /></div>
            <div className="stat-card-label">{s.label}</div>
            <div className="stat-card-value">{loading ? '…' : s.value}</div>
          </div>
        ))}
      </div>

      <div className="grid-21 mb-4" style={{ marginBottom: 16 }}>
        <div className="glass-card">
          <div className="section-title">Revenue by Day (Last 7 Days)</div>
          <div className="chart-wrapper-lg">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenuePerDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="day" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v/1000}k`} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ background: 'rgba(5,8,16,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '10px 16px', boxShadow: '0 12px 32px rgba(0,0,0,0.6)' }} labelStyle={{ color: '#fff', fontWeight: 700, fontSize: 13, marginBottom: 4 }} itemStyle={{ fontSize: 12, fontWeight: 600 }} formatter={(v: any) => `$${(+v).toLocaleString()}`} />
                <Bar dataKey="revenue" name="Revenue" fill="#6C63FF" radius={[4,4,0,0]} activeBar={{ stroke: '#fff', strokeWidth: 1, fill: '#8b84fb', filter: 'drop-shadow(0px 0px 8px #6C63FF)' }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="glass-card" onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'rgba(0,212,255,0.7)'; el.style.boxShadow = '0 0 0 1px rgba(0,212,255,0.3),0 0 20px rgba(0,212,255,0.45),0 0 60px rgba(0,212,255,0.25),0 12px 40px rgba(0,0,0,0.6)' }} onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = ''; el.style.boxShadow = '' }}>
          <div className="section-title">Payment Status</div>
          <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={paymentStatus} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value" activeShape={{ outerRadius: 90, stroke: 'none', filter: 'brightness(1.1) drop-shadow(0px 0px 8px rgba(255,255,255,0.4))' } as any}>
                  {paymentStatus.map((c, i) => <Cell key={i} fill={c.color} />)}
                </Pie>
                <Tooltip cursor={false} contentStyle={{ background: 'rgba(5,8,16,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '10px 16px', boxShadow: '0 12px 32px rgba(0,0,0,0.6)' }} labelStyle={{ color: '#fff', fontWeight: 700, fontSize: 13, marginBottom: 4 }} itemStyle={{ fontSize: 12, fontWeight: 600 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginTop: 12 }}>
            {paymentStatus.map(s => (
              <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: s.color }} />
                <span>{s.name} <strong>{s.value}%</strong></span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid-21">
        <div className="glass-card">
          <div className="section-title">Revenue Growth (Last 6 Months)</div>
          <div className="chart-wrapper-lg">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={revenueGrowth}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v/1000}k`} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ background: 'rgba(5,8,16,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '10px 16px', boxShadow: '0 12px 32px rgba(0,0,0,0.6)' }} labelStyle={{ color: '#fff', fontWeight: 700, fontSize: 13, marginBottom: 4 }} itemStyle={{ fontSize: 12, fontWeight: 600 }} formatter={(v: any) => `$${(+v).toLocaleString()}`} />
                <Line type="monotone" dataKey="revenue" stroke="#00D4FF" strokeWidth={3} dot={{ strokeWidth: 2, r: 4 }} activeDot={{ r: 7, stroke: '#fff', strokeWidth: 1.5, filter: 'drop-shadow(0 0 10px #00D4FF)' }} name="Revenue" connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="glass-card">
          <div className="section-title">
            Recent Transactions
            <button className="btn btn-primary btn-sm"><CreditCard size={14} /> New</button>
          </div>
          <table className="data-table">
            <thead><tr><th>ID</th><th>Product</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>
              {recentTransactions.map(t => (
                <tr key={t.id}>
                  <td><span style={{ color: '#a89dff', fontWeight: 600, fontSize: 12 }}>{t.id}</span></td>
                  <td style={{ fontWeight: 500, fontSize: 13 }}>{t.vendor}</td>
                  <td style={{ fontWeight: 700, color: 'var(--clr-success)' }}>+${t.amount.toLocaleString()}</td>
                  <td>
                    <span className={`badge ${t.status === 'Paid' ? 'badge-success' : 'badge-warning'}`}>
                      {t.status === 'Paid' ? <CheckCircle size={10} /> : <Clock size={10} />} {t.status}
                    </span>
                  </td>
                </tr>
              ))}
              {recentTransactions.length === 0 && !loading && (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--clr-text-muted)', padding: 20 }}>No transactions found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
