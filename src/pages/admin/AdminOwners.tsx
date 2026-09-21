import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, Package, Layers, ShoppingCart, RefreshCw, ChevronRight, AlertCircle } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'

export interface OwnerSummary {
  id: string
  name: string
  company: string | null
  email: string | null
  status: string
  created_at: string
  product_count: number
  category_count: number
  total_stock: number
  order_count: number
  units_sold: number
}

export default function AdminOwners() {
  const navigate = useNavigate()
  const [owners, setOwners] = useState<OwnerSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function fetchOwners() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('owner_summary')
      .select('*')
      .order('created_at', { ascending: true })

    if (error) setError(error.message)
    else setOwners((data || []) as OwnerSummary[])
    setLoading(false)
  }

  useEffect(() => { fetchOwners() }, [])

  const totals = owners.reduce(
    (acc, o) => ({
      products: acc.products + Number(o.product_count || 0),
      categories: acc.categories + Number(o.category_count || 0),
      orders: acc.orders + Number(o.order_count || 0),
    }),
    { products: 0, categories: 0, orders: 0 }
  )

  const active = owners.filter(o => o.status === 'Active').length

  const cards = [
    { label: 'Owners Using The System', value: String(owners.length), sub: `${active} active`, color: '#6C63FF', icon: <Building2 size={18} color="#6C63FF" /> },
    { label: 'Products Across Owners',  value: String(totals.products),   sub: 'Live catalogue rows',   color: '#00D4FF', icon: <Package size={18} color="#00D4FF" /> },
    { label: 'Categories In Use',       value: String(totals.categories), sub: 'Summed per owner',      color: '#22d3a8', icon: <Layers size={18} color="#22d3a8" /> },
    { label: 'Orders Placed',           value: String(totals.orders),     sub: 'By admins, all owners', color: '#FF6B9D', icon: <ShoppingCart size={18} color="#FF6B9D" /> },
  ]

  return (
    // No padding of its own: .main-content already supplies the page gutter,
    // and adding 28 here doubled it against every owner-side page.
    <div className="page-enter">
      <div className="page-header page-header-row">
        <div>
          <h1>Owner Management</h1>
          <p>Every business using Inventiq. Open one to view its catalogue and place orders.</p>
        </div>
        <button className="btn" onClick={fetchOwners} disabled={loading}>
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      <div className="stat-grid" style={{ marginBottom: 24 }}>
        {cards.map(c => (
          <div key={c.label} className="stat-card" style={{ '--card-glow': `${c.color}33` } as any}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--clr-text-muted)' }}>
                {c.label}
              </span>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: `${c.color}1a`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {c.icon}
              </div>
            </div>
            <div style={{ fontSize: 30, fontWeight: 800, color: '#fff', lineHeight: 1.1 }}>
              {loading ? '…' : c.value}
            </div>
            <div style={{ fontSize: 12, color: 'var(--clr-text-muted)', marginTop: 6 }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {error && (
        <div style={{ display: 'flex', gap: 10, padding: 16, borderRadius: 12, background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.3)', color: '#f43f5e', fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <strong>Could not load owners.</strong> {error}
            <div style={{ marginTop: 6, color: 'rgba(255,255,255,0.55)' }}>
              If this says <code>owner_summary</code> is missing, run{' '}
              <code>supabase/migrations/002_auth_owners_orders.sql</code> first.
            </div>
          </div>
        </div>
      )}

      <div className="glass-card">
        <div className="section-title">All Owners</div>
        {loading ? (
          <div style={{ padding: 20, color: 'var(--clr-text-muted)', fontSize: 13 }}>Loading owners…</div>
        ) : owners.length === 0 && !error ? (
          <div style={{ padding: 20, color: 'var(--clr-text-muted)', fontSize: 13 }}>
            No owners yet. Migration 002 seeds the first one.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead>
                <tr style={{ textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--clr-text-muted)' }}>
                  <th style={{ padding: '10px 12px' }}>Owner</th>
                  <th style={{ padding: '10px 12px' }}>Categories</th>
                  <th style={{ padding: '10px 12px' }}>Products</th>
                  <th style={{ padding: '10px 12px' }}>Stock</th>
                  <th style={{ padding: '10px 12px' }}>Units Sold</th>
                  <th style={{ padding: '10px 12px' }}>Orders</th>
                  <th style={{ padding: '10px 12px' }}>Status</th>
                  <th style={{ padding: '10px 12px' }} />
                </tr>
              </thead>
              <tbody>
                {owners.map(o => (
                  <tr
                    key={o.id}
                    onClick={() => navigate(`/admin/owners/${o.id}`)}
                    style={{ borderTop: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer', transition: 'background 0.15s' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
                    <td style={{ padding: '14px 12px' }}>
                      <div style={{ fontWeight: 700, color: '#fff', fontSize: 14 }}>{o.company || o.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>{o.email || o.name}</div>
                    </td>
                    <td style={{ padding: '14px 12px', fontWeight: 700, color: '#22d3a8' }}>{o.category_count}</td>
                    <td style={{ padding: '14px 12px', fontWeight: 700, color: '#00D4FF' }}>{o.product_count}</td>
                    <td style={{ padding: '14px 12px', color: 'rgba(255,255,255,0.75)' }}>{Number(o.total_stock).toLocaleString()}</td>
                    <td style={{ padding: '14px 12px', color: 'rgba(255,255,255,0.75)' }}>{Number(o.units_sold).toLocaleString()}</td>
                    <td style={{ padding: '14px 12px', color: 'rgba(255,255,255,0.75)' }}>{o.order_count}</td>
                    <td style={{ padding: '14px 12px' }}>
                      <span
                        className="badge"
                        style={{
                          fontSize: 11,
                          background: o.status === 'Active' ? 'rgba(34,211,168,0.15)' : 'rgba(244,63,94,0.15)',
                          color: o.status === 'Active' ? '#22d3a8' : '#f43f5e',
                          border: `1px solid ${o.status === 'Active' ? 'rgba(34,211,168,0.3)' : 'rgba(244,63,94,0.3)'}`,
                        }}
                      >
                        {o.status}
                      </span>
                    </td>
                    <td style={{ padding: '14px 12px', textAlign: 'right' }}>
                      <ChevronRight size={16} color="var(--clr-text-muted)" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
