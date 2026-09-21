import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Search, ShoppingCart, RefreshCw, AlertCircle,
  CheckCircle2, Layers, Package, Loader2, CreditCard, ShoppingBag, X,
} from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useLiveData } from '../../lib/useLiveData'

interface ProductRow {
  id: number
  name: string
  family: string
  unit_price: number
  unit_cost: number
  current_stock: number
  reorder_level: number
}

interface OrderRow {
  id: string
  product_name: string
  family: string | null
  quantity: number
  total_amount: number
  status: string
  placed_by_email: string | null
  created_at: string
}

export default function AdminOwnerDetail() {
  const { ownerId = '' } = useParams()
  const navigate = useNavigate()

  const [owner, setOwner] = useState<any>(null)
  const [products, setProducts] = useState<ProductRow[]>([])
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string>('ALL')

  // Order form
  const [orderProduct, setOrderProduct] = useState<ProductRow | null>(null)
  const [qty, setQty] = useState(1)
  const [note, setNote] = useState('')
  const [placing, setPlacing] = useState(false)
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // Buy-everything confirm. The totals shown here come from the server, not
  // from `products` above — the page's copy can be seconds stale, and this
  // write is far too large to confirm against a guess.
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkPreview, setBulkPreview] = useState<{ product_count: number; total_units: number; total_amount: number } | null>(null)
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkErr, setBulkErr] = useState<string | null>(null)

  async function fetchAll({ silent = false }: { silent?: boolean } = {}) {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const [ownerRes, prodRes, invRes, orderRes] = await Promise.all([
        supabase.from('owner_summary').select('*').eq('id', ownerId).maybeSingle(),
        supabase.from('products').select('id, name, family, unit_price, unit_cost').eq('owner_id', ownerId).order('family'),
        supabase.from('inventory').select('product_id, current_stock, reorder_level').eq('owner_id', ownerId),
        supabase.from('orders').select('*').eq('owner_id', ownerId).order('created_at', { ascending: false }).limit(50),
      ])

      if (ownerRes.error) throw ownerRes.error
      if (prodRes.error) throw prodRes.error

      const invMap = new Map((invRes.data || []).map((i: any) => [String(i.product_id), i]))
      const merged: ProductRow[] = (prodRes.data || []).map((p: any) => {
        const inv = invMap.get(String(p.id)) || {}
        return {
          id: p.id,
          name: p.name,
          family: p.family || 'UNCATEGORISED',
          unit_price: Number(p.unit_price || 0),
          unit_cost: Number(p.unit_cost || 0),
          current_stock: Number(inv.current_stock ?? 0),
          reorder_level: Number(inv.reorder_level ?? 0),
        }
      })

      setOwner(ownerRes.data)
      setProducts(merged)
      setOrders((orderRes.data || []) as OrderRow[])
    } catch (e: any) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (ownerId) fetchAll() }, [ownerId])

  // The restock agent reacts to a sale a second or two after it lands, so the
  // stock figure this page fetched right after placing an order is already
  // stale by the time it renders. Following the table keeps the column honest.
  useLiveData('admin-owner-live', ['inventory', 'sales_transactions', 'orders', 'restock_orders'], () => {
    if (ownerId) fetchAll({ silent: true })
  })

  const categories = useMemo(() => {
    const set = new Set(products.map(p => p.family))
    return Array.from(set).sort()
  }, [products])

  // Whole catalogue, deliberately ignoring the category/search filters — the
  // button buys everything, so its count has to be everything.
  const inStockCount = useMemo(() => products.filter(p => p.current_stock > 0).length, [products])
  // Products that exist but cannot be sold. Surfaced so a count lower than the
  // catalogue size explains itself instead of reading as a bug.
  const outOfStockCount = useMemo(() => products.filter(p => p.current_stock <= 0).length, [products])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter(p =>
      (category === 'ALL' || p.family === category) &&
      (q === '' || p.name.toLowerCase().includes(q) || p.family.toLowerCase().includes(q))
    )
  }, [products, search, category])

  const STRIPE_PAYMENT_URL = 'https://buy.stripe.com/test_14A9AM9Qw4ohbGAaP91Fe01'

  async function placeOrder() {
    if (!orderProduct || qty < 1) return
    setPlacing(true)
    setToast(null)

    // Open actual Stripe Checkout payment link in new window/tab
    window.open(STRIPE_PAYMENT_URL, '_blank', 'noopener,noreferrer')

    // The whole order — sale row, stock decrement, audit row — happens inside
    // one Postgres transaction so a partial write can't skew the owner's books.
    const { error } = await supabase.rpc('place_owner_order', {
      p_owner_id: ownerId,
      p_product_id: orderProduct.id,
      p_quantity: qty,
      p_note: note || null,
    })

    if (error) {
      setToast({ type: 'err', text: error.message })
    } else {
      setToast({
        type: 'ok',
        text: `Payment gateway launched & Order confirmed for ${qty} × ${orderProduct.name}. Recorded as a sale on the owner dashboard and stock reduced.`,
      })
      setOrderProduct(null)
      setQty(1)
      setNote('')
      await fetchAll()
    }
    setPlacing(false)
  }

  /** Opens the confirm panel and asks the server what the write would actually do. */
  async function openBulk() {
    setBulkOpen(true)
    setBulkErr(null)
    setBulkPreview(null)
    setBulkLoading(true)
    const { data, error } = await supabase.rpc('preview_owner_order_all', { p_owner_id: ownerId })
    if (error) setBulkErr(error.message)
    else {
      const row = Array.isArray(data) ? data[0] : data
      setBulkPreview(row ? {
        product_count: Number(row.product_count) || 0,
        total_units: Number(row.total_units) || 0,
        total_amount: Number(row.total_amount) || 0,
      } : null)
    }
    setBulkLoading(false)
  }

  /**
   * Buys the full available stock of every in-stock product.
   *
   * One RPC, one transaction. Looping the single-product call from here would
   * send quantities read from this page's state — which the restock agent
   * rewrites underneath us — and a dropped connection would leave the owner's
   * books half-updated.
   */
  async function buyEverything() {
    setBulkRunning(true)
    setBulkErr(null)
    setToast(null)

    window.open(STRIPE_PAYMENT_URL, '_blank', 'noopener,noreferrer')

    const { data, error } = await supabase.rpc('place_owner_order_all', {
      p_owner_id: ownerId,
      p_note: 'Bulk purchase — all available stock',
    })

    if (error) {
      setBulkErr(error.message)
    } else {
      const row = Array.isArray(data) ? data[0] : data
      const count = Number(row?.product_count) || 0
      const units = Number(row?.total_units) || 0
      const amount = Number(row?.total_amount) || 0
      setBulkOpen(false)
      setToast(count === 0
        ? { type: 'err', text: 'Nothing to buy — no product currently has stock.' }
        : {
          type: 'ok',
          text: `Bought ${count} product${count === 1 ? '' : 's'} — ${units.toLocaleString()} units, $${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. Recorded as sales on the owner dashboard; every product is now at zero stock.`,
        })
      await fetchAll()
    }
    setBulkRunning(false)
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: 10,
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)',
    color: '#fff', fontSize: 13, outline: 'none',
  }

  return (
    // The gutter comes from .main-content — see AdminOwners.
    <div className="page-enter">
      <button
        className="btn btn-sm"
        onClick={() => navigate('/admin')}
        style={{ marginBottom: 16 }}
      >
        <ArrowLeft size={15} /> All Owners
      </button>

      <div className="page-header page-header-row">
        <div>
          <h1>{owner?.company || owner?.name || 'Owner'}</h1>
          <p>{owner?.email} · {categories.length} categories · {products.length} products</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {/* Whole catalogue, not the filtered view — the count says so, so it
              cannot be mistaken for "buy what I'm looking at". */}
          <button
            className="btn btn-primary"
            onClick={openBulk}
            disabled={loading || inStockCount === 0}
            title={inStockCount === 0
              ? 'No product currently has stock'
              : outOfStockCount > 0
                ? `Buys the full stock of ${inStockCount} products. ${outOfStockCount} excluded — already at zero stock.`
                : 'Buy the full available stock of every product'}
            style={{ opacity: inStockCount === 0 ? 0.45 : 1 }}
          >
            {/* "65 of 66" rather than a bare 65: a count smaller than the
                catalogue looks like a miscount unless it says what it excluded. */}
            <ShoppingBag size={15} /> Buy All Available
            {outOfStockCount > 0 ? ` (${inStockCount} of ${products.length})` : ` (${inStockCount})`}
          </button>
          <button className="btn" onClick={() => fetchAll()} disabled={loading}>
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div style={{ display: 'flex', gap: 10, padding: 16, borderRadius: 12, background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.3)', color: '#f43f5e', fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{error}</span>
        </div>
      )}

      {toast && (
        <div
          style={{
            display: 'flex', gap: 10, padding: 14, borderRadius: 12, marginBottom: 20,
            fontSize: 13, lineHeight: 1.6,
            background: toast.type === 'ok' ? 'rgba(34,211,168,0.08)' : 'rgba(244,63,94,0.08)',
            border: `1px solid ${toast.type === 'ok' ? 'rgba(34,211,168,0.3)' : 'rgba(244,63,94,0.3)'}`,
            color: toast.type === 'ok' ? '#22d3a8' : '#f43f5e',
          }}
        >
          {toast.type === 'ok' ? <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 2 }} /> : <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />}
          <span>{toast.text}</span>
        </div>
      )}

      {/* ── BUY-EVERYTHING CONFIRM ──
          Not a nicety: this sells out the owner's entire catalogue in one
          transaction and there is no undo button anywhere in the app. */}
      {bulkOpen && createPortal(
        <div
          onClick={() => { if (!bulkRunning) setBulkOpen(false) }}
          style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 520, background: 'rgba(8,12,28,0.98)', border: '1px solid rgba(108,99,255,0.4)', borderRadius: 22, padding: 30, boxShadow: '0 32px 80px rgba(0,0,0,0.8)', maxHeight: '88vh', overflowY: 'auto' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 19, color: '#fff' }}>Buy all available stock</h2>
                <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--clr-text-muted)' }}>
                  {owner?.company || owner?.name || 'this owner'} · entire catalogue
                  {outOfStockCount > 0 && (
                    <> · <span style={{ color: '#f59e0b' }}>
                      {outOfStockCount} of {products.length} already at zero stock, nothing to buy
                    </span></>
                  )}
                </p>
              </div>
              <button
                onClick={() => setBulkOpen(false)}
                disabled={bulkRunning}
                style={{ background: 'none', border: 'none', color: 'var(--clr-text-muted)', cursor: bulkRunning ? 'not-allowed' : 'pointer', padding: 4 }}
              >
                <X size={18} />
              </button>
            </div>

            {bulkLoading ? (
              <div style={{ padding: 26, textAlign: 'center', color: 'var(--clr-text-muted)', fontSize: 13 }}>
                <Loader2 size={18} className="spin" style={{ display: 'block', margin: '0 auto 10px' }} />
                Counting what is in stock…
              </div>
            ) : bulkErr ? (
              <div style={{ display: 'flex', gap: 10, padding: 14, borderRadius: 12, background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.3)', color: '#f43f5e', fontSize: 13, lineHeight: 1.6 }}>
                <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>{bulkErr}</span>
              </div>
            ) : !bulkPreview || bulkPreview.product_count === 0 ? (
              <div style={{ padding: 22, textAlign: 'center', color: 'var(--clr-text-muted)', fontSize: 13 }}>
                No product currently has stock, so there is nothing to buy.
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
                  {[
                    { k: 'Products', v: bulkPreview.product_count.toLocaleString(), c: '#6C63FF' },
                    { k: 'Units', v: bulkPreview.total_units.toLocaleString(), c: '#00D4FF' },
                    { k: 'Total', v: `$${bulkPreview.total_amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, c: '#22d3a8' },
                  ].map(s => (
                    <div key={s.k} style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 1 }}>{s.k}</div>
                      <div style={{ fontSize: 19, fontWeight: 800, color: s.c }}>{s.v}</div>
                    </div>
                  ))}
                </div>

                {/* Say the consequences plainly rather than letting them be a
                    surprise on the owner's pages afterwards. */}
                <div style={{ padding: 14, borderRadius: 12, background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.28)', marginBottom: 18 }}>
                  <div style={{ display: 'flex', gap: 9, color: '#f59e0b', fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>
                    <AlertCircle size={15} style={{ flexShrink: 0 }} /> This cannot be undone
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'rgba(255,255,255,0.62)', lineHeight: 1.75 }}>
                    <li>Every one of the {bulkPreview.product_count} products drops to <strong style={{ color: '#fff' }}>zero stock</strong>.</li>
                    <li>Records {bulkPreview.product_count} sales on the owner's dashboard and revenue reports.</li>
                    <li>Raises roughly {bulkPreview.product_count} low-stock notifications and queues everything for restock.</li>
                    <li>Runs as one transaction — it all completes, or none of it does.</li>
                  </ul>
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    className="btn btn-primary"
                    onClick={buyEverything}
                    disabled={bulkRunning}
                    style={{ flex: 1, justifyContent: 'center' }}
                  >
                    {bulkRunning
                      ? <><Loader2 size={14} className="spin" /> Buying {bulkPreview.product_count} products…</>
                      : <><CreditCard size={14} /> Pay &amp; Buy All {bulkPreview.product_count}</>}
                  </button>
                  <button className="btn" onClick={() => setBulkOpen(false)} disabled={bulkRunning}>Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* ── CATEGORY FILTER ── */}
      <div className="glass-card" style={{ marginBottom: 20 }}>
        <div className="section-title">
          <Layers size={15} style={{ marginRight: 6, verticalAlign: -2 }} />
          Categories ({categories.length})
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {['ALL', ...categories].map(c => {
            const count = c === 'ALL' ? products.length : products.filter(p => p.family === c).length
            const on = category === c
            return (
              <button
                key={c}
                onClick={() => setCategory(c)}
                style={{
                  padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  background: on ? 'linear-gradient(135deg,#6C63FF,#846cff)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${on ? 'rgba(108,99,255,0.6)' : 'rgba(255,255,255,0.1)'}`,
                  color: on ? '#fff' : 'var(--clr-text-muted)',
                }}
              >
                {c === 'ALL' ? 'All' : c} <span style={{ opacity: 0.65 }}>({count})</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── PRODUCTS + PLACE ORDER ── */}
      <div style={{ display: 'grid', gridTemplateColumns: orderProduct ? 'minmax(0,1fr) 340px' : '1fr', gap: 20, alignItems: 'start' }}>
        <div className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            <div className="section-title" style={{ margin: 0 }}>
              <Package size={15} style={{ marginRight: 6, verticalAlign: -2 }} />
              Products ({visible.length})
            </div>
            <div style={{ position: 'relative', minWidth: 240 }}>
              <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--clr-text-muted)' }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search product or category…"
                style={{ ...inputStyle, paddingLeft: 34 }}
              />
            </div>
          </div>

          {loading ? (
            <div style={{ padding: 20, color: 'var(--clr-text-muted)', fontSize: 13 }}>Loading catalogue…</div>
          ) : visible.length === 0 ? (
            <div style={{ padding: 20, color: 'var(--clr-text-muted)', fontSize: 13 }}>No products match.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                <thead>
                  <tr style={{ textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--clr-text-muted)' }}>
                    <th style={{ padding: '10px 12px' }}>Product</th>
                    <th style={{ padding: '10px 12px' }}>Category</th>
                    <th style={{ padding: '10px 12px' }}>Stock</th>
                    <th style={{ padding: '10px 12px' }}>Price</th>
                    <th style={{ padding: '10px 12px' }} />
                  </tr>
                </thead>
                <tbody>
                  {visible.map(p => {
                    const out = p.current_stock <= 0
                    return (
                      <tr key={p.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        <td style={{ padding: '12px', color: '#fff', fontWeight: 600, fontSize: 13 }}>{p.name}</td>
                        <td style={{ padding: '12px', fontSize: 12, color: 'var(--clr-text-muted)' }}>{p.family}</td>
                        <td style={{ padding: '12px', fontWeight: 700, fontSize: 13, color: out ? '#f43f5e' : p.current_stock <= p.reorder_level ? '#f59e0b' : '#22d3a8' }}>
                          {p.current_stock}
                        </td>
                        <td style={{ padding: '12px', fontSize: 13, color: 'rgba(255,255,255,0.75)' }}>${p.unit_price.toFixed(2)}</td>
                        <td style={{ padding: '12px', textAlign: 'right' }}>
                          <button
                            className="btn btn-primary"
                            disabled={out}
                            onClick={() => { setOrderProduct(p); setQty(1); setToast(null) }}
                            style={{ fontSize: 12, padding: '6px 12px', opacity: out ? 0.4 : 1, cursor: out ? 'not-allowed' : 'pointer' }}
                            title={out ? 'Out of stock' : 'Place an order for this owner'}
                          >
                            <ShoppingCart size={13} /> Order
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {orderProduct && (
          <div className="glass-card" style={{ position: 'sticky', top: 20 }}>
            <div className="section-title">Place Order</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 2 }}>{orderProduct.name}</div>
            <div style={{ fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 16 }}>
              {orderProduct.family} · {orderProduct.current_stock} in stock · ${orderProduct.unit_price.toFixed(2)} each
            </div>

            <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Quantity</label>
            <input
              type="number"
              min={1}
              max={orderProduct.current_stock}
              value={qty}
              onChange={e => setQty(Math.max(1, Math.min(orderProduct.current_stock, parseInt(e.target.value) || 1)))}
              style={{ ...inputStyle, marginBottom: 14 }}
            />

            <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Note (optional)</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Reason or reference…"
              rows={2}
              style={{ ...inputStyle, resize: 'vertical', marginBottom: 14 }}
            />

            <div style={{ padding: 12, borderRadius: 10, background: 'rgba(108,99,255,0.07)', border: '1px solid rgba(108,99,255,0.2)', fontSize: 13, marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--clr-text-muted)' }}>
                <span>Total</span>
                <strong style={{ color: '#a89dff', fontSize: 15 }}>
                  ${(orderProduct.unit_price * qty).toFixed(2)}
                </strong>
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 8, lineHeight: 1.6 }}>
                Records a sale for the owner, drops stock to {orderProduct.current_stock - qty}, and logs the order against your admin account.
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-primary"
                onClick={placeOrder}
                disabled={placing || qty < 1 || qty > orderProduct.current_stock}
                style={{ flex: 1, justifyContent: 'center' }}
              >
                {placing ? <><Loader2 size={14} className="spin" /> Processing Payment…</> : <><CreditCard size={14} /> Pay & Confirm Order</>}
              </button>
              <button className="btn" onClick={() => setOrderProduct(null)} disabled={placing}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* ── ORDER HISTORY ── */}
      <div className="glass-card" style={{ marginTop: 20 }}>
        <div className="section-title">Orders Placed For This Owner ({orders.length})</div>
        {orders.length === 0 ? (
          <div style={{ padding: 20, color: 'var(--clr-text-muted)', fontSize: 13 }}>
            No orders yet. Placing one above records it here and as a sale on the owner's dashboard.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr style={{ textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--clr-text-muted)' }}>
                  <th style={{ padding: '10px 12px' }}>Date</th>
                  <th style={{ padding: '10px 12px' }}>Product</th>
                  <th style={{ padding: '10px 12px' }}>Qty</th>
                  <th style={{ padding: '10px 12px' }}>Amount</th>
                  <th style={{ padding: '10px 12px' }}>Placed By</th>
                  <th style={{ padding: '10px 12px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <td style={{ padding: '12px', fontSize: 12, color: 'var(--clr-text-muted)' }}>
                      {new Date(o.created_at).toLocaleString()}
                    </td>
                    <td style={{ padding: '12px', fontSize: 13, color: '#fff', fontWeight: 600 }}>{o.product_name}</td>
                    <td style={{ padding: '12px', fontSize: 13, color: '#00D4FF', fontWeight: 700 }}>{o.quantity}</td>
                    <td style={{ padding: '12px', fontSize: 13, color: 'rgba(255,255,255,0.75)' }}>${Number(o.total_amount).toFixed(2)}</td>
                    <td style={{ padding: '12px', fontSize: 12, color: 'var(--clr-text-muted)' }}>{o.placed_by_email || '—'}</td>
                    <td style={{ padding: '12px' }}>
                      <span className="badge" style={{ fontSize: 11, background: 'rgba(34,211,168,0.15)', color: '#22d3a8', border: '1px solid rgba(34,211,168,0.3)' }}>
                        {o.status}
                      </span>
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
