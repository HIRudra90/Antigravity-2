import { useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine
} from 'recharts'
import { RefreshCw, AlertTriangle, CheckCircle, Clock, Zap } from 'lucide-react'

const restockQueue = [
  { sku: 'SKU-1042', name: 'Wireless Mouse MX300',  current: 12,  reorder: 100, suggest: 250,  supplier: 'TechGlobe Inc',  eta: '2 days',  priority: 'Critical' },
  { sku: 'SKU-1043', name: 'Office Chair Ergo',     current: 0,   reorder: 20,  suggest: 50,   supplier: 'FurniCo Ltd',    eta: '5 days',  priority: 'Critical' },
  { sku: 'SKU-1046', name: 'Mechanical Keyboard',   current: 34,  reorder: 50,  suggest: 120,  supplier: 'TechGlobe Inc',  eta: '3 days',  priority: 'High' },
  { sku: 'SKU-1051', name: 'USB Hub 4-Port',        current: 28,  reorder: 40,  suggest: 100,  supplier: 'ConnectX',       eta: '4 days',  priority: 'High' },
  { sku: 'SKU-1052', name: 'HDMI Cable 2m',         current: 65,  reorder: 80,  suggest: 200,  supplier: 'CableWorld',     eta: '1 day',   priority: 'Medium' },
  { sku: 'SKU-1053', name: 'A4 Paper Ream',         current: 112, reorder: 150, suggest: 500,  supplier: 'PaperMill Co',   eta: '2 days',  priority: 'Medium' },
]

const trendData = Array.from({ length: 14 }, (_, i) => ({
  day: `Day ${i + 1}`,
  consumption: Math.floor(Math.random() * 80 + 40),
  forecast: Math.floor(Math.random() * 70 + 50),
}))

const priorityBadge: Record<string,string> = {
  Critical: 'badge-danger',
  High:     'badge-warning',
  Medium:   'badge-info',
}

export default function Restock() {
  const [autoMode, setAutoMode] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)

  const handleApprove = (sku: string) => {
    setProcessing(sku)
    setTimeout(() => setProcessing(null), 1400)
  }

  return (
    <div className="page-enter">
      <div className="page-header">
        <h1>Restock Automation</h1>
        <p>AI-driven restocking queue with smart supplier routing and ETA tracking</p>
      </div>

      {/* Stats */}
      <div className="stat-grid">
        {[
          { label: 'Pending Reorders',     value: '6',  color: '#f59e0b', icon: Clock },
          { label: 'Critical Stockouts',   value: '2',  color: '#f43f5e', icon: AlertTriangle },
          { label: 'Auto-Approved Today',  value: '14', color: '#22d3a8', icon: CheckCircle },
          { label: 'Avg. Restock Time',    value: '3.2d',color: '#6C63FF',icon: RefreshCw },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ '--card-glow': `${s.color}33` } as any}>
            <div className="stat-card-icon"><s.icon size={18} color={s.color} /></div>
            <div className="stat-card-label">{s.label}</div>
            <div className="stat-card-value">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="grid-21 mb-4">
        <div className="glass-card">
          {/* Automation Toggle */}
          <div className="flex items-center justify-between mb-4">
            <div className="section-title" style={{ margin: 0 }}>Restock Queue</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, color: 'var(--clr-text-muted)' }}>Auto-Mode</span>
              <button
                onClick={() => setAutoMode(v => !v)}
                style={{
                  width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', position: 'relative',
                  background: autoMode ? 'linear-gradient(135deg,#6C63FF,#00D4FF)' : 'rgba(255,255,255,0.1)',
                  transition: 'all 0.3s ease',
                }}
                aria-label="Toggle auto restock mode"
              >
                <div style={{
                  position: 'absolute', top: 3, left: autoMode ? 23 : 3,
                  width: 18, height: 18, borderRadius: '50%',
                  background: '#fff', transition: 'left 0.3s ease',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                }} />
              </button>
              <span className={`badge ${autoMode ? 'badge-success' : 'badge-accent'}`}>
                <Zap size={10} /> {autoMode ? 'ON' : 'OFF'}
              </span>
            </div>
          </div>

          <table className="data-table">
            <thead>
              <tr><th>SKU</th><th>Product</th><th>Current</th><th>Suggest</th><th>Supplier</th><th>ETA</th><th>Priority</th><th>Action</th></tr>
            </thead>
            <tbody>
              {restockQueue.map(item => (
                <tr key={item.sku}>
                  <td><span style={{ color: '#a89dff', fontWeight: 600, fontSize: 12 }}>{item.sku}</span></td>
                  <td style={{ fontWeight: 500 }}>{item.name}</td>
                  <td>
                    <span style={{ color: item.current === 0 ? 'var(--clr-danger)' : item.current < item.reorder ? 'var(--clr-warning)' : 'var(--clr-success)', fontWeight: 700 }}>
                      {item.current}
                    </span>
                  </td>
                  <td style={{ color: '#00D4FF', fontWeight: 600 }}>{item.suggest}</td>
                  <td style={{ color: 'var(--clr-text-muted)' }}>{item.supplier}</td>
                  <td style={{ fontSize: 12 }}>{item.eta}</td>
                  <td><span className={`badge ${priorityBadge[item.priority]}`}>{item.priority}</span></td>
                  <td>
                    <button
                      className={`btn btn-sm ${processing === item.sku ? 'btn-ghost' : 'btn-primary'}`}
                      onClick={() => handleApprove(item.sku)}
                      disabled={processing === item.sku}
                    >
                      {processing === item.sku ? '⏳ Ordering…' : autoMode ? '✓ Auto' : 'Approve'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="glass-card">
          <div className="section-title">Consumption Trend</div>
          <div className="chart-wrapper-lg">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="day" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false} interval={2} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: 'rgba(10,12,25,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }} />
                <ReferenceLine y={80} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'Reorder Pt', fill: '#f59e0b', fontSize: 10 }} />
                <Line type="monotone" dataKey="consumption" stroke="#6C63FF" strokeWidth={2} dot={false} name="Actual" />
                <Line type="monotone" dataKey="forecast" stroke="#00D4FF" strokeWidth={2} dot={false} strokeDasharray="5 5" name="Forecast" />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
            <p style={{ fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 8 }}>Automation Rules</p>
            {[
              { rule: 'Reorder at <20% stock level', on: true },
              { rule: 'Max order: 30-day forecast', on: true },
              { rule: 'Prefer cheapest supplier', on: false },
              { rule: 'Notify on order >$10k', on: true },
            ].map(r => (
              <div key={r.rule} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ fontSize: 13 }}>{r.rule}</span>
                <span className={`badge ${r.on ? 'badge-success' : 'badge-accent'}`}>{r.on ? 'ON' : 'OFF'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
