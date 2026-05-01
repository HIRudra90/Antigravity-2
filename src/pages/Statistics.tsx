import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend
} from 'recharts'
import { TrendingUp, Activity } from 'lucide-react'

const revenueGrowth = [
  { q: 'Q1', revenue: 128000 },
  { q: 'Q2', revenue: 155000 },
  { q: 'Q3', revenue: 142000 },
  { q: 'Q4', revenue: 198000 },
  { q: 'Q1', revenue: 173000 },
  { q: 'Q2', revenue: 212000 },
]

const profitTrend = [
  { month: 'Jan', profit: 32000 },
  { month: 'Feb', profit: 38000 },
  { month: 'Mar', profit: 30000 },
  { month: 'Apr', profit: 45000 },
  { month: 'May', profit: 42000 },
  { month: 'Jun', profit: 54000 },
]

const topSelling = [
  { name: 'Laptop Pro 16"', sales: 852 },
  { name: 'Office Chair Ergo', sales: 641 },
  { name: 'Wireless Mouse', sales: 520 },
  { name: 'External Monitor', sales: 435 },
  { name: 'Mechanical Keyboard', sales: 390 },
]

const categoryContribution = [
  { name: 'Electronics', value: 45, color: '#6C63FF' },
  { name: 'Furniture',   value: 28, color: '#00D4FF' },
  { name: 'Stationery',  value: 15, color: '#22d3a8' },
  { name: 'Apparel',     value: 12, color: '#FF6B9D' },
]

const comparisonData = [
  { name: 'Last Year', value: 320000 },
  { name: 'Last Month', value: 410000 },
  { name: 'Last Week', value: 435000 } // Multiplying or scaling to make it visually comparable as an annualized or equivalent metric. Let's make it actuals but scaled to be readable together.
]
const comparisonActual = [
  { period: 'Sales Volume', lastWeek: 42000, lastMonth: 185000, lastYear: 145000 }
]

export default function Statistics() {
  return (
    <div className="page-enter">
      <div className="page-header">
        <h1>Business Analytics</h1>
        <p>Your executive view covering revenue growth, profits, and top products</p>
      </div>

      <div className="grid-21 mb-4" style={{ marginBottom: 16 }}>
        {/* Revenue Growth Line Chart */}
        <div className="glass-card">
          <div className="section-title">Revenue Growth</div>
          <div className="chart-wrapper-lg">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={revenueGrowth}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="q" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v/1000}k`} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ background: 'rgba(10,12,25,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }} formatter={(v: any) => `$${(+v).toLocaleString()}`} />
                <Line type="monotone" dataKey="revenue" stroke="#6C63FF" strokeWidth={3} dot={{ fill: '#6C63FF', r: 4 }} name="Revenue" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Profit Trend */}
        <div className="glass-card">
          <div className="section-title">Profit Trend (YTD)</div>
          <div className="chart-wrapper-lg">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={profitTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v/1000}k`} />
                <Tooltip contentStyle={{ background: 'rgba(10,12,25,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }} formatter={(v: any) => `$${(+v).toLocaleString()}`} />
                <Line type="monotone" dataKey="profit" stroke="#22d3a8" strokeWidth={3} dot={{ fill: '#22d3a8', r: 3 }} name="Net Profit" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid-3 mb-4">
        {/* Top-Selling Products */}
        <div className="glass-card">
          <div className="section-title">Top-Selling Products</div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topSelling} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis type="number" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 11 }} axisLine={false} tickLine={false} width={100} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ background: 'rgba(10,12,25,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }} />
                <Bar dataKey="sales" name="Units Sold" fill="#00D4FF" radius={[0,4,4,0]} activeBar={{ stroke: '#fff', strokeWidth: 1, fill: '#45e3ff', filter: 'drop-shadow(0px 0px 8px #00D4FF)' }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Category Contribution */}
        <div className="glass-card">
          <div className="section-title">Category Contribution</div>
          <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={categoryContribution} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={4} dataKey="value" activeShape={{ outerRadius: 85, stroke: 'none', filter: 'brightness(1.1) drop-shadow(0px 0px 8px rgba(255,255,255,0.4))' } as any}>
                  {categoryContribution.map((c, i) => <Cell key={i} fill={c.color} />)}
                </Pie>
                <Tooltip cursor={false} itemStyle={{ color: '#ffffff' }} labelStyle={{ color: 'rgba(255,255,255,0.7)' }} contentStyle={{ background: 'rgba(10,12,25,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }} />
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

        {/* Comparison: Last Week vs Last Month vs Last Year */}
        <div className="glass-card">
          <div className="section-title">Sales Volume Comparison</div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={comparisonActual} margin={{ top: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="period" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `${v/1000}k`} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ background: 'rgba(10,12,25,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }} />
                <Legend wrapperStyle={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }} />
                <Bar dataKey="lastWeek" name="Last Week" fill="#f59e0b" radius={[3,3,0,0]} activeBar={{ stroke: '#fff', strokeWidth: 1, fill: '#fbbf24', filter: 'drop-shadow(0px 0px 8px #f59e0b)' }} />
                <Bar dataKey="lastMonth" name="Last Month" fill="#00D4FF" radius={[3,3,0,0]} activeBar={{ stroke: '#fff', strokeWidth: 1, fill: '#45e3ff', filter: 'drop-shadow(0px 0px 8px #00D4FF)' }} />
                <Bar dataKey="lastYear" name="Last Year" fill="#6C63FF" radius={[3,3,0,0]} activeBar={{ stroke: '#fff', strokeWidth: 1, fill: '#8b84fb', filter: 'drop-shadow(0px 0px 8px #6C63FF)' }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}
