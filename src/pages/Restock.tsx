import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import emailjs from '@emailjs/browser'
import { supabase } from '../lib/supabaseClient'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import {
  RefreshCw, AlertTriangle, CheckCircle, Clock, Zap,
  Building2, Mail, Phone, MapPin, Plus, X, Pencil, Trash2,
  Package, ChevronDown, ChevronUp, Search, ShoppingCart, History,
  Send, FileText, Users, Activity
} from 'lucide-react'

const EJS_SERVICE  = import.meta.env.VITE_EMAILJS_SERVICE_ID  as string
const EJS_TEMPLATE = import.meta.env.VITE_EMAILJS_TEMPLATE_ID as string
const EJS_KEY      = import.meta.env.VITE_EMAILJS_PUBLIC_KEY  as string

// ─── Types ───────────────────────────────────────────────────────
interface Vendor {
  id: string
  name: string
  company: string
  email: string | null
  phone: string | null
  address: string | null
  category: string
  payment_terms: string
  lead_time_days: number
  status: string
  notes: string | null
  created_at: string
}
interface OrderItem { product_name: string; sku: string; quantity: number; unit_cost: number }
interface RestockOrder {
  id: string
  vendor_id: string
  vendor_name: string
  vendor_email: string | null
  items: OrderItem[]
  total_cost: number
  status: string
  notes: string | null
  ordered_at: string
  expected_delivery: string | null
}

// ─── Constants (categories loaded dynamically from DB) ───────────
const CATEGORIES: string[] = []
const PAYMENT_TERMS = ['Net 30','Net 60','Net 90','COD','Prepaid']
const catColors: Record<string, string> = {
  'AUTOMOTIVE': '#6C63FF', 'CLEANING': '#00D4FF', 'GROCERY I': '#22d3a8',
  'GROCERY II': '#f59e0b', 'BEVERAGES': '#f43f5e', 'FROZEN FOODS': '#38bdf8',
  'DAIRY': '#a78bfa', 'PRODUCE': '#84cc16',
}
const priorityBadge: Record<string, string> = {
  Critical: 'badge-danger', High: 'badge-warning', Medium: 'badge-info',
}
const orderStatusColor: Record<string, string> = {
  Draft: 'rgba(255,255,255,0.35)', Pending: '#f59e0b', Confirmed: '#6C63FF',
  Delivered: '#22d3a8', Cancelled: '#f43f5e',
}

// ─── Email sending via EmailJS ────────────────────────────────────
async function sendOrderEmail(
  vendor: Vendor, items: OrderItem[], notes: string, expectedDelivery: string
): Promise<void> {
  const orderNum = `ORD-${Date.now().toString().slice(-6)}`
  const orderDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const total = items.reduce((s, i) => s + i.quantity * i.unit_cost, 0)

  console.log('[EmailJS] Sending to:', vendor.email, '| Service:', EJS_SERVICE, '| Template:', EJS_TEMPLATE)

  await emailjs.send(
    EJS_SERVICE,
    EJS_TEMPLATE,
    {
      email:             vendor.email ?? '',
      to_email:          vendor.email ?? '',
      to_name:           vendor.name,
      company_name:      vendor.company,
      order_id:          orderNum,
      order_date:        orderDate,
      category:          vendor.category,
      payment_terms:     vendor.payment_terms,
      expected_delivery: expectedDelivery
        ? new Date(expectedDelivery).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : 'To be confirmed',
      notes:             notes || '',
      order_total:       total.toFixed(2),
      orders: items.map(item => ({
        name:       item.product_name,
        sku:        item.sku || 'N/A',
        units:      item.quantity,
        unit_price: Number(item.unit_cost).toFixed(2),
        price:      (item.quantity * item.unit_cost).toFixed(2),
      })),
    },
    EJS_KEY
  )
}

// Plain-text preview shown inside the modal (not the real email, just for review)
function buildEmailPreview(vendor: Vendor, items: OrderItem[], notes: string, expectedDelivery: string) {
  const total = items.reduce((s, i) => s + i.quantity * i.unit_cost, 0)
  return [
    `To: ${vendor.email || '(no email on file)'}`,
    `Subject: Purchase Order — ${vendor.company}`,
    '',
    `Dear ${vendor.name},`,
    '',
    ...items.map((item, i) =>
      `${i + 1}. ${item.product_name}${item.sku ? ` (${item.sku})` : ''}  ×${item.quantity}  @ $${Number(item.unit_cost).toFixed(2)}  = $${(item.quantity * item.unit_cost).toFixed(2)}`
    ),
    '',
    `Total: $${total.toFixed(2)}`,
    `Payment: ${vendor.payment_terms}`,
    expectedDelivery ? `Deliver by: ${expectedDelivery}` : '',
    notes ? `Notes: ${notes}` : '',
  ].filter(Boolean).join('\n')
}

// ─── Shared detail row ────────────────────────────────────────────
function DRow({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 9, border: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ width: 28, height: 28, borderRadius: 7, background: `${color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={13} color={color} />
      </div>
      <div>
        <div style={{ fontSize: 10, color: 'var(--clr-text-muted)', marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 13, fontWeight: 500, wordBreak: 'break-word' }}>{value}</div>
      </div>
    </div>
  )
}

// ─── VendorFormModal ──────────────────────────────────────────────
function VendorFormModal({ mode, vendor, onClose, onSaved }: { mode: 'add' | 'edit'; vendor?: Vendor; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: vendor?.name ?? '',
    company: vendor?.company ?? '',
    email: vendor?.email ?? '',
    phone: vendor?.phone ?? '',
    address: vendor?.address ?? '',
    category: vendor?.category ?? CATEGORIES[0],
    payment_terms: vendor?.payment_terms ?? 'Net 30',
    lead_time_days: vendor?.lead_time_days ?? 7,
    status: vendor?.status ?? 'Active',
    notes: vendor?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)

  const upd = (k: string, v: any) => setForm(p => ({ ...p, [k]: v }))

  const handleSave = async () => {
    if (!form.name.trim() || !form.company.trim()) return
    setSaving(true)
    const payload = { ...form, lead_time_days: Number(form.lead_time_days) }
    if (mode === 'add') await supabase.from('vendors').insert(payload)
    else if (vendor) await supabase.from('vendors').update(payload).eq('id', vendor.id)
    setSaving(false)
    onSaved()
    onClose()
  }

  const inp = { className: 'glass-input', style: { fontSize: 13 } }

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{mode === 'add' ? 'Add Vendor' : 'Edit Vendor'}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={16} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--clr-text-muted)', display: 'block', marginBottom: 5 }}>Contact Person *</label>
              <input {...inp} value={form.name} onChange={e => upd('name', e.target.value)} placeholder="John Smith" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--clr-text-muted)', display: 'block', marginBottom: 5 }}>Company Name *</label>
              <input {...inp} value={form.company} onChange={e => upd('company', e.target.value)} placeholder="Acme Supplies Ltd." />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--clr-text-muted)', display: 'block', marginBottom: 5 }}>Email</label>
              <input {...inp} type="email" value={form.email} onChange={e => upd('email', e.target.value)} placeholder="orders@acme.com" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--clr-text-muted)', display: 'block', marginBottom: 5 }}>Phone</label>
              <input {...inp} value={form.phone} onChange={e => upd('phone', e.target.value)} placeholder="+1 555 000 0000" />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 12, color: 'var(--clr-text-muted)', display: 'block', marginBottom: 5 }}>Address</label>
            <input {...inp} value={form.address} onChange={e => upd('address', e.target.value)} placeholder="123 Industrial Ave, City, State" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--clr-text-muted)', display: 'block', marginBottom: 5 }}>Product Category</label>
              <input className="glass-input" style={{ fontSize: 13 }} list="vendor-categories" value={form.category} onChange={e => upd('category', e.target.value)} placeholder="e.g. DAIRY" />
              <datalist id="vendor-categories">
                {['AUTOMOTIVE','BABY CARE','BEAUTY','BEVERAGES','BOOKS','BREAD/BAKERY','CELEBRATION','CLEANING','DAIRY','DELI','EGGS','FROZEN FOODS','GROCERY I','GROCERY II','HARDWARE','HOME AND KITCHEN I','HOME AND KITCHEN II','HOME APPLIANCES','HOME CARE','LADIESWEAR','LAWN AND GARDEN','LINGERIE','LIQUOR,WINE,BEER','MAGAZINES','MEATS','PERSONAL CARE','PET SUPPLIES','PLAYERS AND ELECTRONICS','POULTRY','PREPARED FOODS','PRODUCE','SCHOOL AND OFFICE SUPPLIES','SEAFOOD'].map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--clr-text-muted)', display: 'block', marginBottom: 5 }}>Payment Terms</label>
              <select className="glass-input" style={{ fontSize: 13 }} value={form.payment_terms} onChange={e => upd('payment_terms', e.target.value)}>
                {PAYMENT_TERMS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--clr-text-muted)', display: 'block', marginBottom: 5 }}>Lead Time (days)</label>
              <input {...inp} type="number" min={1} max={90} value={form.lead_time_days} onChange={e => upd('lead_time_days', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--clr-text-muted)', display: 'block', marginBottom: 5 }}>Status</label>
              <select className="glass-input" style={{ fontSize: 13 }} value={form.status} onChange={e => upd('status', e.target.value)}>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div>
            <label style={{ fontSize: 12, color: 'var(--clr-text-muted)', display: 'block', marginBottom: 5 }}>Notes</label>
            <textarea className="glass-input" style={{ fontSize: 13, width: '100%', minHeight: 70, resize: 'vertical' as const }} value={form.notes} onChange={e => upd('notes', e.target.value)} placeholder="Minimum order qty, special conditions…" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 4 }}>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving || !form.name.trim() || !form.company.trim()}>
              {saving ? 'Saving…' : mode === 'add' ? 'Add Vendor' : 'Save Changes'}
            </button>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── VendorProfileModal ───────────────────────────────────────────
function VendorProfileModal({ vendor, orders, onClose, onEdit, onDelete, onOrder, onHistory }: {
  vendor: Vendor; orders: RestockOrder[]
  onClose: () => void; onEdit: () => void; onDelete: () => void; onOrder: () => void; onHistory: () => void
}) {
  const color = catColors[vendor.category] || '#6C63FF'
  const initials = vendor.company.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const totalValue = orders.reduce((s, o) => s + Number(o.total_cost), 0)
  const [confirming, setConfirming] = useState(false)

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: 460, maxHeight: '90vh', overflowY: 'auto', padding: 0 }} onClick={e => e.stopPropagation()}>
        {/* Banner */}
        <div style={{ background: `linear-gradient(135deg, ${color}28, ${color}0d)`, borderRadius: '16px 16px 0 0', padding: '20px 24px 16px', borderBottom: `1px solid ${color}2a`, position: 'relative' }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ position: 'absolute', top: 14, right: 14 }}><X size={16} /></button>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
            <div style={{ width: 70, height: 70, borderRadius: 16, background: `linear-gradient(135deg, ${color}, ${color}88)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 800, color: '#fff', boxShadow: `0 4px 20px ${color}55`, flexShrink: 0 }}>
              {initials}
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>{vendor.company}</h2>
              <p style={{ margin: 0, color: 'var(--clr-text-muted)', fontSize: 13, marginTop: 2 }}>{vendor.name}</p>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: `${color}28`, color }}>{vendor.category}</span>
                <span className={`badge ${vendor.status === 'Active' ? 'badge-success' : 'badge-accent'}`} style={{ fontSize: 10 }}>{vendor.status}</span>
              </div>
            </div>
          </div>
        </div>

        <div style={{ padding: '20px 24px' }}>
          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 18 }}>
            {[
              { label: 'Orders', value: orders.length.toString() },
              { label: 'Total Value', value: totalValue >= 1000 ? `$${(totalValue / 1000).toFixed(1)}k` : `$${totalValue.toFixed(0)}` },
              { label: 'Lead Time', value: `${vendor.lead_time_days}d` },
            ].map(s => (
              <div key={s.label} style={{ textAlign: 'center', padding: '10px 6px', background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: 19, fontWeight: 700, color }}>{s.value}</div>
                <div style={{ fontSize: 11, color: 'var(--clr-text-muted)', marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Details */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
            {vendor.email && <DRow icon={Mail} label="Email" value={vendor.email} color={color} />}
            {vendor.phone && <DRow icon={Phone} label="Phone" value={vendor.phone} color={color} />}
            {vendor.address && <DRow icon={MapPin} label="Address" value={vendor.address} color={color} />}
            <DRow icon={Clock} label="Payment Terms" value={vendor.payment_terms} color={color} />
            {vendor.notes && <DRow icon={FileText} label="Notes" value={vendor.notes} color={color} />}
          </div>

          {/* Actions */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <button className="btn btn-primary" onClick={onOrder} style={{ fontSize: 13 }}><ShoppingCart size={13} /> Place Order</button>
            <button className="btn btn-ghost" onClick={onHistory} style={{ fontSize: 13 }}><History size={13} /> Order History</button>
            <button className="btn btn-ghost" onClick={onEdit} style={{ fontSize: 13 }}><Pencil size={13} /> Edit Profile</button>
            {!confirming
              ? <button className="btn btn-ghost" style={{ fontSize: 13, color: '#f43f5e', borderColor: 'rgba(244,63,94,0.25)' }} onClick={() => setConfirming(true)}><Trash2 size={13} /> Delete</button>
              : <button className="btn btn-ghost" style={{ fontSize: 13, color: '#f43f5e', borderColor: '#f43f5e' }} onClick={onDelete}>Confirm Delete?</button>
            }
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── OrderModal ───────────────────────────────────────────────────
function OrderModal({ vendor, prefillItem, onClose, onSaved }: {
  vendor: Vendor
  prefillItem?: { name: string; sku: string; suggest: number }
  onClose: () => void
  onSaved: () => void
}) {
  const [items, setItems] = useState<OrderItem[]>(
    prefillItem
      ? [{ product_name: prefillItem.name, sku: prefillItem.sku, quantity: prefillItem.suggest, unit_cost: 0 }]
      : [{ product_name: '', sku: '', quantity: 1, unit_cost: 0 }]
  )
  const [notes, setNotes] = useState('')
  const [expectedDelivery, setExpectedDelivery] = useState('')
  const [saving, setSaving] = useState(false)
  const [emailStatus, setEmailStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [emailError, setEmailError] = useState('')
  const [showPreview, setShowPreview] = useState(false)

  const color = catColors[vendor.category] || '#6C63FF'
  const total = items.reduce((s, i) => s + i.quantity * i.unit_cost, 0)
  const validItems = items.filter(i => i.product_name.trim())

  const addRow = () => setItems(p => [...p, { product_name: '', sku: '', quantity: 1, unit_cost: 0 }])
  const removeRow = (i: number) => setItems(p => p.filter((_, idx) => idx !== i))
  const upd = (i: number, k: keyof OrderItem, v: any) =>
    setItems(p => p.map((item, idx) => idx === i ? { ...item, [k]: v } : item))

  const saveOrder = async (status: string, sendEmail: boolean) => {
    if (!validItems.length) return
    if (sendEmail && !vendor.email?.trim()) {
      setEmailError('This vendor has no email address on file. Edit the vendor profile and add one first.')
      setEmailStatus('error')
      return
    }
    setSaving(true)
    if (sendEmail) setEmailStatus('sending')

    await supabase.from('restock_orders').insert({
      vendor_id: vendor.id, vendor_name: vendor.company, vendor_email: vendor.email,
      items: validItems, total_cost: total, status, notes: notes || null,
      expected_delivery: expectedDelivery || null,
    })

    if (sendEmail) {
      try {
        await sendOrderEmail(vendor, validItems, notes, expectedDelivery)
        setEmailStatus('sent')
        setTimeout(() => { onSaved() }, 1200)
      } catch (err: any) {
        console.error('EmailJS error:', err)
        const detail = err?.text || err?.message || JSON.stringify(err)
        setEmailError(detail)
        setEmailStatus('error')
        setSaving(false)
        return
      }
    } else {
      onSaved()
    }
    setSaving(false)
  }

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: 620, maxHeight: '92vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>Place Restock Order</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
              <span style={{ fontSize: 13, color: 'var(--clr-text-muted)' }}>{vendor.company}</span>
              <span style={{ fontSize: 11, color, fontWeight: 600 }}>{vendor.category}</span>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Items table */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--clr-text-muted)' }}>ORDER ITEMS</span>
            <button className="btn btn-ghost btn-sm" onClick={addRow} style={{ fontSize: 12 }}><Plus size={13} /> Add Item</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 90px 70px 90px 28px', gap: 6, marginBottom: 4, padding: '0 2px' }}>
            {['Product Name', 'SKU', 'Qty', 'Unit Cost ($)', ''].map(h => (
              <span key={h} style={{ fontSize: 10, color: 'var(--clr-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</span>
            ))}
          </div>
          {items.map((item, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 90px 70px 90px 28px', gap: 6, marginBottom: 6 }}>
              <input className="glass-input" style={{ fontSize: 13 }} placeholder="Product name" value={item.product_name} onChange={e => upd(i, 'product_name', e.target.value)} />
              <input className="glass-input" style={{ fontSize: 12 }} placeholder="SKU" value={item.sku} onChange={e => upd(i, 'sku', e.target.value)} />
              <input className="glass-input" style={{ fontSize: 13 }} type="number" min={1} value={item.quantity} onChange={e => upd(i, 'quantity', Math.max(1, parseInt(e.target.value) || 1))} />
              <input className="glass-input" style={{ fontSize: 13 }} type="number" min={0} step="0.01" placeholder="0.00" value={item.unit_cost || ''} onChange={e => upd(i, 'unit_cost', parseFloat(e.target.value) || 0)} />
              <button style={{ background: 'none', border: 'none', cursor: items.length === 1 ? 'not-allowed' : 'pointer', color: '#f43f5e', opacity: items.length === 1 ? 0.25 : 0.7, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }} onClick={() => items.length > 1 && removeRow(i)}><X size={14} /></button>
            </div>
          ))}
        </div>

        {/* Total */}
        <div style={{ textAlign: 'right', fontWeight: 700, fontSize: 16, color, marginBottom: 16, paddingRight: 34 }}>
          Total: ${total.toFixed(2)}
        </div>

        {/* Notes + Delivery */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--clr-text-muted)', display: 'block', marginBottom: 5 }}>Notes</label>
            <textarea className="glass-input" style={{ fontSize: 13, width: '100%', minHeight: 64, resize: 'vertical' as const }} placeholder="Special instructions…" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--clr-text-muted)', display: 'block', marginBottom: 5 }}>Expected Delivery By</label>
            <input className="glass-input" type="date" style={{ fontSize: 13 }} value={expectedDelivery} onChange={e => setExpectedDelivery(e.target.value)} />
            {vendor.lead_time_days > 0 && (
              <p style={{ fontSize: 11, color: 'var(--clr-text-muted)', marginTop: 6 }}>
                Typical lead time: {vendor.lead_time_days} day{vendor.lead_time_days !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        </div>

        {/* Email preview */}
        <button className="btn btn-ghost btn-sm" style={{ fontSize: 12, marginBottom: 10 }} onClick={() => setShowPreview(v => !v)}>
          <FileText size={13} /> {showPreview ? 'Hide' : 'Preview'} Email
        </button>
        {showPreview && (
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: 14, marginBottom: 14, fontSize: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap', maxHeight: 220, overflowY: 'auto', color: 'rgba(255,255,255,0.65)', lineHeight: 1.6 }}>
            {buildEmailPreview(vendor, validItems.length ? validItems : items, notes, expectedDelivery)}
          </div>
        )}

        {!vendor.email && (
          <div style={{ padding: '10px 14px', background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.25)', borderRadius: 9, marginBottom: 14, fontSize: 12, color: '#f43f5e' }}>
            ⚠ No email address on file for this vendor. Add one via Edit Profile to send emails.
          </div>
        )}

        {emailStatus === 'error' && (
          <div style={{ padding: '10px 14px', background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.3)', borderRadius: 9, marginBottom: 12, fontSize: 12, color: '#f43f5e' }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>✕ Email failed to send</div>
            {emailError && <div style={{ fontFamily: 'monospace', opacity: 0.85, wordBreak: 'break-all' }}>{emailError}</div>}
          </div>
        )}
        {emailStatus === 'sent' && (
          <div style={{ padding: '10px 14px', background: 'rgba(34,211,168,0.1)', border: '1px solid rgba(34,211,168,0.3)', borderRadius: 9, marginBottom: 12, fontSize: 12, color: '#22d3a8' }}>
            ✓ Email sent to {vendor.email}. Closing…
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <button className="btn btn-primary" onClick={() => saveOrder('Pending', true)}
            disabled={saving || !validItems.length || emailStatus === 'sent' || !vendor.email?.trim()}
            title={!vendor.email?.trim() ? 'Add an email address to this vendor first' : ''}
            style={{ fontSize: 13 }}>
            <Send size={13} />
            {emailStatus === 'sending' ? 'Sending…' : emailStatus === 'sent' ? '✓ Sent!' : 'Save & Send Email'}
          </button>
          <button className="btn btn-ghost" onClick={() => saveOrder('Draft', false)} disabled={saving || !validItems.length} style={{ fontSize: 13 }}>
            <FileText size={13} /> Save Draft
          </button>
          <button className="btn btn-ghost" onClick={onClose} style={{ fontSize: 13 }}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── OrderHistoryModal ────────────────────────────────────────────
function OrderHistoryModal({ vendor, orders, onClose, onRefresh }: {
  vendor: Vendor; orders: RestockOrder[]
  onClose: () => void; onRefresh: () => void
}) {
  const color = catColors[vendor.category] || '#6C63FF'

  const updateStatus = async (id: string, status: string) => {
    await supabase.from('restock_orders').update({ status }).eq('id', id)
    // When delivered, add ordered quantities back to inventory
    if (status === 'Delivered') {
      const order = orders.find(o => o.id === id)
      if (order?.items) {
        await Promise.all(
          order.items.map(item =>
            supabase.rpc('increment_stock_by_name', { p_name: item.product_name, p_qty: item.quantity })
          )
        )
      }
    }
    onRefresh()
  }

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: 580, maxHeight: '88vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>Order History</h2>
            <p style={{ margin: 0, color: 'var(--clr-text-muted)', fontSize: 13, marginTop: 4 }}>{vendor.company} · {orders.length} order{orders.length !== 1 ? 's' : ''}</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={16} /></button>
        </div>

        {orders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--clr-text-muted)' }}>
            <Package size={36} style={{ marginBottom: 12, opacity: 0.25 }} />
            <p style={{ fontSize: 14 }}>No orders placed yet</p>
            <p style={{ fontSize: 12, marginTop: 6 }}>Use "Place Order" from the vendor profile to create one.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {orders.map(order => {
              const sc = orderStatusColor[order.status] || color
              return (
                <div key={order.id} style={{ padding: '14px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.07)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontWeight: 600, fontSize: 12, color, fontFamily: 'monospace' }}>#{order.id.slice(-8).toUpperCase()}</span>
                      <span style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>{new Date(order.ordered_at).toLocaleDateString()}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: sc }}>${Number(order.total_cost).toFixed(2)}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: `${sc}22`, color: sc }}>{order.status}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 10 }}>
                    {(order.items || []).map((item: OrderItem, i: number) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--clr-text-muted)' }}>
                        <span>{item.product_name}{item.sku ? ` (${item.sku})` : ''} × {item.quantity}</span>
                        <span>${(item.quantity * item.unit_cost).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>

                  {order.notes && <p style={{ fontSize: 11, color: 'var(--clr-text-muted)', marginBottom: 8, fontStyle: 'italic' }}>{order.notes}</p>}
                  {order.expected_delivery && (
                    <p style={{ fontSize: 11, color: 'var(--clr-text-muted)', marginBottom: 8 }}>
                      Expected: {new Date(order.expected_delivery).toLocaleDateString()}
                    </p>
                  )}

                  {order.status !== 'Delivered' && order.status !== 'Cancelled' && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      {order.status === 'Pending' && (
                        <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: '#6C63FF' }} onClick={() => updateStatus(order.id, 'Confirmed')}>Mark Confirmed</button>
                      )}
                      {order.status === 'Confirmed' && (
                        <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: '#22d3a8' }} onClick={() => updateStatus(order.id, 'Delivered')}>Mark Delivered</button>
                      )}
                      {(order.status === 'Pending' || order.status === 'Draft') && (
                        <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: '#f43f5e' }} onClick={() => updateStatus(order.id, 'Cancelled')}>Cancel</button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

// ─── VendorCard ───────────────────────────────────────────────────
function VendorCard({ vendor, onView, onEdit, onOrder }: { vendor: Vendor; onView: () => void; onEdit: () => void; onOrder: () => void }) {
  const color = catColors[vendor.category] || '#6C63FF'
  const initials = vendor.company.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div className="glass-card" style={{ padding: 16, cursor: 'pointer', borderColor: 'transparent', transition: 'border-color 0.2s' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = `${color}55` }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'transparent' }}
      onClick={onView}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: `linear-gradient(135deg, ${color}, ${color}77)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{vendor.company}</div>
          <div style={{ fontSize: 12, color: 'var(--clr-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{vendor.name}</div>
        </div>
        <span className={`badge ${vendor.status === 'Active' ? 'badge-success' : 'badge-accent'}`} style={{ fontSize: 10, flexShrink: 0 }}>{vendor.status}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 }}>
        {vendor.email && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--clr-text-muted)' }}>
            <Mail size={11} color={color} style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{vendor.email}</span>
          </div>
        )}
        {vendor.phone && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--clr-text-muted)' }}>
            <Phone size={11} color={color} style={{ flexShrink: 0 }} /><span>{vendor.phone}</span>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--clr-text-muted)' }}>
          <Clock size={11} color={color} style={{ flexShrink: 0 }} />
          <span>{vendor.lead_time_days}d lead · {vendor.payment_terms}</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }} onClick={e => e.stopPropagation()}>
        <button className="btn btn-primary btn-sm" style={{ flex: 1, fontSize: 12 }} onClick={onOrder}><ShoppingCart size={12} /> Order</button>
        <button className="btn btn-ghost btn-sm" style={{ fontSize: 12 }} onClick={onEdit}><Pencil size={12} /></button>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────
export default function Restock() {
  const [tab, setTab] = useState<'queue' | 'vendors'>('queue')

  // Queue state
  const [autoMode, setAutoMode] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)
  const [restockQueue, setRestockQueue] = useState<any[]>([])
  const [trendData, setTrendData] = useState<any[]>([])
  const [stats, setStats] = useState({ pending: 0, critical: 0, autoApproved: 0, avgTime: '—' })
  const [loading, setLoading] = useState(true)

  // Vendor state
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [orders, setOrders] = useState<RestockOrder[]>([])
  const [vendorLoading, setVendorLoading] = useState(true)
  const [vendorSearch, setVendorSearch] = useState('')
  const [allFamilies, setAllFamilies] = useState<string[]>([])
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set())

  // Modal state
  const [showAddVendor, setShowAddVendor] = useState(false)
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null)
  const [profileVendor, setProfileVendor] = useState<Vendor | null>(null)
  const [orderModal, setOrderModal] = useState<{ vendor: Vendor; prefillItem?: any } | null>(null)
  const [historyVendor, setHistoryVendor] = useState<Vendor | null>(null)
  const [noVendorMsg, setNoVendorMsg] = useState('')

  useEffect(() => { fetchData(); fetchVendors(); fetchFamilies() }, [])

  async function fetchFamilies() {
    const { data } = await supabase.from('products').select('family').order('family')
    if (data) {
      const families = [...new Set((data as any[]).map(r => r.family as string))].sort()
      setAllFamilies(families)
      setExpandedCats(new Set(families))
    }
  }

  async function fetchData() {
    setLoading(true)
    try {
    const { data: invData } = await supabase
      .from('inventory')
      .select('id, product_id, current_stock, reorder_level, products(id, name, family, supplier_lead_time_days)')
      .order('current_stock')

    const twoWeeksAgo = new Date(); twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 13)
    const { data: salesData } = await supabase
      .from('sales_transactions')
      .select('sale_date, quantity_sold')
      .gte('sale_date', twoWeeksAgo.toISOString().split('T')[0])
      .order('sale_date')
      .limit(5000)

    if (invData) {
      const lowStock = invData.filter((i: any) => i.current_stock <= i.reorder_level)
      const queue = lowStock.map((item: any) => {
        const p = Array.isArray(item.products) ? item.products[0] : item.products
        const ratio = item.reorder_level > 0 ? item.current_stock / item.reorder_level : 0
        const priority = item.current_stock === 0 ? 'Critical' : ratio <= 0.5 ? 'Critical' : ratio <= 0.8 ? 'High' : 'Medium'
        return {
          sku: `SKU-${1000 + (p?.id || 0)}`,
          name: p?.name || 'Unknown',
          current: item.current_stock,
          reorder: item.reorder_level,
          suggest: Math.round(item.reorder_level * 3),
          supplier: p?.family || 'Auto-Assign',
          eta: `${p?.supplier_lead_time_days ?? 3} days`,
          priority,
          inventoryId: item.id,
        }
      })
      const avgLead = queue.length
        ? (queue.reduce((s: number, i: any) => s + parseInt(i.eta), 0) / queue.length).toFixed(1) + 'd'
        : '—'
      setRestockQueue(queue)
      setStats({
        pending: queue.length,
        critical: queue.filter((i: any) => i.priority === 'Critical').length,
        autoApproved: queue.filter((i: any) => i.priority === 'Medium').length,
        avgTime: avgLead,
      })
    }

    if (salesData) {
      const dayMap: Record<string, number> = {}
      salesData.forEach((row: any) => { dayMap[row.sale_date] = (dayMap[row.sale_date] || 0) + row.quantity_sold })
      const trend = Object.entries(dayMap).sort().map(([, qty], i) => ({
        day: `Day ${i + 1}`, consumption: qty,
        forecast: Math.round(qty * (0.88 + Math.random() * 0.24)),
      }))
      setTrendData(trend)
    }
    } catch (err) {
      console.error('Error fetching restock data:', err)
    } finally {
      setLoading(false)
    }
  }

  async function fetchVendors() {
    setVendorLoading(true)
    try {
      const [{ data: vdata }, { data: odata }] = await Promise.all([
        supabase.from('vendors').select('*').order('company'),
        supabase.from('restock_orders').select('*').order('ordered_at', { ascending: false }),
      ])
      if (vdata) setVendors(vdata as Vendor[])
      if (odata) setOrders(odata as RestockOrder[])
    } catch (err) {
      console.error('Error fetching vendors:', err)
    } finally {
      setVendorLoading(false)
    }
  }

  const handleApprove = async (item: any) => {
    setProcessing(item.sku)
    // Add suggested restock qty to current stock (additive, not overwrite)
    await supabase.from('inventory')
      .update({ current_stock: item.current + item.suggest, last_updated: new Date().toISOString() })
      .eq('id', item.inventoryId)
    await new Promise(r => setTimeout(r, 900))
    setRestockQueue(prev => prev.filter(i => i.sku !== item.sku))
    setStats(prev => ({ ...prev, pending: prev.pending - 1, critical: item.priority === 'Critical' ? prev.critical - 1 : prev.critical }))
    setProcessing(null)
  }

  const handleQueueOrder = (item: any) => {
    const vendor = vendors.find(v => v.category === item.supplier && v.status === 'Active')
    if (!vendor) {
      setNoVendorMsg(`No active vendor found for "${item.supplier}". Add one in the Vendor Directory tab.`)
      setTimeout(() => setNoVendorMsg(''), 4000)
      return
    }
    setOrderModal({ vendor, prefillItem: { name: item.name, sku: item.sku, suggest: item.suggest } })
  }

  const handleDeleteVendor = async (id: string) => {
    await supabase.from('vendors').delete().eq('id', id)
    setProfileVendor(null)
    fetchVendors()
  }

  // Vendor directory derived data
  const totalVendors = vendors.length
  const activeVendors = vendors.filter(v => v.status === 'Active').length
  const catsCovered = new Set(vendors.map(v => v.category)).size
  const ordersThisMonth = orders.filter(o => {
    const d = new Date(o.ordered_at); const n = new Date()
    return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear()
  }).length

  const filteredVendors = vendors.filter(v =>
    v.company.toLowerCase().includes(vendorSearch.toLowerCase()) ||
    v.name.toLowerCase().includes(vendorSearch.toLowerCase()) ||
    v.category.toLowerCase().includes(vendorSearch.toLowerCase())
  )
  // Use all actual product families; also include any vendor categories not in products
  const vendorOnlyCategories = [...new Set(vendors.map(v => v.category))].filter(c => !allFamilies.includes(c))
  const displayCategories = [...allFamilies, ...vendorOnlyCategories].sort()
  const grouped = displayCategories.reduce((acc, cat) => {
    acc[cat] = filteredVendors.filter(v => v.category === cat)
    return acc
  }, {} as Record<string, Vendor[]>)

  const toggleCat = (cat: string) => setExpandedCats(prev => {
    const next = new Set(prev); if (next.has(cat)) next.delete(cat); else next.add(cat); return next
  })

  return (
    <div className="page-enter">
      {/* Page header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Restock & Vendors</h1>
          <p>Live restock queue, vendor directory, and email-based purchase orders</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => { fetchData(); fetchVendors() }}><RefreshCw size={14} /> Refresh</button>
      </div>

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: 'rgba(255,255,255,0.04)', padding: 4, borderRadius: 12, width: 'fit-content', border: '1px solid rgba(255,255,255,0.08)' }}>
        {(['queue', 'vendors'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '8px 20px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, transition: 'all 0.2s',
            background: tab === t ? 'linear-gradient(135deg, rgba(108,99,255,0.35), rgba(0,212,255,0.25))' : 'transparent',
            color: tab === t ? '#fff' : 'var(--clr-text-muted)',
            boxShadow: tab === t ? '0 0 12px rgba(108,99,255,0.3)' : 'none',
          }}>
            {t === 'queue' ? '⚡ Restock Queue' : '🏢 Vendor Directory'}
          </button>
        ))}
      </div>

      {/* No-vendor toast */}
      {noVendorMsg && (
        <div style={{ padding: '12px 16px', background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.3)', borderRadius: 10, marginBottom: 16, fontSize: 13, color: '#f43f5e', display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertTriangle size={15} /> {noVendorMsg}
        </div>
      )}

      {/* ── RESTOCK QUEUE TAB ─────────────────────────────────────── */}
      {tab === 'queue' && (
        <>
          <div className="stat-grid">
            {[
              { label: 'Pending Reorders',   value: stats.pending.toString(),      color: '#f59e0b', icon: Clock },
              { label: 'Critical Stockouts', value: stats.critical.toString(),     color: '#f43f5e', icon: AlertTriangle },
              { label: 'Medium Priority',    value: stats.autoApproved.toString(), color: '#22d3a8', icon: CheckCircle },
              { label: 'Avg. Lead Time',     value: stats.avgTime,                 color: '#6C63FF', icon: RefreshCw },
            ].map(s => (
              <div key={s.label} className="stat-card" style={{ '--card-glow': `${s.color}33` } as any}>
                <div className="stat-card-icon"><s.icon size={18} color={s.color} /></div>
                <div className="stat-card-label">{s.label}</div>
                <div className="stat-card-value">{loading ? '…' : s.value}</div>
              </div>
            ))}
          </div>

          <div className="grid-21 mb-4">
            <div className="glass-card">
              <div className="flex items-center justify-between mb-4">
                <div className="section-title" style={{ margin: 0 }}>Live Restock Queue</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 13, color: 'var(--clr-text-muted)' }}>Auto-Mode</span>
                  <button onClick={() => setAutoMode(v => !v)}
                    style={{ width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', position: 'relative', background: autoMode ? 'linear-gradient(135deg,#6C63FF,#00D4FF)' : 'rgba(255,255,255,0.1)', transition: 'all 0.3s ease' }}
                    aria-label="Toggle auto restock mode">
                    <div style={{ position: 'absolute', top: 3, left: autoMode ? 23 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.3s ease', boxShadow: '0 2px 4px rgba(0,0,0,0.3)' }} />
                  </button>
                  <span className={`badge ${autoMode ? 'badge-success' : 'badge-accent'}`}><Zap size={10} /> {autoMode ? 'ON' : 'OFF'}</span>
                </div>
              </div>

              {loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[...Array(4)].map((_, i) => <div key={i} className="shimmer" style={{ height: 44, borderRadius: 8 }} />)}
                </div>
              ) : restockQueue.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--clr-text-muted)' }}>
                  <CheckCircle size={32} style={{ marginBottom: 12, color: '#22d3a8' }} />
                  <p style={{ fontSize: 14 }}>All stock levels are healthy!</p>
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr><th>SKU</th><th>Product</th><th>Current</th><th>Suggest</th><th>Category</th><th>ETA</th><th>Priority</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    {restockQueue.map(item => (
                      <tr key={item.sku}>
                        <td><span style={{ color: '#a89dff', fontWeight: 600, fontSize: 12 }}>{item.sku}</span></td>
                        <td style={{ fontWeight: 500 }}>{item.name}</td>
                        <td><span style={{ color: item.current === 0 ? 'var(--clr-danger)' : 'var(--clr-warning)', fontWeight: 700 }}>{item.current}</span></td>
                        <td style={{ color: '#00D4FF', fontWeight: 600 }}>{item.suggest}</td>
                        <td style={{ color: 'var(--clr-text-muted)', fontSize: 12 }}>{item.supplier}</td>
                        <td style={{ fontSize: 12 }}>{item.eta}</td>
                        <td><span className={`badge ${priorityBadge[item.priority]}`}>{item.priority}</span></td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className={`btn btn-sm ${processing === item.sku ? 'btn-ghost' : 'btn-primary'}`}
                              onClick={() => handleApprove(item)} disabled={processing === item.sku}>
                              {processing === item.sku ? '⏳' : autoMode ? '✓ Auto' : 'Approve'}
                            </button>
                            <button className="btn btn-ghost btn-sm" title="Send vendor order email"
                              style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => handleQueueOrder(item)}>
                              <Mail size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="glass-card">
              <div className="section-title">Daily Consumption Trend (14 Days)</div>
              <div className="chart-wrapper-lg">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="day" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false} interval={2} />
                    <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: 'rgba(5,8,16,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '10px 16px', boxShadow: '0 12px 32px rgba(0,0,0,0.6)' }} labelStyle={{ color: '#fff', fontWeight: 700, fontSize: 13, marginBottom: 4 }} itemStyle={{ fontSize: 12, fontWeight: 600 }} />
                    <Line type="monotone" dataKey="consumption" stroke="#6C63FF" strokeWidth={2} dot={false} activeDot={{ r: 7, stroke: '#fff', strokeWidth: 1.5, filter: 'drop-shadow(0 0 10px #6C63FF)' }} name="Actual" connectNulls />
                    <Line type="monotone" dataKey="forecast" stroke="#00D4FF" strokeWidth={2} dot={false} strokeDasharray="5 5" activeDot={{ r: 7, stroke: '#fff', strokeWidth: 1.5, filter: 'drop-shadow(0 0 10px #00D4FF)' }} name="Forecast" connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
                <p style={{ fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 8 }}>Automation Rules</p>
                {[
                  { rule: 'Reorder when stock ≤ reorder level', on: true },
                  { rule: 'Suggest qty: 3× reorder level', on: true },
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
        </>
      )}

      {/* ── VENDOR DIRECTORY TAB ──────────────────────────────────── */}
      {tab === 'vendors' && (
        <>
          {/* Vendor stats */}
          <div className="stat-grid">
            {[
              { label: 'Total Vendors',     value: vendorLoading ? '…' : totalVendors.toString(),    color: '#6C63FF', icon: Building2 },
              { label: 'Active Vendors',    value: vendorLoading ? '…' : activeVendors.toString(),   color: '#22d3a8', icon: CheckCircle },
              { label: 'Categories Covered', value: vendorLoading ? '…' : catsCovered.toString(),   color: '#00D4FF', icon: Users },
              { label: 'Orders This Month', value: vendorLoading ? '…' : ordersThisMonth.toString(), color: '#f59e0b', icon: Activity },
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
              <input className="glass-input" style={{ paddingLeft: 38, fontSize: 13 }} placeholder="Search vendors by name, company or category…" value={vendorSearch} onChange={e => setVendorSearch(e.target.value)} />
            </div>
            <button className="btn btn-primary" onClick={() => setShowAddVendor(true)}><Plus size={14} /> Add Vendor</button>
          </div>

          {/* Categories accordion */}
          {displayCategories.map(cat => {
            const catVendors = grouped[cat] || []
            if (vendorSearch && !catVendors.length) return null
            const color = catColors[cat] || '#6C63FF'
            const isOpen = expandedCats.has(cat)
            return (
              <div key={cat} style={{ marginBottom: 10 }}>
                <button onClick={() => toggleCat(cat)} style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 18px', background: `${color}0e`, border: `1px solid ${color}30`,
                  borderRadius: isOpen ? '12px 12px 0 0' : 12, cursor: 'pointer', textAlign: 'left',
                }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, boxShadow: `0 0 8px ${color}88`, flexShrink: 0 }} />
                  <span style={{ fontWeight: 700, color, fontSize: 13 }}>{cat}</span>
                  <span style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>
                    {catVendors.length} vendor{catVendors.length !== 1 ? 's' : ''}
                  </span>
                  {catVendors.length === 0 && (
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginLeft: 4 }}>— no vendors yet</span>
                  )}
                  <div style={{ marginLeft: 'auto', color: 'var(--clr-text-muted)' }}>
                    {isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  </div>
                </button>

                {isOpen && (
                  <div style={{ border: `1px solid ${color}1a`, borderTop: 'none', borderRadius: '0 0 12px 12px', padding: '16px', background: `${color}04` }}>
                    {catVendors.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--clr-text-muted)', fontSize: 13 }}>
                        No vendors in this category yet.{' '}
                        <button className="btn btn-ghost btn-sm" style={{ fontSize: 12 }}
                          onClick={() => { setShowAddVendor(true) }}>
                          <Plus size={12} /> Add vendor
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                        {catVendors.map(v => (
                          <VendorCard key={v.id} vendor={v}
                            onView={() => setProfileVendor(v)}
                            onEdit={() => setEditingVendor(v)}
                            onOrder={() => setOrderModal({ vendor: v })}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {vendors.length === 0 && !vendorLoading && (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--clr-text-muted)' }}>
              <Building2 size={48} style={{ marginBottom: 16, opacity: 0.15 }} />
              <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No vendors yet</p>
              <p style={{ fontSize: 13, marginBottom: 20 }}>Add your first vendor to start placing restock orders by email.</p>
              <button className="btn btn-primary" onClick={() => setShowAddVendor(true)}><Plus size={14} /> Add Your First Vendor</button>
            </div>
          )}
        </>
      )}

      {/* ── Modals ────────────────────────────────────────────────── */}
      {showAddVendor && (
        <VendorFormModal mode="add" onClose={() => setShowAddVendor(false)} onSaved={fetchVendors} />
      )}
      {editingVendor && (
        <VendorFormModal mode="edit" vendor={editingVendor} onClose={() => setEditingVendor(null)} onSaved={() => { fetchVendors(); setProfileVendor(null) }} />
      )}
      {profileVendor && (
        <VendorProfileModal
          vendor={profileVendor}
          orders={orders.filter(o => o.vendor_id === profileVendor.id)}
          onClose={() => setProfileVendor(null)}
          onEdit={() => { setEditingVendor(profileVendor); setProfileVendor(null) }}
          onDelete={() => handleDeleteVendor(profileVendor.id)}
          onOrder={() => { setOrderModal({ vendor: profileVendor }); setProfileVendor(null) }}
          onHistory={() => { setHistoryVendor(profileVendor); setProfileVendor(null) }}
        />
      )}
      {orderModal && (
        <OrderModal
          vendor={orderModal.vendor}
          prefillItem={orderModal.prefillItem}
          onClose={() => setOrderModal(null)}
          onSaved={() => { fetchVendors(); setOrderModal(null) }}
        />
      )}
      {historyVendor && (
        <OrderHistoryModal
          vendor={historyVendor}
          orders={orders.filter(o => o.vendor_id === historyVendor.id)}
          onClose={() => setHistoryVendor(null)}
          onRefresh={fetchVendors}
        />
      )}
    </div>
  )
}
