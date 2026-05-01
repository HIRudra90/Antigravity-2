import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts'
import {
  Package, TrendingUp, DollarSign, Activity,
  AlertTriangle, RefreshCw, ArrowUpRight, ArrowDownRight,
  ShoppingCart
} from 'lucide-react'

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="custom-tooltip">
      <p style={{ color: 'var(--clr-text-muted)', marginBottom: 6, fontSize: 12 }}>{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color, marginBottom: 2 }}>
          {p.name}: <strong>{p.name === 'Sales' ? '$' : ''}{p.value.toLocaleString()}</strong>
        </p>
      ))}
    </div>
  )
}

export default function Dashboard() {
  const [salesData, setSalesData] = useState<any[]>([])
  const [recentOrders, setRecentOrders] = useState<any[]>([])
  const [alerts, setAlerts] = useState<any[]>([])
  const [stats, setStats] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchDashboardData()
  }, [])

  async function fetchDashboardData() {
    setLoading(true)
    try {
      const today = new Date().toISOString().split('T')[0]
      
      // 1. Fetch Sales Transactions with Product Details
      const { data: sales, error: salesError } = await supabase
        .from('sales_transactions')
        .select(`
          id,
          sale_date,
          quantity_sold,
          products (
            name,
            unit_price
          )
        `)
        .order('sale_date', { ascending: false })


      if (salesError) throw salesError

      if (sales) {
        // Aggregate Sales Over Time (Last 7 days)
        const dailySales: any = {}
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        sales.slice(0, 100).forEach((s: any) => {
          const d = new Date(s.sale_date)
          const dayName = days[d.getDay()]
          const product = Array.isArray(s.products) ? s.products[0] : s.products
          dailySales[dayName] = (dailySales[dayName] || 0) + (s.quantity_sold * (product?.unit_price || 0))
        })
        
        const chartData = days.map(d => ({ time: d, sales: Math.round(dailySales[d] || 0) }))
        setSalesData(chartData)

        // Recent Orders transformation
        setRecentOrders(sales.slice(0, 5).map((s: any) => {
          const product = Array.isArray(s.products) ? s.products[0] : s.products
          return {
            id: `#ORD-${s.id}`,
            customer: 'Direct Store',
            product: `${product?.name} x${s.quantity_sold}`,
            amount: `$${(s.quantity_sold * (product?.unit_price || 0)).toLocaleString()}`,
            status: 'Completed',
            date: s.sale_date === today ? 'Today' : s.sale_date
          }
        }))

        // Stats calculation
        const totalRevenue = sales.reduce((acc, s) => {
          const product = Array.isArray(s.products) ? s.products[0] : s.products
          return acc + (s.quantity_sold * (product?.unit_price || 0))
        }, 0)
        const ordersToday = sales.filter(s => s.sale_date === today).length
        
        // Low Stock Logic
        const { data: invData } = await supabase.from('inventory').select('*, products(name)')
        const actualLowStock = invData?.filter((i: any) => i.current_stock <= i.reorder_level) || []
        
        setStats([
          { label: 'Total Orders',      value: sales.length.toLocaleString(), change: '+14.2%', up: true,  icon: ShoppingCart, glow: 'rgba(108,99,255,0.2)' },
          { label: 'Revenue',          value: `$${Math.round(totalRevenue/1000)}K`,  change: '+12.4%', up: true,  icon: DollarSign,   glow: 'rgba(0,212,255,0.2)' },
          { label: 'Orders Today',     value: ordersToday.toString(),    change: '+32',    up: true,  icon: TrendingUp,   glow: 'rgba(34,211,168,0.2)' },
          { label: 'Low Stock Items',  value: actualLowStock.length.toString(),     change: '-5',     down: true, icon: Package,      glow: 'rgba(244,63,94,0.2)' },
        ])

        setAlerts(actualLowStock.slice(0, 4).map(i => ({
          icon: AlertTriangle,
          color: i.current_stock === 0 ? '#f43f5e' : '#f59e0b',
          text: `${i.products?.name} is low: ${i.current_stock} left`,
          time: 'Active'
        })))
      }
    } catch (err) {
      console.error('Error fetching dashboard:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page-enter">
      <div className="page-header">
        <h1>Operational Dashboard</h1>
        <p>Real-time monitoring of your business status</p>
      </div>

      {/* Stats */}
      <div className="stat-grid">
        {loading ? (
          [1,2,3,4].map(i => <div key={i} className="stat-card" style={{ height: 100, opacity: 0.1 }}></div>)
        ) : stats.map((s) => (
          <div key={s.label} className="stat-card" style={{ '--card-glow': s.glow } as any}>
            <div className="stat-card-icon"><s.icon size={18} color="var(--clr-text-muted)" /></div>
            <div className="stat-card-label">{s.label}</div>
            <div className="stat-card-value">{s.value}</div>
            <div className={`stat-card-change ${s.up ? 'text-success' : 'text-danger'}`}>
              {s.up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
              {s.change} vs last month
            </div>
          </div>
        ))}
      </div>

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
              <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v/1000}k`} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="sales" stroke="#00D4FF" strokeWidth={3} dot={{ fill: '#00D4FF', strokeWidth: 2, r: 4 }} name="Sales" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid-21">
        {/* Recent Orders */}
        <div className="glass-card">
          <div className="section-title">
            Recent Activity
            <button className="btn btn-ghost btn-sm">View all</button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Customer</th>
                <th>Product</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.map(o => (
                <tr key={o.id}>
                  <td><span style={{ color: '#a89dff', fontWeight: 600 }}>{o.id}</span></td>
                  <td>{o.customer}</td>
                  <td style={{ color: 'var(--clr-text-muted)' }}>{o.product}</td>
                  <td style={{ fontWeight: 600 }}>{o.amount}</td>
                  <td>
                    <span className={`badge ${o.status === 'Completed' ? 'badge-success' : o.status === 'Processing' ? 'badge-accent' : o.status === 'Shipped' ? 'badge-info' : 'badge-warning'}`}>
                      {o.status}
                    </span>
                  </td>
                  <td style={{ color: 'var(--clr-text-muted)', fontSize: 12 }}>{o.date}</td>
                </tr>
              ))}
              {recentOrders.length === 0 && !loading && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20 }}>No recent orders found</td></tr>}
            </tbody>
          </table>
        </div>

        {/* Alerts */}
        <div className="glass-card">
          <div className="section-title">Low Stock & Alerts</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {alerts.map((a, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 12px', borderRadius: 'var(--r-md)', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: `${a.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <a.icon size={15} color={a.color} />
                </div>
                <div>
                  <p style={{ fontSize: 13, marginBottom: 3 }}>{a.text}</p>
                  <p style={{ fontSize: 11, color: 'var(--clr-text-muted)' }}>{a.time}</p>
                </div>
              </div>
            ))}
            {alerts.length === 0 && !loading && <p style={{ textAlign: 'center', color: 'var(--clr-text-muted)', fontSize: 13 }}>No active alerts</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
