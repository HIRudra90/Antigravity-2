import { useState } from 'react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell
} from 'recharts'
import { Truck, MapPin, Clock, CheckCircle, Navigation, Zap, DollarSign } from 'lucide-react'

const deliveryTime = [
  { company: 'FedEx', time: 2.1 },
  { company: 'DHL', time: 2.5 },
  { company: 'UPS', time: 3.2 },
  { company: 'ANA', time: 4.8 },
]

const shippingCost = [
  { month: 'Oct', cost: 12000 },
  { month: 'Nov', cost: 11500 },
  { month: 'Dec', cost: 18000 },
  { month: 'Jan', cost: 9500 },
  { month: 'Feb', cost: 10200 },
  { month: 'Mar', cost: 11000 },
]

const providerUsage = [
  { name: 'FedEx', value: 45, color: '#6C63FF' },
  { name: 'DHL',   value: 30, color: '#00D4FF' },
  { name: 'UPS',   value: 20, color: '#22d3a8' },
  { name: 'ANA',   value: 5,  color: '#FF6B9D' },
]

const shipments = [
  { id: 'SHP-9921', origin: 'Shanghai, CN',     dest: 'New York, US',   carrier: 'FedEx', status: 'In Transit', eta: 'Apr 3',  weight: '420 kg', items: 12 },
  { id: 'SHP-9922', origin: 'London, UK',       dest: 'Toronto, CA',    carrier: 'DHL',   status: 'In Transit', eta: 'Mar 31', weight: '85 kg',  items: 4 },
  { id: 'SHP-9923', origin: 'Warehouse A',      dest: 'Dallas, US',     carrier: 'UPS',    status: 'Delivered',  eta: 'Mar 29', weight: '200 kg', items: 8 },
  { id: 'SHP-9924', origin: 'Tokyo, JP',        dest: 'Los Angeles, US',carrier: 'ANA',     status: 'In Transit',    eta: 'Apr 5',  weight: '310 kg', items: 20 },
]

const statusBadge: Record<string,string> = {
  'In Transit': 'badge-info',
  'Delivered':  'badge-success'
}
const statusIcon: Record<string,any> = {
  'In Transit': Navigation, 'Delivered': CheckCircle
}

export default function Logistics() {
  const [selected, setSelected] = useState<string | null>(shipments[0].id)
  const sel = shipments.find(s => s.id === selected)

  return (
    <div className="page-enter">
      <div className="page-header">
        <h1>Logistics Dashboard</h1>
        <p>Manage shipping carriers, costs, options, and track live deliveries</p>
      </div>

      <div className="grid-3 mb-4" style={{ marginBottom: 16 }}>
        {/* Bar Chart: Delivery time per company */}
        <div className="glass-card">
          <div className="section-title">Delivery Time per Carrier (Days)</div>
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={deliveryTime}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="company" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ background: 'rgba(10,12,25,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }} />
                <Bar dataKey="time" name="Avg Days" fill="#00D4FF" radius={[3,3,0,0]} activeBar={{ stroke: '#fff', strokeWidth: 1, fill: '#45e3ff', filter: 'drop-shadow(0px 0px 8px #00D4FF)' }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Line Chart: Shipping cost over time */}
        <div className="glass-card">
          <div className="section-title">Shipping Cost Trend</div>
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={shippingCost}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v/1000}k`} />
                <Tooltip cursor={{ stroke: 'rgba(255,255,255,0.1)' }} contentStyle={{ background: 'rgba(10,12,25,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }} />
                <Line type="monotone" dataKey="cost" stroke="#f43f5e" strokeWidth={2} dot={{ r: 3 }} name="Cost" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Pie Chart: Provider Usage */}
        <div className="glass-card">
          <div className="section-title">Carrier Usage</div>
          <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={providerUsage} cx="50%" cy="50%" innerRadius={40} outerRadius={65} paddingAngle={4} dataKey="value" activeShape={{ outerRadius: 75, stroke: 'none', filter: 'brightness(1.1) drop-shadow(0px 0px 8px rgba(255,255,255,0.4))' } as any}>
                  {providerUsage.map((c, i) => <Cell key={i} fill={c.color} />)}
                </Pie>
                <Tooltip cursor={false} itemStyle={{ color: '#ffffff' }} labelStyle={{ color: 'rgba(255,255,255,0.7)' }} contentStyle={{ background: 'rgba(10,12,25,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 12px', justifyContent: 'center', marginTop: 10 }}>
            {providerUsage.map(p => (
              <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: p.color }} />
                <span style={{ color: 'var(--clr-text-muted)' }}>{p.name}</span>
                <span style={{ fontWeight: 600 }}>{p.value}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid-21">
        <div className="glass-card">
          <div className="section-title">
            Live Status Tracker
            <button className="btn btn-primary btn-sm"><Truck size={14} /> New Shipment</button>
          </div>
          <table className="data-table">
            <thead>
              <tr><th>ID</th><th>Origin</th><th>Dest</th><th>Carrier</th><th>Status</th></tr>
            </thead>
            <tbody>
              {shipments.map(s => {
                const Icon = statusIcon[s.status]
                return (
                  <tr key={s.id} onClick={() => setSelected(s.id)} style={{ cursor: 'pointer', background: selected === s.id ? 'rgba(108,99,255,0.08)' : undefined }}>
                    <td><span style={{ color: '#a89dff', fontWeight: 600, fontSize: 12 }}>{s.id}</span></td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <MapPin size={12} color="var(--clr-text-muted)" />
                        <span style={{ fontSize: 13 }}>{s.origin}</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <MapPin size={12} color="var(--clr-accent-2)" />
                        <span style={{ fontSize: 13 }}>{s.dest}</span>
                      </div>
                    </td>
                    <td style={{ color: 'var(--clr-text-muted)', fontSize: 12 }}>{s.carrier}</td>
                    <td><span className={`badge ${statusBadge[s.status]}`}><Icon size={10} /> {s.status}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {sel && (
            <div style={{ marginTop: 16, padding: '16px', borderRadius: 'var(--r-md)', background: 'rgba(108,99,255,0.08)', border: '1px solid rgba(108,99,255,0.2)' }}>
              <p style={{ fontWeight: 700, marginBottom: 10, color: '#a89dff' }}>Tracker: {sel.id}</p>
              <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  {['Order Placed', 'Picked Up', 'In Transit', 'Customs', 'Delivered'].map((step, i) => {
                    const stepsDone = sel.status === 'Delivered' ? 5 : 3
                    return (
                      <div key={step} style={{ flex: 1, textAlign: 'center' }}>
                        <div style={{ height: 4, borderRadius: 99, background: i < stepsDone ? '#6C63FF' : 'rgba(255,255,255,0.1)', marginBottom: 4 }} />
                        <span style={{ fontSize: 10, color: i < stepsDone ? '#a89dff' : 'var(--clr-text-dim)' }}>{step}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* AI Best Shipping Option */}
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="section-title">AI Shipping Optimizer</div>
          <div style={{ background: 'rgba(10,12,25,0.5)', borderRadius: 'var(--r-md)', padding: 16, border: '1px solid rgba(255,255,255,0.05)', marginBottom: 12 }}>
            <p style={{ fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 8 }}>Pending Order #ORD-4822 (Dallas, US ➔ Paris, FR)</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }} />
              <Zap size={16} color="#00D4FF" />
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }} />
            </div>
            <div style={{ background: 'rgba(0, 212, 255, 0.1)', border: '1px solid rgba(0, 212, 255, 0.3)', padding: 16, borderRadius: 'var(--r-md)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <p style={{ color: '#00D4FF', fontWeight: 700, fontSize: 14 }}>DHL Express (AI Recommended)</p>
                  <p style={{ color: 'var(--clr-text-muted)', fontSize: 12 }}>Fastest delivery, optimal cost.</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontWeight: 700, fontSize: 16 }}>$142.50</p>
                  <p style={{ color: '#22d3a8', fontSize: 11 }}>Est 2 Days</p>
                </div>
              </div>
              <button className="btn btn-primary btn-sm" style={{ width: '100%', marginTop: 10 }}>Select Shipping</button>
            </div>
          </div>
          
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1, padding: 12, borderRadius: 'var(--r-md)', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <p style={{ fontSize: 13, fontWeight: 600 }}>FedEx</p>
              <p style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>$158.00</p>
              <p style={{ fontSize: 11, color: 'var(--clr-text-muted)' }}>Est 3 Days</p>
            </div>
            <div style={{ flex: 1, padding: 12, borderRadius: 'var(--r-md)', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <p style={{ fontSize: 13, fontWeight: 600 }}>UPS</p>
              <p style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>$135.00</p>
              <p style={{ fontSize: 11, color: 'var(--clr-text-muted)' }}>Est 5 Days</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
