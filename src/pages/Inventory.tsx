import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabaseClient'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, LineChart, Line, ScatterChart, Scatter, ZAxis
} from 'recharts'
import {
  Package, Search, Plus, AlertTriangle, Layers, ChevronDown, ChevronUp,
  Pencil, Trash2, X, Tag, DollarSign, TrendingUp, RefreshCw, Activity
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────
interface Product {
  id: number
  name: string
  family: string
  unit_cost: number
  unit_price: number
  supplier_lead_time_days: number
  created_at: string
  inventory: { id: string; current_stock: number; reorder_level: number }[] | null
}
interface ProductView extends Product {
  stock: number; reorder: number; inventoryId: string | null
  margin: number; sku: string; status: 'In Stock' | 'Low Stock' | 'Out of Stock'
}

// ─── Color palette (33 categories) ───────────────────────────────
const PALETTE = [
  '#6C63FF','#00D4FF','#22d3a8','#f59e0b','#f43f5e','#ec4899',
  '#38bdf8','#a78bfa','#84cc16','#fb923c','#e879f9','#34d399',
  '#fbbf24','#60a5fa','#f87171','#4ade80','#c084fc','#2dd4bf',
  '#facc15','#818cf8','#fb7185','#86efac','#7dd3fc','#d8b4fe',
  '#fcd34d','#6ee7b7','#93c5fd','#f9a8d4','#a5f3fc','#bbf7d0',
  '#ddd6fe','#fde68a','#fca5a5',
]
function familyColor(family: string, sorted: string[]) {
  return PALETTE[sorted.indexOf(family) % PALETTE.length] || '#6C63FF'
}

const lbl: React.CSSProperties = { fontSize: 12, color: 'var(--clr-text-muted)', display: 'block', marginBottom: 5 }

// ─── ProductFormModal ─────────────────────────────────────────────
function ProductFormModal({ mode, product, families, onClose, onSaved }: {
  mode: 'add' | 'edit'; product?: ProductView; families: string[]
  onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState({
    name: product?.name ?? '',
    family: product?.family ?? (families[0] ?? ''),
    unit_cost: product?.unit_cost?.toString() ?? '',
    unit_price: product?.unit_price?.toString() ?? '',
    supplier_lead_time_days: (product?.supplier_lead_time_days ?? 3).toString(),
    current_stock: (product?.stock ?? 0).toString(),
    reorder_level: (product?.reorder ?? 20).toString(),
  })
  const [saving, setSaving] = useState(false)

  const upd = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))
  const cost = parseFloat(form.unit_cost) || 0
  const price = parseFloat(form.unit_price) || 0
  const margin = price > 0 ? Math.round(((price - cost) / price) * 100) : 0
  const valid = form.name.trim() && form.family.trim() && price > 0

  const handleSave = async () => {
    if (!valid) return
    setSaving(true)
    const payload = {
      name: form.name.trim(),
      family: form.family.trim().toUpperCase(),
      unit_cost: cost,
      unit_price: price,
      supplier_lead_time_days: parseInt(form.supplier_lead_time_days) || 3,
    }
    if (mode === 'add') {
      const { data: np } = await supabase.from('products').insert(payload).select().single()
      if (np) {
        await supabase.from('inventory').insert({
          product_id: np.id,
          current_stock: parseInt(form.current_stock) || 0,
          reorder_level: parseInt(form.reorder_level) || 20,
        })
      }
    } else if (product) {
      await supabase.from('products').update(payload).eq('id', product.id)
      if (product.inventoryId) {
        await supabase.from('inventory').update({
          current_stock: parseInt(form.current_stock) || 0,
          reorder_level: parseInt(form.reorder_level) || 20,
        }).eq('id', product.inventoryId)
      }
    }
    setSaving(false); onSaved(); onClose()
  }

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: 500, maxHeight: '92vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{mode === 'add' ? 'Add New Product' : 'Edit Product'}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={16} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={lbl}>Product Name *</label>
            <input className="glass-input" style={{ fontSize: 13 }} value={form.name} onChange={e => upd('name', e.target.value)} placeholder="e.g. Motor Oil 5W-30 4L" />
          </div>

          <div>
            <label style={lbl}>Category *</label>
            <input className="glass-input" style={{ fontSize: 13 }} list="inv-families" value={form.family}
              onChange={e => upd('family', e.target.value)} placeholder="Select or type a category" />
            <datalist id="inv-families">{families.map(f => <option key={f} value={f} />)}</datalist>
            <p style={{ fontSize: 11, color: 'var(--clr-text-muted)', marginTop: 4 }}>Type to add a new category or select an existing one.</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Unit Cost ($) *</label>
              <input className="glass-input" style={{ fontSize: 13 }} type="number" min={0} step="0.01" placeholder="0.00" value={form.unit_cost} onChange={e => upd('unit_cost', e.target.value)} />
            </div>
            <div>
              <label style={lbl}>Unit Price ($) *</label>
              <input className="glass-input" style={{ fontSize: 13 }} type="number" min={0} step="0.01" placeholder="0.00" value={form.unit_price} onChange={e => upd('unit_price', e.target.value)} />
            </div>
          </div>

          {cost > 0 && price > 0 && (
            <div style={{ padding: '9px 14px', background: margin >= 15 ? 'rgba(34,211,168,0.08)' : 'rgba(244,63,94,0.08)', borderRadius: 9, border: `1px solid ${margin >= 15 ? 'rgba(34,211,168,0.22)' : 'rgba(244,63,94,0.22)'}`, fontSize: 13, display: 'flex', gap: 20 }}>
              <span>Margin: <strong style={{ color: margin >= 15 ? '#22d3a8' : '#f43f5e' }}>{margin}%</strong></span>
              <span style={{ color: 'var(--clr-text-muted)' }}>Profit/unit: <strong style={{ color: '#fff' }}>${(price - cost).toFixed(2)}</strong></span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Lead Time (days)</label>
              <input className="glass-input" style={{ fontSize: 13 }} type="number" min={1} max={90} value={form.supplier_lead_time_days} onChange={e => upd('supplier_lead_time_days', e.target.value)} />
            </div>
            <div>
              <label style={lbl}>{mode === 'add' ? 'Initial Stock' : 'Current Stock'}</label>
              <input className="glass-input" style={{ fontSize: 13 }} type="number" min={0} value={form.current_stock} onChange={e => upd('current_stock', e.target.value)} />
            </div>
            <div>
              <label style={lbl}>Reorder Level</label>
              <input className="glass-input" style={{ fontSize: 13 }} type="number" min={0} value={form.reorder_level} onChange={e => upd('reorder_level', e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 4 }}>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving || !valid}>
              {saving ? 'Saving…' : mode === 'add' ? 'Add Product' : 'Save Changes'}
            </button>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── Main Component ───────────────────────────────────────────────
export default function Inventory() {
  const [tab, setTab] = useState<'dashboard' | 'catalog'>('dashboard')

  // Dashboard state
  const [stockPerProduct, setStockPerProduct] = useState<any[]>([])
  const [categoryDist, setCategoryDist] = useState<any[]>([])
  const [stockOverTime, setStockOverTime] = useState<any[]>([])
  const [heatmapData, setHeatmapData] = useState<any[]>([])
  const [dashStats, setDashStats] = useState({ totalItems: 0, lowStock: 0, outOfStock: 0, categories: 0 })
  const [loading, setLoading] = useState(true)

  // Catalog state
  const [products, setProducts] = useState<ProductView[]>([])
  const [catLoading, setCatLoading] = useState(true)
  const [catSearch, setCatSearch] = useState('')
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(new Set())
  const [showAddProduct, setShowAddProduct] = useState(false)
  const [editingProduct, setEditingProduct] = useState<ProductView | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  useEffect(() => { fetchInventoryData() }, [])
  useEffect(() => { if (tab === 'catalog') fetchProducts() }, [tab])

  // ── Dashboard data fetch ──────────────────────────────────────
  async function fetchInventoryData() {
    setLoading(true)
    try {
      const [{ data: invRows }, { data: productRows }] = await Promise.all([
        supabase.from('inventory').select('product_id, current_stock, reorder_level'),
        supabase.from('products').select('id, name, family'),
      ])

      const productMap: Record<number, any> = {}
      productRows?.forEach((p: any) => { productMap[p.id] = p })

      const inventoryData = invRows || []

      if (inventoryData.length > 0) {
        const productStats = inventoryData.map((inv: any) => ({
          name: productMap[inv.product_id]?.name || 'Unknown',
          stock: inv.current_stock ?? 0,
          reorder: inv.reorder_level ?? 20,
          category: productMap[inv.product_id]?.family || 'Unknown',
        }))
        setStockPerProduct(productStats.sort((a, b) => b.stock - a.stock).slice(0, 10))

        const cats: any = {}
        const colors = ['#6C63FF','#00D4FF','#22d3a8','#f59e0b','#f43f5e','#ec4899']
        let ci = 0
        productStats.forEach((p: any) => {
          if (!cats[p.category]) { cats[p.category] = { name: p.category, value: 0, color: colors[ci++ % colors.length] }; }
          cats[p.category].value += 1
        })
        setCategoryDist(Object.values(cats))

        const totalStock = productStats.reduce((a, c) => a + c.stock, 0)
        setDashStats({ totalItems: totalStock, lowStock: productStats.filter(p => p.stock > 0 && p.stock <= p.reorder).length, outOfStock: productStats.filter(p => p.stock === 0).length, categories: Object.keys(cats).length })

        const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
        const { data: salesVelocity } = await supabase.from('sales_transactions').select('product_id, quantity_sold').gte('sale_date', thirtyDaysAgo.toISOString().split('T')[0])
        const velMap: Record<number, number> = {}
        if (salesVelocity) salesVelocity.forEach((s: any) => { velMap[s.product_id] = (velMap[s.product_id] || 0) + s.quantity_sold })

        setHeatmapData(productStats.slice(0, 15).map((p, idx) => {
          const totalSold = velMap[idx + 1] || 0
          const avgDailySpeed = Math.round((totalSold / 30) * 10)
          const stockPct = Math.min(100, (p.stock / Math.max(p.reorder * 5, 1)) * 100)
          const color = stockPct < 25 ? '#f43f5e' : stockPct > 80 && avgDailySpeed < 5 ? '#f59e0b' : '#22d3a8'
          return { name: p.name, speed: avgDailySpeed, stock: Math.round(stockPct), z: p.stock / 2, color }
        }))

        // Stock Over Time: current stock minus monthly sales going backwards
        const { data: monthlySales } = await supabase.rpc('get_monthly_revenue', { months_back: 6 })
        if (monthlySales) {
          let running = totalStock
          const trendMonths = [...(monthlySales as any[])].reverse().map((r: any) => {
            const unitsSold = Number(r.units || 0)
            const snap = Math.max(0, running)
            running = running + unitsSold  // add back going backwards in time
            return { month: r.month_key.split(' ')[0], stock: snap, sold: unitsSold }
          }).reverse()
          setStockOverTime(trendMonths)
        }
      }
    } catch (err) { console.error('Error fetching inventory:', err) }
    finally { setLoading(false) }
  }

  // ── Catalog data fetch ────────────────────────────────────────
  async function fetchProducts() {
    setCatLoading(true)
    const [{ data: productRows }, { data: invRows }] = await Promise.all([
      supabase.from('products').select('*').order('family').order('name'),
      supabase.from('inventory').select('id, product_id, current_stock, reorder_level'),
    ])

    if (productRows) {
      const invMap: Record<number, any> = {}
      invRows?.forEach((inv: any) => { invMap[inv.product_id] = inv })

      const enriched = (productRows as Product[]).map(p => {
        const inv = invMap[(p as any).id]
        const stock = inv?.current_stock ?? 0
        const reorder = inv?.reorder_level ?? 20
        const margin = p.unit_price > 0 ? Math.round(((p.unit_price - p.unit_cost) / p.unit_price) * 100) : 0
        const status: ProductView['status'] = stock === 0 ? 'Out of Stock' : stock <= reorder ? 'Low Stock' : 'In Stock'
        return { ...p, stock, reorder, inventoryId: inv?.id ?? null, margin, sku: `SKU-${1000 + (p as any).id}`, status }
      })
      setProducts(enriched)
      setExpandedFamilies(new Set(enriched.map(p => p.family)))
    }
    setCatLoading(false)
  }

  const handleDelete = async (id: number) => {
    await supabase.from('products').delete().eq('id', id)
    setDeletingId(null)
    fetchProducts()
    fetchInventoryData()
  }

  // ── Catalog derived data ──────────────────────────────────────
  const filteredProducts = products.filter(p =>
    p.name.toLowerCase().includes(catSearch.toLowerCase()) ||
    p.family.toLowerCase().includes(catSearch.toLowerCase()) ||
    p.sku.toLowerCase().includes(catSearch.toLowerCase())
  )
  const allFamilies = [...new Set(products.map(p => p.family))].sort()
  const visibleFamilies = catSearch
    ? [...new Set(filteredProducts.map(p => p.family))].sort()
    : allFamilies
  const grouped = allFamilies.reduce((acc, f) => {
    acc[f] = filteredProducts.filter(p => p.family === f); return acc
  }, {} as Record<string, ProductView[]>)

  const totalProducts = products.length
  const totalCategories = allFamilies.length
  const avgMargin = products.length ? Math.round(products.reduce((s, p) => s + p.margin, 0) / products.length) : 0
  const outOfStock = products.filter(p => p.status === 'Out of Stock').length

  const toggleFamily = (f: string) => setExpandedFamilies(prev => {
    const next = new Set(prev); if (next.has(f)) next.delete(f); else next.add(f); return next
  })

  return (
    <div className="page-enter">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Inventory Dashboard</h1>
          <p>Stock levels, product catalog, and inventory analytics</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => { fetchInventoryData(); if (tab === 'catalog') fetchProducts() }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: 'rgba(255,255,255,0.04)', padding: 4, borderRadius: 12, width: 'fit-content', border: '1px solid rgba(255,255,255,0.08)' }}>
        {(['dashboard', 'catalog'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '8px 20px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, transition: 'all 0.2s',
            background: tab === t ? 'linear-gradient(135deg, rgba(108,99,255,0.35), rgba(0,212,255,0.25))' : 'transparent',
            color: tab === t ? '#fff' : 'var(--clr-text-muted)',
            boxShadow: tab === t ? '0 0 12px rgba(108,99,255,0.3)' : 'none',
          }}>
            {t === 'dashboard' ? '📊 Dashboard' : '📦 Product Catalog'}
          </button>
        ))}
      </div>

      {/* ── DASHBOARD TAB ──────────────────────────────────────────── */}
      {tab === 'dashboard' && (
        <>
          <div className="stat-grid">
            {[
              { label: 'Total Stocked Items', value: dashStats.totalItems.toLocaleString(), icon: Layers,       color: '#6C63FF' },
              { label: 'Low Stock Alerts',    value: dashStats.lowStock.toString(),          icon: AlertTriangle, color: '#f59e0b' },
              { label: 'Out of Stock',        value: dashStats.outOfStock.toString(),        icon: AlertTriangle, color: '#f43f5e' },
              { label: 'Total Categories',    value: dashStats.categories.toString(),        icon: Package,       color: '#22d3a8' },
            ].map(s => (
              <div key={s.label} className="stat-card" style={{ '--card-glow': `${s.color}33` } as any}>
                <div className="stat-card-icon"><s.icon size={18} color={s.color} /></div>
                <div className="stat-card-label">{s.label}</div>
                <div className="stat-card-value">{loading ? '...' : s.value}</div>
              </div>
            ))}
          </div>

          <div className="grid-21 mb-4" style={{ marginBottom: 16 }}>
            <div className="glass-card">
              <div className="section-title">Stock per Product (Top Active)</div>
              <div className="chart-wrapper-lg">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stockPerProduct}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="name" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ background: 'rgba(5,8,16,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '10px 16px', boxShadow: '0 12px 32px rgba(0,0,0,0.6)' }} labelStyle={{ color: '#fff', fontWeight: 700, fontSize: 13, marginBottom: 4 }} itemStyle={{ fontSize: 12, fontWeight: 600 }} />
                    <Bar dataKey="stock" name="Stock Level" fill="#6C63FF" radius={[4,4,0,0]} activeBar={{ stroke: '#fff', strokeWidth: 1, fill: '#8b84fb', filter: 'drop-shadow(0px 0px 8px #6C63FF)' }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="glass-card">
              <div className="section-title">Category Distribution</div>
              <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={categoryDist} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value" activeShape={{ outerRadius: 90, stroke: 'none', filter: 'brightness(1.1) drop-shadow(0px 0px 8px rgba(255,255,255,0.4))' } as any}>
                      {categoryDist.map((c, i) => <Cell key={i} fill={c.color} />)}
                    </Pie>
                    <Tooltip cursor={false} contentStyle={{ background: 'rgba(5,8,16,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '10px 16px', boxShadow: '0 12px 32px rgba(0,0,0,0.6)' }} labelStyle={{ color: '#fff', fontWeight: 700, fontSize: 13, marginBottom: 4 }} itemStyle={{ fontSize: 12, fontWeight: 600 }} />
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
            <div className="glass-card">
              <div className="section-title">Inventory Heatmap (Fast vs Slow Moving vs Stock)</div>
              <div className="chart-wrapper-lg">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis type="number" dataKey="speed" name="Sales Speed" unit=" /day" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis type="number" dataKey="stock" name="Stock %" unit="%" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <ZAxis type="number" dataKey="z" range={[100, 800]} name="Volume" />
                    <Tooltip cursor={{ strokeDasharray: '3 3', stroke: 'rgba(255,255,255,0.1)' }} contentStyle={{ background: 'rgba(5,8,16,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '10px 16px', boxShadow: '0 12px 32px rgba(0,0,0,0.6)' }} labelStyle={{ color: '#fff', fontWeight: 700, fontSize: 13, marginBottom: 4 }} itemStyle={{ fontSize: 12, fontWeight: 600 }} />
                    {heatmapData.map((entry, index) => (
                      <Scatter key={index} name={entry.name} data={[entry]} fill={entry.color} activeShape={{ stroke: '#fff', strokeWidth: 2, filter: 'brightness(1.5) drop-shadow(0px 0px 8px rgba(255,255,255,0.5))' }} />
                    ))}
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 16, fontSize: 12, justifyContent: 'center' }}>
                {[['#22d3a8','Ideal'],['#f59e0b','Overstocked'],['#f43f5e','Reorder Critical']].map(([c,l]) => (
                  <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: c }} /> {l}
                  </span>
                ))}
              </div>
            </div>

            <div className="glass-card">
              <div className="section-title">Stock Level Over Time</div>
              <div className="chart-wrapper-lg">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={stockOverTime}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
                    <Tooltip contentStyle={{ background: 'rgba(5,8,16,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '10px 16px', boxShadow: '0 12px 32px rgba(0,0,0,0.6)' }} labelStyle={{ color: '#fff', fontWeight: 700, fontSize: 13, marginBottom: 4 }} itemStyle={{ fontSize: 12, fontWeight: 600 }} />
                    <Line type="monotone" dataKey="stock" stroke="#00D4FF" strokeWidth={2} dot={{ fill: '#00D4FF', r: 3 }} activeDot={{ r: 7, stroke: '#fff', strokeWidth: 1.5, filter: 'drop-shadow(0 0 10px #00D4FF)' }} name="Est. Stock" connectNulls />
                    <Line type="monotone" dataKey="sold" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 5" dot={false} activeDot={{ r: 5 }} name="Units Sold" connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── PRODUCT CATALOG TAB ────────────────────────────────────── */}
      {tab === 'catalog' && (
        <>
          {/* Catalog stats */}
          <div className="stat-grid">
            {[
              { label: 'Total Products',    value: catLoading ? '…' : totalProducts.toString(),    color: '#6C63FF', icon: Package },
              { label: 'Categories',        value: catLoading ? '…' : totalCategories.toString(),  color: '#00D4FF', icon: Tag },
              { label: 'Avg Margin',        value: catLoading ? '…' : `${avgMargin}%`,             color: '#22d3a8', icon: TrendingUp },
              { label: 'Out of Stock',      value: catLoading ? '…' : outOfStock.toString(),       color: '#f43f5e', icon: AlertTriangle },
            ].map(s => (
              <div key={s.label} className="stat-card" style={{ '--card-glow': `${s.color}33` } as any}>
                <div className="stat-card-icon"><s.icon size={18} color={s.color} /></div>
                <div className="stat-card-label">{s.label}</div>
                <div className="stat-card-value">{s.value}</div>
              </div>
            ))}
          </div>

          {/* Search + Add */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={14} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--clr-text-muted)', pointerEvents: 'none' }} />
              <input className="glass-input" style={{ paddingLeft: 38, fontSize: 13 }} placeholder="Search by product name, category or SKU…" value={catSearch} onChange={e => setCatSearch(e.target.value)} />
            </div>
            <button className="btn btn-primary" onClick={() => setShowAddProduct(true)}><Plus size={14} /> Add Product</button>
          </div>

          {catLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[...Array(6)].map((_, i) => <div key={i} className="shimmer" style={{ height: 52, borderRadius: 10 }} />)}
            </div>
          ) : (
            visibleFamilies.map(family => {
              const color = familyColor(family, allFamilies)
              const rows = grouped[family] || []
              const isOpen = expandedFamilies.has(family)
              if (!rows.length && catSearch) return null
              return (
                <div key={family} style={{ marginBottom: 10 }}>
                  {/* Category header */}
                  <button onClick={() => toggleFamily(family)} style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 18px', background: `${color}0e`, border: `1px solid ${color}30`,
                    borderRadius: isOpen ? '12px 12px 0 0' : 12, cursor: 'pointer', textAlign: 'left',
                  }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, boxShadow: `0 0 8px ${color}88`, flexShrink: 0 }} />
                    <span style={{ fontWeight: 700, color, fontSize: 13 }}>{family}</span>
                    <span style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>{rows.length} product{rows.length !== 1 ? 's' : ''}</span>
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
                      {rows.some(p => p.status === 'Out of Stock') && <span style={{ fontSize: 11, color: '#f43f5e', fontWeight: 600 }}>⚠ {rows.filter(p => p.status === 'Out of Stock').length} out of stock</span>}
                      {rows.some(p => p.status === 'Low Stock') && <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 600 }}>{rows.filter(p => p.status === 'Low Stock').length} low</span>}
                      <span style={{ color: 'var(--clr-text-muted)' }}>{isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</span>
                    </div>
                  </button>

                  {isOpen && (
                    <div style={{ border: `1px solid ${color}1a`, borderTop: 'none', borderRadius: '0 0 12px 12px', background: `${color}03`, overflowX: 'auto' }}>
                      <table className="data-table" style={{ minWidth: 720 }}>
                        <thead>
                          <tr>
                            <th>SKU</th><th>Product Name</th><th>Cost</th><th>Price</th>
                            <th>Margin</th><th>Stock</th><th>Reorder</th><th>Lead</th>
                            <th>Status</th><th style={{ textAlign: 'right' }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map(p => (
                            <tr key={p.id}>
                              <td><span style={{ color: '#a89dff', fontWeight: 600, fontSize: 11, fontFamily: 'monospace' }}>{p.sku}</span></td>
                              <td style={{ fontWeight: 500, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</td>
                              <td style={{ color: 'var(--clr-text-muted)', fontSize: 13 }}>${Number(p.unit_cost).toFixed(2)}</td>
                              <td style={{ fontWeight: 600, color: '#22d3a8', fontSize: 13 }}>${Number(p.unit_price).toFixed(2)}</td>
                              <td>
                                <span style={{ fontSize: 12, fontWeight: 700, color: p.margin >= 20 ? '#22d3a8' : p.margin >= 10 ? '#f59e0b' : '#f43f5e' }}>
                                  {p.margin}%
                                </span>
                              </td>
                              <td style={{ fontWeight: 700, color: p.stock === 0 ? '#f43f5e' : p.stock <= p.reorder ? '#f59e0b' : '#fff' }}>{p.stock}</td>
                              <td style={{ color: 'var(--clr-text-muted)', fontSize: 12 }}>{p.reorder}</td>
                              <td style={{ color: 'var(--clr-text-muted)', fontSize: 12 }}>{p.supplier_lead_time_days}d</td>
                              <td>
                                <span className={`badge ${p.status === 'In Stock' ? 'badge-success' : p.status === 'Low Stock' ? 'badge-warning' : 'badge-danger'}`} style={{ fontSize: 10, whiteSpace: 'nowrap' }}>
                                  {p.status}
                                </span>
                              </td>
                              <td>
                                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                  <button className="btn btn-ghost btn-sm" style={{ fontSize: 12, padding: '4px 8px' }}
                                    onClick={() => setEditingProduct(p)} title="Edit product">
                                    <Pencil size={12} />
                                  </button>
                                  {deletingId === p.id ? (
                                    <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: '#f43f5e', borderColor: '#f43f5e', padding: '4px 8px' }}
                                      onClick={() => handleDelete(p.id)}>
                                      Confirm?
                                    </button>
                                  ) : (
                                    <button className="btn btn-ghost btn-sm" style={{ fontSize: 12, color: '#f43f5e', opacity: 0.7, padding: '4px 8px' }}
                                      onClick={() => setDeletingId(p.id)} title="Delete product">
                                      <Trash2 size={12} />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })
          )}

          {!catLoading && products.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--clr-text-muted)' }}>
              <Package size={48} style={{ marginBottom: 16, opacity: 0.15 }} />
              <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No products yet</p>
              <button className="btn btn-primary" onClick={() => setShowAddProduct(true)}><Plus size={14} /> Add Your First Product</button>
            </div>
          )}
        </>
      )}

      {/* ── Modals ────────────────────────────────────────────────── */}
      {showAddProduct && (
        <ProductFormModal mode="add" families={allFamilies} onClose={() => setShowAddProduct(false)}
          onSaved={() => { fetchProducts(); fetchInventoryData() }} />
      )}
      {editingProduct && (
        <ProductFormModal mode="edit" product={editingProduct} families={allFamilies}
          onClose={() => setEditingProduct(null)}
          onSaved={() => { fetchProducts(); fetchInventoryData(); setEditingProduct(null) }} />
      )}
    </div>
  )
}
