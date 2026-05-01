import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, LineChart, Line, ScatterChart, Scatter, ZAxis
} from 'recharts'
import { Package, Search, Plus, AlertTriangle, ArrowUpRight, ArrowDownRight, Layers } from 'lucide-react'

export default function Inventory() {
  const [stockPerProduct, setStockPerProduct] = useState<any[]>([])
  const [categoryDist, setCategoryDist] = useState<any[]>([])
  const [stockOverTime, setStockOverTime] = useState<any[]>([])
  const [heatmapData, setHeatmapData] = useState<any[]>([])
  const [stats, setStats] = useState({ totalItems: 0, lowStock: 0, outOfStock: 0, categories: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchInventoryData()
  }, [])

  async function fetchInventoryData() {
    setLoading(true)
    try {
      // 1. Fetch Products joined with Inventory
      const { data: inventoryData, error: invError } = await supabase
        .from('products')
        .select(`
          name,
          family,
          inventory (
            current_stock,
            reorder_level
          )
        `)

      if (invError) throw invError

      if (inventoryData) {
        // Transform data for charts
        const productStats = inventoryData.map((p: any) => ({
          name: p.name,
          stock: p.inventory?.[0]?.current_stock || 0,
          reorder: p.inventory?.[0]?.reorder_level || 20,
          category: p.family
        }))

        // Sort and take top for BarChart
        setStockPerProduct(productStats.sort((a, b) => b.stock - a.stock).slice(0, 10))

        // Aggregate for Categories
        const categories: any = {}
        const colors = ['#6C63FF', '#00D4FF', '#22d3a8', '#f59e0b', '#f43f5e', '#ec4899']
        let colorIdx = 0
        
        inventoryData.forEach((p: any) => {
          if (!categories[p.family]) {
            categories[p.family] = { name: p.family, value: 0, color: colors[colorIdx % colors.length] }
            colorIdx++
          }
          categories[p.family].value += 1
        })
        setCategoryDist(Object.values(categories))

        // Stats calculation
        const totalStock = productStats.reduce((acc, curr) => acc + curr.stock, 0)
        const lowStock = productStats.filter(p => p.stock > 0 && p.stock <= p.reorder).length
        const outOfStock = productStats.filter(p => p.stock === 0).length
        
        setStats({
          totalItems: totalStock,
          lowStock,
          outOfStock,
          categories: Object.keys(categories).length
        })

        // Fake some logic for Heatmap/Trends since we don't have historical/speed data yet
        // In a real app, 'speed' would come from sales_transactions aggregation
        setHeatmapData(productStats.slice(0, 15).map(p => {
          const speed = Math.floor(Math.random() * 100)
          const stockPercent = Math.min(100, (p.stock / (p.reorder * 5)) * 100)
          let color = '#22d3a8'
          if (stockPercent < 25) color = '#f43f5e'
          else if (stockPercent > 80 && speed < 30) color = '#f59e0b'

          return {
            name: p.name,
            speed,
            stock: stockPercent,
            z: p.stock / 2,
            color
          }
        }))

        // Dummy trend for now
        setStockOverTime([
          { month: 'Jan', stock: totalStock * 0.8 },
          { month: 'Feb', stock: totalStock * 0.85 },
          { month: 'Mar', stock: totalStock * 0.9 },
          { month: 'Apr', stock: totalStock * 0.95 },
          { month: 'May', stock: totalStock * 0.98 },
          { month: 'Jun', stock: totalStock },
        ])
      }
    } catch (err) {
      console.error('Error fetching inventory:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page-enter">
      <div className="page-header">
        <h1>Inventory Dashboard</h1>
        <p>In-depth look at your product stock levels and distribution</p>
      </div>

      {/* Stats */}
      <div className="stat-grid">
        {[
          { label: 'Total Stocked Items', value: stats.totalItems.toLocaleString(), icon: Layers,      color: '#6C63FF' },
          { label: 'Low Stock Alerts',    value: stats.lowStock.toString(),        icon: AlertTriangle, color: '#f59e0b' },
          { label: 'Out of Stock',        value: stats.outOfStock.toString(),      icon: AlertTriangle, color: '#f43f5e' },
          { label: 'Total Categories',    value: stats.categories.toString(),      icon: Package,       color: '#22d3a8' },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ '--card-glow': `${s.color}33` } as any}>
            <div className="stat-card-icon"><s.icon size={18} color={s.color} /></div>
            <div className="stat-card-label">{s.label}</div>
            <div className="stat-card-value">{loading ? '...' : s.value}</div>
          </div>
        ))}
      </div>

      <div className="grid-21 mb-4" style={{ marginBottom: 16 }}>
        {/* Main Bar Chart: Stock per product */}
        <div className="glass-card">
          <div className="section-title">Stock per Product (Top Active)</div>
          <div className="chart-wrapper-lg">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stockPerProduct}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="name" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ background: 'rgba(10,12,25,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }} />
                <Bar dataKey="stock" name="Stock Level" fill="#6C63FF" radius={[4,4,0,0]} activeBar={{ stroke: '#fff', strokeWidth: 1, fill: '#8b84fb', filter: 'drop-shadow(0px 0px 8px #6C63FF)' }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Category Pie Chart */}
        <div className="glass-card">
          <div className="section-title">Category Distribution</div>
          <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={categoryDist} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value" activeShape={{ outerRadius: 90, stroke: 'none', filter: 'brightness(1.1) drop-shadow(0px 0px 8px rgba(255,255,255,0.4))' } as any}>
                  {categoryDist.map((c, i) => <Cell key={i} fill={c.color} />)}
                </Pie>
                <Tooltip cursor={false} itemStyle={{ color: '#ffffff' }} labelStyle={{ color: 'rgba(255,255,255,0.7)' }} contentStyle={{ background: 'rgba(10,12,25,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', marginTop: 12, justifyContent: 'center' }}>
            {categoryDist.map(c => (
              <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: c.color }} />
                <span style={{ color: 'var(--clr-text-muted)' }}>{c.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid-21">
        {/* Heatmap: Fast vs Slow Moving */}
        <div className="glass-card">
          <div className="section-title">Inventory Heatmap (Fast vs Slow Moving vs Stock)</div>
          <div className="chart-wrapper-lg">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis type="number" dataKey="speed" name="Sales Speed" unit=" /day" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis type="number" dataKey="stock" name="Stock %" unit="%" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} />
                <ZAxis type="number" dataKey="z" range={[100, 800]} name="Volume" />
                <Tooltip cursor={{ strokeDasharray: '3 3', stroke: 'rgba(255,255,255,0.1)' }} itemStyle={{ color: '#ffffff' }} labelStyle={{ color: 'rgba(255,255,255,0.7)' }} contentStyle={{ background: 'rgba(10,12,25,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }} />
                {heatmapData.map((entry, index) => (
                  <Scatter key={index} name={entry.name} data={[entry]} fill={entry.color} activeShape={{ stroke: '#fff', strokeWidth: 2, filter: 'brightness(1.5) drop-shadow(0px 0px 8px rgba(255,255,255,0.5))' }} />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 16, fontSize: 12, justifyContent: 'center' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#22d3a8' }}></span> Ideal</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#f59e0b' }}></span> Overstocked</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#f43f5e' }}></span> Reorder Critical</span>
          </div>
        </div>

        {/* Line Chart: Stock Level Over Time */}
        <div className="glass-card">
          <div className="section-title">Stock Level Over Time</div>
          <div className="chart-wrapper-lg">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={stockOverTime}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={v => `${v/1000}k`} />
                <Tooltip contentStyle={{ background: 'rgba(10,12,25,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }} />
                <Line type="monotone" dataKey="stock" stroke="#00D4FF" strokeWidth={2} dot={{ fill: '#00D4FF', r: 3 }} name="Total Stock" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}
