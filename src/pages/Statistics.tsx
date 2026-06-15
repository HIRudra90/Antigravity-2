import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend
} from 'recharts'
import { TrendingUp, Activity, DollarSign, Package, RefreshCw } from 'lucide-react'

const COLORS = ['#6C63FF', '#00D4FF', '#22d3a8', '#f59e0b', '#f43f5e', '#ec4899']
const fmt = (v: number) => v >= 1_000_000 ? `$${(v/1_000_000).toFixed(1)}M` : v >= 1000 ? `$${Math.round(v/1000)}k` : `$${v}`

export default function Statistics() {
  const [loading, setLoading] = useState(true)
  const [revenueGrowth, setRevenueGrowth] = useState<any[]>([])
  const [profitTrend, setProfitTrend] = useState<any[]>([])
  const [topSelling, setTopSelling] = useState<any[]>([])
  const [categoryContribution, setCategoryContribution] = useState<any[]>([])
  const [comparisonActual, setComparisonActual] = useState<any[]>([])
  const [stats, setStats] = useState({ totalRevenue: 0, totalProfit: 0, totalUnits: 0, avgOrderValue: 0 })

  useEffect(() => { fetchStats() }, [])

  async function fetchStats() {
    setLoading(true)
    try {

    // All aggregation done server-side to bypass the 1000-row per-request cap
    const [
      { data: monthly },
      { data: topProd },
      { data: catRev },
      { data: daily },
    ] = await Promise.all([
      supabase.rpc('get_monthly_revenue', { months_back: 12 }),
      supabase.rpc('get_top_products',    { months_back: 12 }),
      supabase.rpc('get_category_revenue',{ months_back: 12 }),
      supabase.rpc('get_daily_revenue',   { days_back: 7 }),
    ])

    if (!monthly?.length) return

    const shorten = (mk: string) => mk.replace(' 20', " '")  // "Jan 2026" → "Jan '26"
    const last6 = (monthly as any[]).slice(-6)

    setRevenueGrowth(last6.map((r: any) => ({ q: shorten(r.month_key), revenue: Number(r.revenue) })))
    setProfitTrend(last6.map((r: any) => ({ month: shorten(r.month_key), profit: Number(r.profit) })))

    setTopSelling(((topProd as any[]) || []).map((r: any) => ({
      name: r.name.split(' ').slice(0, 3).join(' '),
      sales: Number(r.sales),
    })))

    const totalCatRev = ((catRev as any[]) || []).reduce((a: number, r: any) => a + Number(r.revenue), 0)
    let ci = 0
    setCategoryContribution(
      ((catRev as any[]) || []).slice(0, 6).map((r: any) => ({
        name: r.family,
        value: Math.round((Number(r.revenue) / totalCatRev) * 100),
        color: COLORS[ci++ % COLORS.length],
      }))
    )

    const totalRevenue = (monthly as any[]).reduce((a: number, r: any) => a + Number(r.revenue), 0)
    const totalProfit  = (monthly as any[]).reduce((a: number, r: any) => a + Number(r.profit),  0)
    const totalUnits   = (monthly as any[]).reduce((a: number, r: any) => a + Number(r.units),   0)
    const weekRev      = ((daily as any[]) || []).reduce((a: number, r: any) => a + Number(r.revenue), 0)
    const lastMonthRev = Number(last6[last6.length - 2]?.revenue || 0)

    setComparisonActual([{
      period: 'Revenue',
      lastWeek:  Math.round(weekRev),
      lastMonth: Math.round(lastMonthRev),
      lastYear:  Math.round(totalRevenue),
    }])
    setStats({
      totalRevenue: Math.round(totalRevenue),
      totalProfit:  Math.round(totalProfit),
      totalUnits:   Math.round(totalUnits),
      avgOrderValue: Math.round(totalRevenue / (totalUnits || 1)),
    })
    } catch (err) {
      console.error('Error fetching statistics:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page-enter">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Business Analytics</h1>
          <p>Live revenue, profit, and product performance from your sales data</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={fetchStats}><RefreshCw size={14} /> Refresh</button>
      </div>

      <div className="stat-grid">
        {[
          { label: 'Total Revenue (YTD)', value: fmt(stats.totalRevenue), icon: DollarSign, color: '#6C63FF' },
          { label: 'Net Profit (YTD)',    value: fmt(stats.totalProfit),  icon: TrendingUp, color: '#22d3a8' },
          { label: 'Units Sold',          value: stats.totalUnits.toLocaleString(), icon: Package, color: '#00D4FF' },
          { label: 'Avg Transaction',     value: fmt(stats.avgOrderValue), icon: Activity, color: '#f59e0b' },
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
          <div className="section-title">Revenue Growth (Last 6 Months)</div>
          <div className="chart-wrapper-lg">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={revenueGrowth}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="q" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v/1000}k`} />
                <Tooltip contentStyle={{ background: 'rgba(5,8,16,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '10px 16px', boxShadow: '0 12px 32px rgba(0,0,0,0.6)' }} labelStyle={{ color: '#fff', fontWeight: 700, fontSize: 13, marginBottom: 4 }} itemStyle={{ fontSize: 12, fontWeight: 600 }} formatter={(v: any) => `$${(+v).toLocaleString()}`} />
                <Line type="monotone" dataKey="revenue" stroke="#6C63FF" strokeWidth={3} dot={{ fill: '#6C63FF', r: 4 }} activeDot={{ r: 7, stroke: '#fff', strokeWidth: 1.5, filter: 'drop-shadow(0 0 10px #6C63FF)' }} name="Revenue" connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="glass-card">
          <div className="section-title">Profit Trend (Last 6 Months)</div>
          <div className="chart-wrapper-lg">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={profitTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v/1000}k`} />
                <Tooltip contentStyle={{ background: 'rgba(5,8,16,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '10px 16px', boxShadow: '0 12px 32px rgba(0,0,0,0.6)' }} labelStyle={{ color: '#fff', fontWeight: 700, fontSize: 13, marginBottom: 4 }} itemStyle={{ fontSize: 12, fontWeight: 600 }} formatter={(v: any) => `$${(+v).toLocaleString()}`} />
                <Line type="monotone" dataKey="profit" stroke="#22d3a8" strokeWidth={3} dot={{ fill: '#22d3a8', r: 3 }} activeDot={{ r: 7, stroke: '#fff', strokeWidth: 1.5, filter: 'drop-shadow(0 0 10px #22d3a8)' }} name="Net Profit" connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid-3 mb-4">
        <div className="glass-card">
          <div className="section-title">Top-Selling Products</div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topSelling} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis type="number" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 11 }} axisLine={false} tickLine={false} width={100} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ background: 'rgba(5,8,16,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '10px 16px', boxShadow: '0 12px 32px rgba(0,0,0,0.6)' }} labelStyle={{ color: '#fff', fontWeight: 700, fontSize: 13, marginBottom: 4 }} itemStyle={{ fontSize: 12, fontWeight: 600 }} />
                <Bar dataKey="sales" name="Units Sold" fill="#00D4FF" radius={[0,4,4,0]} activeBar={{ stroke: '#fff', strokeWidth: 1, fill: '#45e3ff', filter: 'drop-shadow(0px 0px 8px #00D4FF)' }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="glass-card" onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'rgba(0,212,255,0.7)'; el.style.boxShadow = '0 0 0 1px rgba(0,212,255,0.3),0 0 20px rgba(0,212,255,0.45),0 0 60px rgba(0,212,255,0.25),0 12px 40px rgba(0,0,0,0.6)' }} onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = ''; el.style.boxShadow = '' }}>
          <div className="section-title">Category Revenue Split</div>
          <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={categoryContribution} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={4} dataKey="value" activeShape={{ outerRadius: 85, stroke: 'none', filter: 'brightness(1.1) drop-shadow(0px 0px 8px rgba(255,255,255,0.4))' } as any}>
                  {categoryContribution.map((c, i) => <Cell key={i} fill={c.color} />)}
                </Pie>
                <Tooltip cursor={false} contentStyle={{ background: 'rgba(5,8,16,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '10px 16px', boxShadow: '0 12px 32px rgba(0,0,0,0.6)' }} labelStyle={{ color: '#fff', fontWeight: 700, fontSize: 13, marginBottom: 4 }} itemStyle={{ fontSize: 12, fontWeight: 600 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 12px', justifyContent: 'center', marginTop: 8 }}>
            {categoryContribution.map(c => (
              <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: c.color }} />
                <span style={{ color: 'var(--clr-text-muted)' }}>{c.name}</span>
                <span style={{ color: c.color, fontWeight: 600 }}>{c.value}%</span>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card">
          <div className="section-title">Sales Volume Comparison</div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={comparisonActual} margin={{ top: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="period" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v/1000}k`} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ background: 'rgba(5,8,16,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '10px 16px', boxShadow: '0 12px 32px rgba(0,0,0,0.6)' }} labelStyle={{ color: '#fff', fontWeight: 700, fontSize: 13, marginBottom: 4 }} itemStyle={{ fontSize: 12, fontWeight: 600 }} formatter={(v: any) => `$${(+v).toLocaleString()}`} />
                <Legend wrapperStyle={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }} />
                <Bar dataKey="lastWeek" name="Last 7 Days" fill="#f59e0b" radius={[3,3,0,0]} activeBar={{ stroke: '#fff', strokeWidth: 1, fill: '#fbbf24', filter: 'drop-shadow(0px 0px 8px #f59e0b)' }} />
                <Bar dataKey="lastMonth" name="Last 30 Days" fill="#00D4FF" radius={[3,3,0,0]} activeBar={{ stroke: '#fff', strokeWidth: 1, fill: '#45e3ff', filter: 'drop-shadow(0px 0px 8px #00D4FF)' }} />
                <Bar dataKey="lastYear" name="Last 365 Days" fill="#6C63FF" radius={[3,3,0,0]} activeBar={{ stroke: '#fff', strokeWidth: 1, fill: '#8b84fb', filter: 'drop-shadow(0px 0px 8px #6C63FF)' }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}
