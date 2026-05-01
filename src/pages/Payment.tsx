import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts'
import { CreditCard, DollarSign, TrendingUp, CheckCircle, Clock } from 'lucide-react'

const transactions = [
  { id: 'TXN-8821', vendor: 'TechGlobe Inc',  type: 'Sales Invoice',   amount: 18400, status: 'Paid',    date: 'Mar 28', method: 'Wire Transfer' },
  { id: 'TXN-8820', vendor: 'FurniCo Ltd',    type: 'Sales Invoice',   amount: 7200,  status: 'Pending', date: 'Mar 27', method: 'ACH' },
  { id: 'TXN-8819', vendor: 'Apex Corp',      type: 'Sales Invoice',   amount: 12400, status: 'Paid',    date: 'Mar 26', method: 'Credit Card' },
  { id: 'TXN-8818', vendor: 'Nova Labs',      type: 'Sales Invoice',   amount: 8200,  status: 'Paid',    date: 'Mar 25', method: 'Wire Transfer' },
  { id: 'TXN-8817', vendor: 'CableWorld',     type: 'Sales Invoice',   amount: 2300,  status: 'Pending', date: 'Mar 22', method: 'ACH' },
]

const revenuePerDay = [
  { day: 'Mon', revenue: 5200 },
  { day: 'Tue', revenue: 6100 },
  { day: 'Wed', revenue: 4800 },
  { day: 'Thu', revenue: 8800 },
  { day: 'Fri', revenue: 7400 },
  { day: 'Sat', revenue: 9500 },
  { day: 'Sun', revenue: 8100 },
]

const paymentStatus = [
  { name: 'Paid', value: 72, color: '#22d3a8' },
  { name: 'Pending', value: 28, color: '#f59e0b' },
]

const revenueGrowth = [
  { month: 'Oct', revenue: 52000 },
  { month: 'Nov', revenue: 61000 },
  { month: 'Dec', revenue: 88000 },
  { month: 'Jan', revenue: 44000 },
  { month: 'Feb', revenue: 58000 },
  { month: 'Mar', revenue: 72000 },
]

const statusBadge: Record<string,string> = {
  Paid: 'badge-success', Pending: 'badge-warning'
}
const statusIcon: Record<string,any> = {
  Paid: CheckCircle, Pending: Clock
}

export default function Payment() {
  const totalRevenue = 401000
  const completedPayments = 288720
  const pendingPayments = 112280

  return (
    <div className="page-enter">
      <div className="page-header">
        <h1>Financial Dashboard</h1>
        <p>Monitor your revenue, pending payments, and growth trends</p>
      </div>

      <div className="stat-grid">
        {[
          { label: 'Total Revenue (YTD)', value: `$${totalRevenue.toLocaleString()}`,  icon: DollarSign,   color: '#6C63FF' },
          { label: 'Completed Payments',  value: `$${completedPayments.toLocaleString()}`, icon: CheckCircle, color: '#22d3a8' },
          { label: 'Pending Payments',    value: `$${pendingPayments.toLocaleString()}`,   icon: Clock,        color: '#f59e0b' },
          { label: 'Revenue Growth',      value: '+12.4%',                             icon: TrendingUp,   color: '#00D4FF' },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ '--card-glow': `${s.color}33` } as any}>
            <div className="stat-card-icon"><s.icon size={18} color={s.color} /></div>
            <div className="stat-card-label">{s.label}</div>
            <div className="stat-card-value">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="grid-21 mb-4" style={{ marginBottom: 16 }}>
        {/* Revenue per Day */}
        <div className="glass-card">
          <div className="section-title">Revenue per Day (This Week)</div>
          <div className="chart-wrapper-lg">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenuePerDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="day" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v/1000}k`} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ background: 'rgba(10,12,25,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }} formatter={(v: any) => `$${(+v).toLocaleString()}`} />
                <Bar dataKey="revenue" name="Revenue" fill="#6C63FF" radius={[4,4,0,0]} activeBar={{ stroke: '#fff', strokeWidth: 1, fill: '#8b84fb', filter: 'drop-shadow(0px 0px 8px #6C63FF)' }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Payment Status Pie Chart */}
        <div className="glass-card">
          <div className="section-title">Payment Status</div>
          <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={paymentStatus} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value" activeShape={{ outerRadius: 90, stroke: 'none', filter: 'brightness(1.1) drop-shadow(0px 0px 8px rgba(255,255,255,0.4))' } as any}>
                  {paymentStatus.map((c, i) => <Cell key={i} fill={c.color} />)}
                </Pie>
                <Tooltip cursor={false} itemStyle={{ color: '#ffffff' }} labelStyle={{ color: 'rgba(255,255,255,0.7)' }} contentStyle={{ background: 'rgba(10,12,25,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }} />
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
        {/* Revenue Growth Line Chart */}
        <div className="glass-card">
          <div className="section-title">Revenue Growth (Last 6 Months)</div>
          <div className="chart-wrapper-lg">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={revenueGrowth}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v/1000}k`} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ background: 'rgba(10,12,25,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }} formatter={(v: any) => `$${(+v).toLocaleString()}`} />
                <Line type="monotone" dataKey="revenue" stroke="#00D4FF" strokeWidth={3} dot={{ strokeWidth: 2, r: 4 }} name="Revenue" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recently Added Invoices */}
        <div className="glass-card">
          <div className="section-title">
            Recent Invoices
            <button className="btn btn-primary btn-sm"><CreditCard size={14} /> New</button>
          </div>
          <table className="data-table">
            <thead>
              <tr><th>ID</th><th>Client</th><th>Amount</th><th>Status</th></tr>
            </thead>
            <tbody>
              {transactions.slice(0, 4).map(t => {
                const Icon = statusIcon[t.status]
                return (
                  <tr key={t.id}>
                    <td><span style={{ color: '#a89dff', fontWeight: 600, fontSize: 12 }}>{t.id}</span></td>
                    <td style={{ fontWeight: 500, fontSize: 13 }}>{t.vendor}</td>
                    <td style={{ fontWeight: 700, color: 'var(--clr-success)' }}>
                      +${t.amount.toLocaleString()}
                    </td>
                    <td>
                      <span className={`badge ${statusBadge[t.status]}`}>
                        <Icon size={10} /> {t.status}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
