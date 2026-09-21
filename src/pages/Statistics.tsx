import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabaseClient'
import { useLocale } from '../lib/locale'
import { useLiveData } from '../lib/useLiveData'
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend
} from 'recharts'
import { TrendingUp, Activity, DollarSign, Package, RefreshCw, X, TrendingDown, ChevronDown, ChevronUp } from 'lucide-react'

const COLORS = ['#6C63FF', '#00D4FF', '#22d3a8', '#f59e0b', '#f43f5e', '#ec4899']
// `fmt` used to live here as a module constant with a hardcoded '$'. It is now
// taken from the locale inside each component, so changing the currency in
// Settings re-renders these figures instead of leaving them stale.

// Reusable glowing mini-card
function MiniCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        flex: '1 1 130px', padding: '14px 16px', borderRadius: 12,
        background: `${color}0d`, border: `1px solid ${color}33`,
        transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
        cursor: 'default',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement
        el.style.boxShadow = `0 0 0 1px ${color}66, 0 0 18px ${color}55, 0 0 36px ${color}22`
        el.style.borderColor = `${color}88`
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement
        el.style.boxShadow = ''
        el.style.borderColor = `${color}33`
      }}
    >
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color }}>{value}</div>
    </div>
  )
}

// Expandable period row
function PeriodRow({
  label, value, color, expanded, onToggle, children
}: {
  label: string; value: string; color: string
  expanded: boolean; onToggle: () => void; children: React.ReactNode
}) {
  return (
    <div style={{ borderRadius: 12, overflow: 'hidden', border: `1px solid ${expanded ? color + '55' : 'rgba(255,255,255,0.08)'}`, transition: 'border-color 0.2s ease' }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '14px 18px', background: expanded ? `${color}12` : 'rgba(255,255,255,0.03)',
          border: 'none', cursor: 'pointer', transition: 'background 0.2s ease',
        }}
        onMouseEnter={e => { if (!expanded) (e.currentTarget as HTMLElement).style.background = `${color}0a` }}
        onMouseLeave={e => { if (!expanded) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)' }}
      >
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color }}>{value}</span>
          {expanded
            ? <ChevronUp size={15} color={color} />
            : <ChevronDown size={15} color="rgba(255,255,255,0.3)" />}
        </div>
      </button>
      {expanded && (
        <div style={{ padding: '0 18px 18px', background: `${color}08`, borderTop: `1px solid ${color}22` }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ── Modal overlay ──────────────────────────────────────────────────────────────
function StatModal({ card, onClose, data }: {
  card: string; onClose: () => void
  data: {
    stats: { totalRevenue: number; totalProfit: number; totalUnits: number; avgOrderValue: number }
    revenueGrowth: any[]; profitTrend: any[]; topSelling: any[]
    categoryContribution: any[]; comparisonActual: any[]; dailyRevenue: any[]
  }
}) {
  const { symbol, moneyShort: fmt } = useLocale()
  const { stats, revenueGrowth, profitTrend, topSelling, categoryContribution, comparisonActual, dailyRevenue } = data
  const [expandedPeriod, setExpandedPeriod] = useState<string | null>(null)

  const toggle = (key: string) => setExpandedPeriod(p => p === key ? null : key)

  const profitMargin = stats.totalRevenue > 0 ? ((stats.totalProfit / stats.totalRevenue) * 100).toFixed(1) : '0.0'
  const bestRevMonth  = revenueGrowth.length ? revenueGrowth.reduce((a, b) => a.revenue > b.revenue ? a : b) : null
  const bestProfitMonth = profitTrend.length ? profitTrend.reduce((a, b) => a.profit > b.profit ? a : b) : null

  const titles: Record<string, string> = {
    revenue: 'Total Revenue (YTD)', profit: 'Net Profit (YTD)',
    units: 'Units Sold', avg: 'Avg Transaction Value',
  }
  const subtitles: Record<string, string> = {
    revenue: 'Full year-to-date revenue breakdown across all products',
    profit:  'Net profit after costs — breakdown by month',
    units:   'Total units moved across all products and categories',
    avg:     'Average revenue per transaction over time',
  }
  const accentColor: Record<string, string> = {
    revenue: '#6C63FF', profit: '#22d3a8', units: '#00D4FF', avg: '#f59e0b',
  }
  const glow = accentColor[card] || '#6C63FF'

  // Weekly buckets for "Last 30 Days" expansion
  const weekBuckets = (() => {
    if (!revenueGrowth.length) return []
    const months = revenueGrowth.slice(-4)
    return months.map(m => ({ label: m.q, value: m.revenue }))
  })()

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'rgba(8,12,28,0.98)',
          border: `1px solid ${glow}33`,
          boxShadow: `0 0 0 1px ${glow}22, 0 0 40px ${glow}22, 0 32px 80px rgba(0,0,0,0.8)`,
          borderRadius: 22, padding: 32, width: '100%', maxWidth: 700,
          maxHeight: '88vh', overflowY: 'auto', animation: 'pageIn 0.2s ease-out',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 26 }}>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 4 }}>{titles[card]}</h2>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>{subtitles[card]}</p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.06)', border: `1px solid ${glow}44`,
              borderRadius: 10, padding: '7px 11px', cursor: 'pointer',
              color: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center',
              transition: 'box-shadow 0.2s, border-color 0.2s',
            }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement
              el.style.boxShadow = `0 0 0 1px ${glow}77, 0 0 14px ${glow}55`
              el.style.borderColor = `${glow}88`
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement
              el.style.boxShadow = ''
              el.style.borderColor = `${glow}44`
            }}
          ><X size={16} /></button>
        </div>

        {/* ── REVENUE MODAL ── */}
        {card === 'revenue' && (
          <>
            <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
              <MiniCard label="YTD Total"    value={fmt(stats.totalRevenue)}   color="#6C63FF" />
              <MiniCard label="Best Month"   value={bestRevMonth ? `${bestRevMonth.q}` : '—'}  color="#22d3a8" />
              <MiniCard label="Monthly Avg"  value={revenueGrowth.length ? fmt(Math.round(stats.totalRevenue / revenueGrowth.length)) : '—'} color="#00D4FF" />
              <MiniCard label="Profit Margin" value={`${profitMargin}%`}       color="#f59e0b" />
            </div>
            <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.55)' }}>Revenue — Last 6 Months</div>
            <div style={{ height: 200, marginBottom: 22 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={revenueGrowth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="q" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `${symbol}${(v/1_000_000).toFixed(0)}M`} />
                  <Tooltip contentStyle={{ background: 'rgba(5,8,16,0.96)', border: '1px solid #6C63FF44', borderRadius: 10 }} formatter={(v: any) => [`${symbol}${(+v).toLocaleString()}`, 'Revenue']} />
                  <Line type="monotone" dataKey="revenue" stroke="#6C63FF" strokeWidth={3} dot={{ fill: '#6C63FF', r: 5, stroke: '#fff', strokeWidth: 1 }} activeDot={{ r: 8, stroke: '#fff', strokeWidth: 2, filter: 'drop-shadow(0 0 10px #6C63FF)' }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.55)', marginBottom: 12 }}>Monthly Breakdown</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  {['Month', 'Revenue', 'vs Monthly Avg'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 0', color: 'rgba(255,255,255,0.35)', fontWeight: 600, fontSize: 11 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {revenueGrowth.map((r, i) => {
                  const avg = stats.totalRevenue / (revenueGrowth.length || 1)
                  const diff = r.revenue - avg
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '11px 0', color: '#fff', fontWeight: 600 }}>{r.q}</td>
                      <td style={{ padding: '11px 0', color: '#a78bfa', fontWeight: 700 }}>{fmt(r.revenue)}</td>
                      <td style={{ padding: '11px 0' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: diff >= 0 ? '#22d3a8' : '#f43f5e', fontWeight: 600 }}>
                          {diff >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                          {diff >= 0 ? '+' : ''}{fmt(Math.abs(Math.round(diff)))}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </>
        )}

        {/* ── PROFIT MODAL ── */}
        {card === 'profit' && (
          <>
            <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
              <MiniCard label="YTD Net Profit" value={fmt(stats.totalProfit)}  color="#22d3a8" />
              <MiniCard label="Profit Margin"  value={`${profitMargin}%`}      color="#6C63FF" />
              <MiniCard label="Best Month"     value={bestProfitMonth ? bestProfitMonth.month : '—'} color="#00D4FF" />
              <MiniCard label="Monthly Avg"    value={profitTrend.length ? fmt(Math.round(stats.totalProfit / profitTrend.length)) : '—'} color="#f59e0b" />
            </div>
            <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.55)' }}>Profit Trend — Last 6 Months</div>
            <div style={{ height: 200, marginBottom: 22 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={profitTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `${symbol}${(v/1_000_000).toFixed(0)}M`} />
                  <Tooltip contentStyle={{ background: 'rgba(5,8,16,0.96)', border: '1px solid #22d3a844', borderRadius: 10 }} formatter={(v: any) => [`${symbol}${(+v).toLocaleString()}`, 'Net Profit']} />
                  <Line type="monotone" dataKey="profit" stroke="#22d3a8" strokeWidth={3} dot={{ fill: '#22d3a8', r: 5, stroke: '#fff', strokeWidth: 1 }} activeDot={{ r: 8, stroke: '#fff', strokeWidth: 2, filter: 'drop-shadow(0 0 10px #22d3a8)' }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.55)', marginBottom: 12 }}>Monthly Breakdown</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  {['Month', 'Net Profit', 'Margin'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 0', color: 'rgba(255,255,255,0.35)', fontWeight: 600, fontSize: 11 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {profitTrend.map((r, i) => {
                  const revRow = revenueGrowth[i]
                  const margin = revRow && revRow.revenue > 0 ? ((r.profit / revRow.revenue) * 100).toFixed(1) : '—'
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '11px 0', color: '#fff', fontWeight: 600 }}>{r.month}</td>
                      <td style={{ padding: '11px 0', color: '#22d3a8', fontWeight: 700 }}>{fmt(r.profit)}</td>
                      <td style={{ padding: '11px 0', color: '#00D4FF' }}>{margin !== '—' ? `${margin}%` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </>
        )}

        {/* ── UNITS SOLD MODAL ── */}
        {card === 'units' && (
          <>
            <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
              <MiniCard label="Total Units"   value={stats.totalUnits.toLocaleString()}                                            color="#00D4FF" />
              <MiniCard label="Daily Avg"     value={Math.round(stats.totalUnits / 365).toLocaleString()}                         color="#6C63FF" />
              <MiniCard label="Monthly Avg"   value={revenueGrowth.length ? Math.round(stats.totalUnits / revenueGrowth.length).toLocaleString() : '—'} color="#22d3a8" />
              <MiniCard label="Categories"    value={categoryContribution.length.toString()}                                       color="#f59e0b" />
            </div>
            <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.55)' }}>Top Products by Units Sold</div>
            <div style={{ height: 230, marginBottom: 22 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topSelling.slice(0, 8)} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                  <XAxis type="number" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 10 }} axisLine={false} tickLine={false} width={110} />
                  <Tooltip
                    cursor={false}
                    contentStyle={{ background: 'rgba(5,8,16,0.96)', border: '1px solid #00D4FF55', borderRadius: 12, padding: '10px 16px', boxShadow: '0 0 20px #00D4FF33' }}
                    labelStyle={{ color: '#fff', fontWeight: 700, fontSize: 13, marginBottom: 4 }}
                    itemStyle={{ color: '#00D4FF', fontWeight: 600, fontSize: 12 }}
                    formatter={(v: any) => [`${(+v).toLocaleString()} units`, 'Units Sold']}
                  />
                  <Bar dataKey="sales" fill="#00D4FF" radius={[0, 6, 6, 0]}
                    activeBar={{ fill: '#00D4FF', strokeWidth: 0, filter: 'drop-shadow(0 0 8px #00D4FF) drop-shadow(0 0 18px #00D4FFAA) brightness(1.25)' }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.55)', marginBottom: 12 }}>Category Share</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {categoryContribution.map(c => (
                <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 3, background: c.color, flexShrink: 0, boxShadow: `0 0 6px ${c.color}88` }} />
                  <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', flex: 1 }}>{c.name}</span>
                  <div style={{ flex: 3, height: 7, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${c.value}%`, height: '100%', background: c.color, borderRadius: 4, boxShadow: `0 0 8px ${c.color}88` }} />
                  </div>
                  <span style={{ fontSize: 12, color: c.color, fontWeight: 700, width: 36, textAlign: 'right' }}>{c.value}%</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── AVG TRANSACTION MODAL ── */}
        {card === 'avg' && (
          <>
            <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
              <MiniCard label="Avg Transaction" value={fmt(stats.avgOrderValue)}  color="#f59e0b" />
              <MiniCard label="Total Revenue"   value={fmt(stats.totalRevenue)}   color="#6C63FF" />
              <MiniCard label="Total Units"     value={stats.totalUnits.toLocaleString()} color="#00D4FF" />
              <MiniCard label="Profit per Unit" value={stats.totalUnits > 0 ? fmt(Math.round(stats.totalProfit / stats.totalUnits)) : '—'} color="#22d3a8" />
            </div>

            {/* Glowing bar chart — one bar per period */}
            {(() => {
              const raw = comparisonActual[0]
              const periodData = [
                { label: 'Last 7 Days',   value: raw?.lastWeek  ?? 0, color: '#f59e0b', hover: '#fbbf24' },
                { label: 'Last 30 Days',  value: raw?.lastMonth ?? 0, color: '#00D4FF', hover: '#45e3ff' },
                { label: 'Last 365 Days', value: raw?.lastYear  ?? 0, color: '#6C63FF', hover: '#8b84fb' },
              ]
              return (
                <>
                  <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.55)' }}>Revenue by Period</div>
                  <div style={{ height: 200, marginBottom: 22 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={periodData} margin={{ top: 10, left: 10, right: 10 }} barCategoryGap="35%">
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                        <XAxis dataKey="label" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 600 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1_000_000 ? `${symbol}${(v/1_000_000).toFixed(0)}M` : v >= 1000 ? `${symbol}${Math.round(v/1000)}k` : `${symbol}${v}`} />
                        <Tooltip
                          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                          contentStyle={{ background: 'rgba(5,8,16,0.96)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '10px 16px' }}
                          labelStyle={{ color: '#fff', fontWeight: 700, fontSize: 13, marginBottom: 4 }}
                          formatter={(v: any, _: any, props: any) => {
                            const c = props?.payload?.color ?? '#fff'
                            return [<span style={{ color: c, fontWeight: 700 }}>${(+v).toLocaleString()}</span>, 'Revenue']
                          }}
                        />
                        <Bar dataKey="value" radius={[8, 8, 0, 0]} maxBarSize={90}
                          activeBar={(props: any) => {
                            const { x, y, width, height, color, hover } = props
                            return (
                              <rect x={x} y={y} width={width} height={height} rx={8} ry={8}
                                fill={hover ?? color}
                                style={{ filter: `drop-shadow(0 0 12px ${color}) drop-shadow(0 0 24px ${color}88)` }}
                              />
                            )
                          }}
                        >
                          {periodData.map((entry, i) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )
            })()}

            {/* Expandable period rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <PeriodRow
                label="Last 7 Days Revenue" value={fmt(comparisonActual[0]?.lastWeek ?? 0)}
                color="#f59e0b" expanded={expandedPeriod === 'week'} onToggle={() => toggle('week')}
              >
                <div style={{ paddingTop: 14 }}>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 10 }}>Daily revenue breakdown</div>
                  {dailyRevenue.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {dailyRevenue.map((d: any, i: number) => {
                        const maxVal = Math.max(...dailyRevenue.map((x: any) => Number(x.revenue)))
                        const pct = maxVal > 0 ? (Number(d.revenue) / maxVal) * 100 : 0
                        const date = new Date(d.sale_date)
                        const label = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                        return (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', width: 90, flexShrink: 0 }}>{label}</span>
                            <div style={{ flex: 1, height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: '#f59e0b', borderRadius: 4, boxShadow: '0 0 8px #f59e0b88', transition: 'width 0.4s ease' }} />
                            </div>
                            <span style={{ fontSize: 12, color: '#f59e0b', fontWeight: 700, width: 60, textAlign: 'right' }}>{fmt(Number(d.revenue))}</span>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>No daily data available</p>
                  )}
                </div>
              </PeriodRow>

              <PeriodRow
                label="Last 30 Days Revenue" value={fmt(comparisonActual[0]?.lastMonth ?? 0)}
                color="#00D4FF" expanded={expandedPeriod === 'month'} onToggle={() => toggle('month')}
              >
                <div style={{ paddingTop: 14 }}>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 10 }}>Monthly comparison (last 4 months)</div>
                  {weekBuckets.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {weekBuckets.map((w, i) => {
                        const maxVal = Math.max(...weekBuckets.map(x => x.value))
                        const pct = maxVal > 0 ? (w.value / maxVal) * 100 : 0
                        return (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', width: 70, flexShrink: 0 }}>{w.label}</span>
                            <div style={{ flex: 1, height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: '#00D4FF', borderRadius: 4, boxShadow: '0 0 8px #00D4FF88', transition: 'width 0.4s ease' }} />
                            </div>
                            <span style={{ fontSize: 12, color: '#00D4FF', fontWeight: 700, width: 60, textAlign: 'right' }}>{fmt(w.value)}</span>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>No monthly data available</p>
                  )}
                </div>
              </PeriodRow>

              <PeriodRow
                label="Year-to-Date Revenue" value={fmt(comparisonActual[0]?.lastYear ?? 0)}
                color="#6C63FF" expanded={expandedPeriod === 'year'} onToggle={() => toggle('year')}
              >
                <div style={{ paddingTop: 14 }}>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 10 }}>Month-by-month breakdown</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {revenueGrowth.map((r, i) => {
                      const maxVal = Math.max(...revenueGrowth.map(x => x.revenue))
                      const pct = maxVal > 0 ? (r.revenue / maxVal) * 100 : 0
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', width: 70, flexShrink: 0 }}>{r.q}</span>
                          <div style={{ flex: 1, height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: '#6C63FF', borderRadius: 4, boxShadow: '0 0 8px #6C63FF88', transition: 'width 0.4s ease' }} />
                          </div>
                          <span style={{ fontSize: 12, color: '#a78bfa', fontWeight: 700, width: 60, textAlign: 'right' }}>{fmt(r.revenue)}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </PeriodRow>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}

export default function Statistics() {
  const { symbol, moneyShort: fmt } = useLocale()
  const [loading, setLoading] = useState(true)
  const [revenueGrowth, setRevenueGrowth] = useState<any[]>([])
  const [profitTrend, setProfitTrend] = useState<any[]>([])
  const [topSelling, setTopSelling] = useState<any[]>([])
  const [categoryContribution, setCategoryContribution] = useState<any[]>([])
  const [comparisonActual, setComparisonActual] = useState<any[]>([])
  const [dailyRevenue, setDailyRevenue] = useState<any[]>([])
  const [stats, setStats] = useState({ totalRevenue: 0, totalProfit: 0, totalUnits: 0, avgOrderValue: 0 })
  const [modalCard, setModalCard] = useState<string | null>(null)

  useEffect(() => { fetchStats() }, [])
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setModalCard(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useLiveData('statistics-live', ['sales_transactions', 'inventory'], () => fetchStats({ silent: true }))

  async function fetchStats({ silent = false }: { silent?: boolean } = {}) {
    if (!silent) setLoading(true)
    try {
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

      const shorten = (mk: string) => mk.replace(' 20', " '")
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

      // Store raw daily revenue for the 7-day breakdown in the modal
      setDailyRevenue(((daily as any[]) || []).sort((a: any, b: any) => a.sale_date > b.sale_date ? 1 : -1))

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
      if (!silent) setLoading(false)
    }
  }

  const statCards = [
    { id: 'revenue', label: 'Total Revenue (YTD)', value: fmt(stats.totalRevenue), icon: DollarSign, color: '#6C63FF' },
    { id: 'profit',  label: 'Net Profit (YTD)',    value: fmt(stats.totalProfit),  icon: TrendingUp, color: '#22d3a8' },
    { id: 'units',   label: 'Units Sold',          value: stats.totalUnits.toLocaleString(), icon: Package, color: '#00D4FF' },
    { id: 'avg',     label: 'Avg Transaction',     value: fmt(stats.avgOrderValue), icon: Activity, color: '#f59e0b' },
  ]

  const modalData = { stats, revenueGrowth, profitTrend, topSelling, categoryContribution, comparisonActual, dailyRevenue }

  return (
    <div className="page-enter">
      <div className="page-header page-header-row">
        <div>
          <h1>Business Analytics</h1>
          <p>Live revenue, profit, and product performance from your sales data</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => fetchStats()}><RefreshCw size={14} /> Refresh</button>
      </div>

      <div className="stat-grid">
        {loading ? (
          [1,2,3,4].map(i => <div key={i} className="stat-card" style={{ height: 100, opacity: 0.1 }}></div>)
        ) : statCards.map(s => (
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
              el.style.boxShadow = ''
              el.style.transform = ''
            }}
          >
            <div className="stat-card-icon"><s.icon size={18} color={s.color} /></div>
            <div className="stat-card-label">{s.label}</div>
            <div className="stat-card-value">{loading ? '…' : s.value}</div>
            <div style={{ fontSize: 10, color: `${s.color}99`, marginTop: 6, fontWeight: 500 }}>Click for details →</div>
          </div>
        ))}
      </div>

      {modalCard && <StatModal card={modalCard} onClose={() => setModalCard(null)} data={modalData} />}

      <div className="grid-21 mb-4" style={{ marginBottom: 16 }}>
        <div className="glass-card">
          <div className="section-title">Revenue Growth (Last 6 Months)</div>
          <div className="chart-wrapper-lg">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={revenueGrowth}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="q" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={v => `${symbol}${v/1000}k`} />
                <Tooltip contentStyle={{ background: 'rgba(5,8,16,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '10px 16px', boxShadow: '0 12px 32px rgba(0,0,0,0.6)' }} labelStyle={{ color: '#fff', fontWeight: 700, fontSize: 13, marginBottom: 4 }} itemStyle={{ fontSize: 12, fontWeight: 600 }} formatter={(v: any) => `${symbol}${(+v).toLocaleString()}`} />
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
                <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `${symbol}${v/1000}k`} />
                <Tooltip contentStyle={{ background: 'rgba(5,8,16,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '10px 16px', boxShadow: '0 12px 32px rgba(0,0,0,0.6)' }} labelStyle={{ color: '#fff', fontWeight: 700, fontSize: 13, marginBottom: 4 }} itemStyle={{ fontSize: 12, fontWeight: 600 }} formatter={(v: any) => `${symbol}${(+v).toLocaleString()}`} />
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
                <Tooltip cursor={false} contentStyle={{ background: 'rgba(5,8,16,0.95)', border: '1px solid #00D4FF44', borderRadius: 12, padding: '10px 16px', boxShadow: '0 0 20px #00D4FF22, 0 12px 32px rgba(0,0,0,0.6)' }} labelStyle={{ color: '#fff', fontWeight: 700, fontSize: 13, marginBottom: 4 }} itemStyle={{ fontSize: 12, fontWeight: 600, color: '#00D4FF' }} />
                <Bar dataKey="sales" name="Units Sold" fill="#00D4FF" radius={[0,6,6,0]} activeBar={{ fill: '#00D4FF', strokeWidth: 0, filter: 'drop-shadow(0 0 8px #00D4FF) drop-shadow(0 0 18px #00D4FFAA) brightness(1.25)' }} />
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
                <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `${symbol}${v/1000}k`} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ background: 'rgba(5,8,16,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '10px 16px', boxShadow: '0 12px 32px rgba(0,0,0,0.6)' }} labelStyle={{ color: '#fff', fontWeight: 700, fontSize: 13, marginBottom: 4 }} itemStyle={{ fontSize: 12, fontWeight: 600 }} formatter={(v: any) => `${symbol}${(+v).toLocaleString()}`} />
                <Legend wrapperStyle={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }} />
                <Bar dataKey="lastWeek"  name="Last 7 Days"   fill="#f59e0b" radius={[3,3,0,0]} activeBar={{ stroke: '#fff', strokeWidth: 1, fill: '#fbbf24', filter: 'drop-shadow(0px 0px 8px #f59e0b)' }} />
                <Bar dataKey="lastMonth" name="Last 30 Days"  fill="#00D4FF" radius={[3,3,0,0]} activeBar={{ stroke: '#fff', strokeWidth: 1, fill: '#45e3ff', filter: 'drop-shadow(0px 0px 8px #00D4FF)' }} />
                <Bar dataKey="lastYear"  name="Last 365 Days" fill="#6C63FF" radius={[3,3,0,0]} activeBar={{ stroke: '#fff', strokeWidth: 1, fill: '#8b84fb', filter: 'drop-shadow(0px 0px 8px #6C63FF)' }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}
