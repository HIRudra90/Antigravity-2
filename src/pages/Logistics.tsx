import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabaseClient'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell,
} from 'recharts'
import {
  Truck, MapPin, Package, RefreshCw, Plus, X, ExternalLink, CheckCircle, Navigation,
} from 'lucide-react'

const DELYVA_API = 'https://api.delyva.app/v1.0'
const DELYVA_KEY = import.meta.env.VITE_DELYVA_API_KEY as string
const dHeaders = () => ({
  'Content-Type': 'application/json',
  'X-Delyvax-Access-Token': DELYVA_KEY,
})

function statusLabel(code: number) {
  if (code < 200) return 'Order Placed'
  if (code < 300) return 'Confirmed'
  if (code < 400) return 'Driver Assigned'
  if (code < 500) return 'Picked Up'
  if (code < 600) return 'In Transit'
  if (code < 700) return 'Out for Delivery'
  if (code < 800) return 'Delivered'
  return 'Cancelled'
}

function statusBadge(code: number) {
  if (code >= 700 && code < 800) return 'badge-success'
  if (code >= 800) return 'badge-warning'
  if (code >= 400) return 'badge-info'
  return 'badge-warning'
}

const MY_STATES = [
  'Johor','Kedah','Kelantan','Kuala Lumpur','Labuan','Melaka',
  'Negeri Sembilan','Pahang','Penang','Perak','Perlis','Putrajaya',
  'Sabah','Sarawak','Selangor','Terengganu',
]

interface Shipment {
  id: string
  delyva_order_id: string | null
  tracking_no: string | null
  consignment_no: string | null
  service_name: string | null
  carrier: string | null
  recipient_name: string
  recipient_phone: string
  recipient_address: string
  recipient_city: string
  recipient_state: string
  recipient_postcode: string
  weight_kg: number
  item_type: string
  notes: string | null
  price: number | null
  currency: string
  status_code: number
  created_at: string
}

interface QuoteOption {
  serviceCode: string
  serviceName: string
  companyName: string
  price: number
  currency: string
  eta: string
}

// ─── New Shipment Modal ────────────────────────────────────────────────────────
interface Inventory { id: number; name: string; address1?: string; city?: string; state?: string; postcode?: string; phone?: string }

function NewShipmentModal({ customerId, onClose, onBooked }: {
  customerId: number | null
  onClose: () => void
  onBooked: () => void
}) {
  const blank = {
    oName: 'Inventiq Warehouse', oPhone: '', oAddress: '', oCity: '', oState: 'Selangor', oPostcode: '',
    rName: '', rPhone: '', rAddress: '', rCity: '', rState: 'Selangor', rPostcode: '',
    weight: '1', itemType: 'PARCEL', notes: '',
  }
  const [form, setForm] = useState(blank)
  const [step, setStep] = useState<'form' | 'quotes'>('form')
  const [quotes, setQuotes] = useState<QuoteOption[]>([])
  const [selected, setSelected] = useState<QuoteOption | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [inventories, setInventories] = useState<Inventory[]>([])
  const [inventoryId, setInventoryId] = useState<number | null>(() => {
    const saved = localStorage.getItem('delyva_inventory_id')
    return saved ? Number(saved) : 134643
  })

  // inventory ID is hardcoded (134643) — /inventory endpoint not available in this API tier

  const set = (k: keyof typeof blank) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }))

  async function getQuotes() {
    setErr('')
    if (!form.oPostcode || !form.oCity || !form.oAddress || !form.rPostcode || !form.rCity || !form.rAddress || !form.rName || !form.rPhone) {
      setErr('Please fill in all required fields (*)'); return
    }
    setBusy(true)
    try {
      const body: any = {
        origin: { address1: form.oAddress, city: form.oCity, state: form.oState, postcode: form.oPostcode, country: 'MY' },
        destination: { address1: form.rAddress, city: form.rCity, state: form.rState, postcode: form.rPostcode, country: 'MY' },
        weight: { unit: 'kg', value: parseFloat(form.weight) || 1 },
        itemType: form.itemType,
      }
      if (customerId) body.customerId = customerId
      const res = await fetch(`${DELYVA_API}/service/instantQuote`, {
        method: 'POST', headers: dHeaders(), body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || JSON.stringify(data))
      const svcs = data.data?.services || data.services || []
      if (!svcs.length) throw new Error('No couriers available for this route')
      const parsed: QuoteOption[] = svcs.map((s: any, i: number) => {
        const svc = s.service || {}
        const hours = s.duration ? Math.round(s.duration / 3600) : null
        const etaStr = hours ? (hours < 24 ? `~${hours}h` : `~${Math.round(hours / 24)} day(s)`) : 'TBD'
        return {
          serviceCode: svc.serviceCompany?.companyCode || svc.code || String(i),
          serviceName: svc.name || `Service ${i + 1}`,
          companyName: svc.serviceCompany?.name || svc.name || `Carrier ${i + 1}`,
          price: s.price?.amount ?? 0,
          currency: s.price?.currency || 'MYR',
          eta: etaStr,
        }
      })
      setQuotes(parsed)
      setSelected(parsed[0])
      setStep('quotes')
    } catch (e: any) {
      setErr(e.message || 'Failed to get quotes')
    }
    setBusy(false)
  }

  async function book() {
    if (!selected) return
    if (!inventoryId) { setErr('Inventory ID is required. Enter it from your Delyva portal → Inventory section.'); return }
    setBusy(true); setErr('')
    try {
      const orderBody: any = {
        process: true,
        serviceCode: selected.serviceCode,
        origin: {
          contact: {
            name: form.oName,
            phone: form.oPhone || '+60100000000',
            address1: form.oAddress,
            city: form.oCity,
            state: form.oState,
            postcode: form.oPostcode,
            country: 'MY',
          },
          inventory: [{
            type: 'PICKUP',
            name: form.itemType || 'PARCEL',
            weight: { unit: 'kg', value: parseFloat(form.weight) || 1 },
          }],
        },
        destination: {
          contact: {
            name: form.rName,
            phone: form.rPhone,
            address1: form.rAddress,
            city: form.rCity,
            state: form.rState,
            postcode: form.rPostcode,
            country: 'MY',
          },
          inventory: [{
            type: 'DROPOFF',
            name: form.itemType || 'PARCEL',
            weight: { unit: 'kg', value: parseFloat(form.weight) || 1 },
          }],
        },
        weight: { unit: 'kg', value: parseFloat(form.weight) || 1 },
        itemType: form.itemType,
        note: form.notes || undefined,
      }
      if (customerId) orderBody.customerId = customerId

      const oRes = await fetch(`${DELYVA_API}/order`, {
        method: 'POST', headers: dHeaders(), body: JSON.stringify(orderBody),
      })
      const oData = await oRes.json()
      console.log('[Delyva] create order response:', JSON.stringify(oData))
      if (!oRes.ok) throw new Error(oData?.error?.message || oData.message || JSON.stringify(oData))
      const o = oData.data?.order || oData.order || oData.data || oData
      const orderId = o?.id || o?.orderId || o?.order_id
      const trackingNo = o?.trackingNo || o?.tracking_no || String(orderId)
      const consignmentNo = o?.consignmentNo || o?.consignment_no || String(orderId)
      const statusCode = o?.statusCode ?? 200

      await supabase.from('shipments').insert({
        delyva_order_id: String(orderId),
        tracking_no: trackingNo,
        consignment_no: consignmentNo,
        service_name: selected.serviceName,
        carrier: selected.companyName,
        recipient_name: form.rName,
        recipient_phone: form.rPhone,
        recipient_address: form.rAddress,
        recipient_city: form.rCity,
        recipient_state: form.rState,
        recipient_postcode: form.rPostcode,
        weight_kg: parseFloat(form.weight) || 1,
        item_type: form.itemType,
        notes: form.notes || null,
        price: selected.price,
        currency: selected.currency,
        status_code: statusCode,
      })

      setOk(`Booked! Order ID: ${orderId}${trackingNo !== String(orderId) ? ` · Tracking: ${trackingNo}` : ''}`)
      setTimeout(() => onBooked(), 3000)
    } catch (e: any) {
      setErr(e.message || 'Booking failed')
    }
    setBusy(false)
  }

  const field = (label: string, k: keyof typeof blank, opts?: { type?: string; placeholder?: string; col?: string }) => (
    <div style={opts?.col ? { gridColumn: opts.col } : {}}>
      <label style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>{label}</label>
      <input className="form-input" type={opts?.type || 'text'} value={form[k]} onChange={set(k)} placeholder={opts?.placeholder} />
    </div>
  )

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: 580, maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>{step === 'form' ? 'New Shipment' : 'Choose Courier'}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--clr-text-muted)' }}><X size={20} /></button>
        </div>

        {err && <div style={{ padding: '10px 14px', background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.3)', borderRadius: 8, marginBottom: 14, color: '#f43f5e', fontSize: 13 }}>{err}</div>}
        {ok  && <div style={{ padding: '10px 14px', background: 'rgba(34,211,168,0.1)', border: '1px solid rgba(34,211,168,0.3)', borderRadius: 8, marginBottom: 14, color: '#22d3a8', fontSize: 13 }}>{ok}</div>}

        {step === 'form' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* Inventory / Warehouse */}
            <div>
              <label style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>
                Delyva Warehouse / Inventory ID *
                <a href="https://my.delyva.app/customer/inventory" target="_blank" rel="noopener noreferrer"
                  style={{ marginLeft: 8, color: '#6C63FF', fontSize: 11 }}>Find yours →</a>
              </label>
              {inventories.length > 0 ? (
                <select className="form-input" value={inventoryId ?? ''} onChange={e => {
                  const id = Number(e.target.value)
                  setInventoryId(id)
                  const inv = inventories.find(i => i.id === id)
                  if (inv) setForm(f => ({
                    ...f,
                    oName: inv.name || f.oName,
                    oPhone: inv.phone || f.oPhone,
                    oAddress: inv.address1 || f.oAddress,
                    oCity: inv.city || f.oCity,
                    oState: inv.state || f.oState,
                    oPostcode: inv.postcode || f.oPostcode,
                  }))
                }}>
                  {inventories.map(inv => <option key={inv.id} value={inv.id}>{inv.name}</option>)}
                </select>
              ) : (
                <input
                  className="form-input"
                  type="number"
                  placeholder="Enter inventory ID from Delyva portal"
                  value={inventoryId ?? ''}
                  onChange={e => {
                    const v = Number(e.target.value) || null
                    setInventoryId(v)
                    if (v) localStorage.setItem('delyva_inventory_id', String(v))
                  }}
                />
              )}
            </div>

            {/* Sender */}
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--clr-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Sender / Pickup *</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {field('Sender Name *', 'oName', { placeholder: 'Inventiq Warehouse' })}
                {field('Sender Phone *', 'oPhone', { placeholder: '+601x-xxxxxxx' })}
                {field('Pickup Address *', 'oAddress', { col: '1/-1', placeholder: 'Street address' })}
                {field('City *', 'oCity', { placeholder: 'Kuala Lumpur' })}
                {field('Postcode *', 'oPostcode', { placeholder: '50000' })}
                <div>
                  <label style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>State</label>
                  <select className="form-input" value={form.oState} onChange={set('oState')}>
                    {MY_STATES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Recipient */}
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--clr-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Recipient / Delivery *</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {field('Recipient Name *', 'rName', { placeholder: 'Customer name' })}
                {field('Phone *', 'rPhone', { placeholder: '+601x-xxxxxxx' })}
                {field('Delivery Address *', 'rAddress', { col: '1/-1', placeholder: 'Street address' })}
                {field('City *', 'rCity', { placeholder: 'Petaling Jaya' })}
                {field('Postcode *', 'rPostcode', { placeholder: '47301' })}
                <div>
                  <label style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>State</label>
                  <select className="form-input" value={form.rState} onChange={set('rState')}>
                    {MY_STATES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Parcel */}
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--clr-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Parcel Details</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {field('Weight (kg) *', 'weight', { type: 'number', placeholder: '1' })}
                <div>
                  <label style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>Item Type</label>
                  <select className="form-input" value={form.itemType} onChange={set('itemType')}>
                    <option value="PARCEL">Parcel</option>
                    <option value="DOCUMENT">Document</option>
                    <option value="FOOD">Food</option>
                    <option value="FRAGILE">Fragile</option>
                  </select>
                </div>
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>Notes</label>
                  <textarea className="form-input" value={form.notes} onChange={set('notes')} placeholder="Special instructions..." rows={2} style={{ resize: 'none' }} />
                </div>
              </div>
            </div>

            <button className="btn btn-primary" onClick={getQuotes} disabled={busy}>
              {busy ? 'Getting quotes…' : 'Get Courier Quotes'}
            </button>
          </div>
        )}

        {step === 'quotes' && (
          <div>
            <p style={{ fontSize: 13, color: 'var(--clr-text-muted)', marginBottom: 16 }}>
              {form.oCity} → {form.rCity} · {form.weight}kg · {form.itemType}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {quotes.map((q, qi) => (
                <div
                  key={q.serviceCode || qi}
                  onClick={() => setSelected(q)}
                  style={{
                    padding: '14px 16px', borderRadius: 10, cursor: 'pointer',
                    border: `1px solid ${selected?.serviceCode === q.serviceCode ? 'rgba(108,99,255,0.6)' : 'rgba(255,255,255,0.08)'}`,
                    background: selected?.serviceCode === q.serviceCode ? 'rgba(108,99,255,0.1)' : 'rgba(255,255,255,0.02)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}
                >
                  <div>
                    <p style={{ fontWeight: 600, fontSize: 14 }}>{q.companyName}</p>
                    <p style={{ fontSize: 12, color: 'var(--clr-text-muted)', marginTop: 2 }}>{q.serviceName} · Est. {q.eta}</p>
                  </div>
                  <p style={{ fontWeight: 700, fontSize: 16, color: selected?.serviceCode === q.serviceCode ? '#a89dff' : '#fff' }}>
                    {q.currency} {Number(q.price).toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setStep('form')}>Back</button>
              <button className="btn btn-primary" style={{ flex: 2 }} onClick={book} disabled={busy || !selected}>
                {busy ? 'Booking…' : `Book with ${selected?.companyName || ''}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

// ─── Order Detail Modal ────────────────────────────────────────────────────────
function OrderDetailModal({ s, onClose }: { s: Shipment; onClose: () => void }) {
  const [shipment, setShipment] = useState<Shipment>(s)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState('')

  const steps = ['Order Placed', 'Confirmed', 'Picked Up', 'In Transit', 'Delivered']
  const codes  = [100, 200, 400, 500, 700]
  const done   = codes.findIndex(c => shipment.status_code < c)
  const doneTo = done === -1 ? 5 : done

  // A "real" tracking number is not a UUID
  const isUUID = (v: string | null) => !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v)
  const hasRealTracking = shipment.consignment_no && !isUUID(shipment.consignment_no)

  async function refreshTracking() {
    if (!shipment.delyva_order_id) return
    setRefreshing(true); setRefreshMsg('')
    try {
      const res = await fetch(`https://api.delyva.app/v1.0/order/${shipment.delyva_order_id}`, {
        headers: { 'Content-Type': 'application/json', 'X-Delyvax-Access-Token': import.meta.env.VITE_DELYVA_API_KEY },
      })
      const data = await res.json()
      const o = data.data?.order || data.order || data.data || {}
      const newConsignment = o.consignmentNo || o.trackingNo || null
      const newStatus = o.statusCode ?? shipment.status_code

      if (newConsignment && newConsignment !== shipment.consignment_no) {
        await supabase.from('shipments').update({
          consignment_no: newConsignment,
          tracking_no: newConsignment,
          status_code: newStatus,
        }).eq('id', shipment.id)
        setShipment(prev => ({ ...prev, consignment_no: newConsignment, tracking_no: newConsignment, status_code: newStatus }))
        setRefreshMsg('Tracking number updated!')
      } else if (newStatus !== shipment.status_code) {
        await supabase.from('shipments').update({ status_code: newStatus }).eq('id', shipment.id)
        setShipment(prev => ({ ...prev, status_code: newStatus }))
        setRefreshMsg('Status updated.')
      } else {
        setRefreshMsg('No update yet — courier is still processing. Try again in a few minutes.')
      }
    } catch {
      setRefreshMsg('Could not reach Delyva. Try again.')
    }
    setRefreshing(false)
  }

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: 580 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>Shipment Details</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--clr-text-muted)' }}><X size={20} /></button>
        </div>

        {/* Progress bar */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 24 }}>
          {steps.map((step, i) => (
            <div key={step} style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ height: 4, borderRadius: 99, background: i < doneTo ? '#6C63FF' : 'rgba(255,255,255,0.1)', marginBottom: 4 }} />
              <span style={{ fontSize: 10, color: i < doneTo ? '#a89dff' : 'var(--clr-text-dim)' }}>{step}</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
          {[
            { label: 'Tracking No', val: hasRealTracking ? shipment.consignment_no! : 'Pending courier assignment', color: hasRealTracking ? '#a89dff' : 'var(--clr-text-muted)' },
            { label: 'Carrier', val: shipment.carrier || shipment.service_name || '-', color: undefined },
            { label: 'Recipient', val: `${shipment.recipient_name} · ${shipment.recipient_phone}`, color: undefined },
            { label: 'Amount', val: `${shipment.currency} ${Number(shipment.price || 0).toFixed(2)}`, color: '#22d3a8' },
          ].map(({ label, val, color }) => (
            <div key={label} style={{ padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
              <p style={{ fontSize: 11, color: 'var(--clr-text-muted)', marginBottom: 4 }}>{label}</p>
              <p style={{ fontWeight: 600, fontSize: 13, color: color || 'inherit' }}>{val}</p>
            </div>
          ))}
          <div style={{ gridColumn: '1/-1', padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
            <p style={{ fontSize: 11, color: 'var(--clr-text-muted)', marginBottom: 4 }}>Delivery Address</p>
            <p style={{ fontSize: 13 }}>{shipment.recipient_address}, {shipment.recipient_city}, {shipment.recipient_state} {shipment.recipient_postcode}</p>
          </div>
        </div>

        {/* Tracking status box */}
        {!hasRealTracking && (
          <div style={{ padding: 14, background: 'rgba(245,158,11,0.08)', borderRadius: 10, border: '1px solid rgba(245,158,11,0.25)', marginBottom: 14 }}>
            <p style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600, marginBottom: 4 }}>Awaiting waybill from courier</p>
            <p style={{ fontSize: 11, color: 'var(--clr-text-muted)' }}>
              Delyva Order ID: <span style={{ color: '#a89dff' }}>{shipment.delyva_order_id || '-'}</span>
            </p>
            <p style={{ fontSize: 11, color: 'var(--clr-text-muted)', marginTop: 4 }}>
              J&T / Pos Laju etc. assigns a waybill number after confirming pickup. Click "Refresh Tracking" to check.
            </p>
            {refreshMsg && <p style={{ fontSize: 11, color: '#22d3a8', marginTop: 6 }}>{refreshMsg}</p>}
          </div>
        )}
        {hasRealTracking && refreshMsg && (
          <p style={{ fontSize: 11, color: '#22d3a8', marginBottom: 10 }}>{refreshMsg}</p>
        )}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={refreshTracking} disabled={refreshing} className="btn btn-ghost btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={13} className={refreshing ? 'spin' : ''} /> {refreshing ? 'Checking…' : 'Refresh Tracking'}
          </button>
          {shipment.delyva_order_id && (
            <a href={`https://my.delyva.app/customer/orders/${shipment.delyva_order_id}`} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <ExternalLink size={13} /> View on Delyva
            </a>
          )}
          {hasRealTracking && (
            <a href={`https://delyva.com/my/tracking/?trackingNo=${shipment.consignment_no}`} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Navigation size={13} /> Public Tracker
            </a>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── Static chart data ─────────────────────────────────────────────────────────
const deliveryTime  = [{ company: 'J&T', time: 2.1 }, { company: 'Pos Laju', time: 2.5 }, { company: 'DHL', time: 1.8 }, { company: 'Ninja Van', time: 2.8 }]
const shippingCost  = [{ month: 'Jan', cost: 1200 }, { month: 'Feb', cost: 1500 }, { month: 'Mar', cost: 1800 }, { month: 'Apr', cost: 1100 }, { month: 'May', cost: 2200 }, { month: 'Jun', cost: 1900 }]
const providerUsage = [{ name: 'J&T', value: 40, color: '#6C63FF' }, { name: 'Pos Laju', value: 25, color: '#00D4FF' }, { name: 'DHL', value: 20, color: '#22d3a8' }, { name: 'Ninja Van', value: 15, color: '#FF6B9D' }]
const ttStyle = { contentStyle: { background: 'rgba(5,8,16,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '10px 16px' }, labelStyle: { color: '#fff', fontWeight: 700, fontSize: 13 }, itemStyle: { fontSize: 12 } }

// ─── Main Component ────────────────────────────────────────────────────────────
export default function Logistics() {
  const [tab, setTab] = useState<'dashboard' | 'orders'>('dashboard')
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [viewing, setViewing] = useState<Shipment | null>(null)
  const [customerId, setCustomerId] = useState<number | null>(null)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    fetchCustomerId()
    const { data } = await supabase.from('shipments').select('*').order('created_at', { ascending: false })
    setShipments((data as Shipment[]) || [])
    setLoading(false)
  }

  async function fetchCustomerId() {
    try {
      const res = await fetch(`${DELYVA_API}/user`, { headers: dHeaders() })
      const data = await res.json()
      const cid = data.data?.user?.company?.id || data.user?.company?.id || data.data?.company?.id
      if (cid) setCustomerId(Number(cid))
    } catch {}
  }

  const active    = shipments.filter(s => s.status_code < 700).length
  const delivered = shipments.filter(s => s.status_code >= 700 && s.status_code < 800).length
  const totalMYR  = shipments.reduce((a, s) => a + (Number(s.price) || 0), 0)

  return (
    <div className="page-enter">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Logistics</h1>
          <p>Book shipments via Delyva — compare courier rates, track deliveries in real-time</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={fetchAll}><RefreshCw size={14} /></button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><Plus size={14} /> New Shipment</button>
        </div>
      </div>

      {/* Stats */}
      <div className="stat-grid" style={{ marginBottom: 20 }}>
        {[
          { label: 'Active Shipments',   value: active,                      color: '#6C63FF' },
          { label: 'Delivered',          value: delivered,                   color: '#22d3a8' },
          { label: 'Total Spent',        value: `RM ${totalMYR.toFixed(2)}`, color: '#00D4FF' },
          { label: 'Total Shipments',    value: shipments.length,            color: '#f59e0b' },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ '--card-glow': `${s.color}33` } as any}>
            <div className="stat-card-label">{s.label}</div>
            <div className="stat-card-value" style={{ color: s.color }}>{loading ? '…' : s.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
        {(['dashboard', 'orders'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            background: tab === t ? 'rgba(108,99,255,0.2)' : 'rgba(255,255,255,0.04)',
            color: tab === t ? '#a89dff' : 'var(--clr-text-muted)',
            transition: 'all 0.15s',
          }}>
            {t === 'dashboard' ? 'Dashboard' : 'My Shipments'}
          </button>
        ))}
      </div>

      {/* ── Dashboard tab ── */}
      {tab === 'dashboard' && (
        <>
          <div className="grid-3 mb-4" style={{ marginBottom: 16 }}>
            <div className="glass-card">
              <div className="section-title">Delivery Time per Carrier (Days)</div>
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={deliveryTime}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="company" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip {...ttStyle} />
                    <Bar dataKey="time" name="Avg Days" fill="#00D4FF" radius={[3,3,0,0]} activeBar={{ stroke: '#fff', strokeWidth: 1, fill: '#45e3ff' }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="glass-card">
              <div className="section-title">Shipping Cost Trend (RM)</div>
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={shippingCost}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `RM${v}`} />
                    <Tooltip {...ttStyle} />
                    <Line type="monotone" dataKey="cost" stroke="#f43f5e" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 7, stroke: '#fff', strokeWidth: 1.5 }} name="Cost (RM)" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="glass-card">
              <div className="section-title">Carrier Usage</div>
              <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={providerUsage} cx="50%" cy="50%" innerRadius={40} outerRadius={65} paddingAngle={4} dataKey="value">
                      {providerUsage.map((c, i) => <Cell key={i} fill={c.color} />)}
                    </Pie>
                    <Tooltip {...ttStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px', justifyContent: 'center', marginTop: 10 }}>
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

          {/* Recent shipments */}
          <div className="glass-card">
            <div className="section-title">
              Recent Shipments
              <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><Plus size={13} /> Book</button>
            </div>
            {shipments.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--clr-text-muted)' }}>
                <Truck size={40} style={{ opacity: 0.2, marginBottom: 10, display: 'block', margin: '0 auto 10px' }} />
                <p>No shipments yet. Click "New Shipment" to book your first delivery.</p>
              </div>
            ) : (
              <table className="data-table">
                <thead><tr><th>Tracking</th><th>Recipient</th><th>Carrier</th><th>Amount</th><th>Status</th></tr></thead>
                <tbody>
                  {shipments.slice(0, 6).map(s => (
                    <tr key={s.id} onClick={() => setViewing(s)} style={{ cursor: 'pointer' }}>
                      <td><span style={{ color: '#a89dff', fontWeight: 600, fontSize: 12 }}>{s.tracking_no || s.id.slice(0, 8)}</span></td>
                      <td>
                        <p style={{ fontWeight: 500, fontSize: 13 }}>{s.recipient_name}</p>
                        <p style={{ fontSize: 11, color: 'var(--clr-text-muted)' }}>{s.recipient_city}, {s.recipient_state}</p>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>{s.carrier || s.service_name || '—'}</td>
                      <td style={{ fontWeight: 600, color: '#22d3a8' }}>RM {Number(s.price || 0).toFixed(2)}</td>
                      <td><span className={`badge ${statusBadge(s.status_code)}`}>{statusLabel(s.status_code)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ── My Shipments tab ── */}
      {tab === 'orders' && (
        <div className="glass-card">
          <div className="section-title">
            All Shipments ({shipments.length})
            <button className="btn btn-ghost btn-sm" onClick={fetchAll}><RefreshCw size={13} /></button>
          </div>
          {shipments.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--clr-text-muted)' }}>
              <Package size={40} style={{ opacity: 0.2, display: 'block', margin: '0 auto 10px' }} />
              <p>No shipments booked yet.</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr><th>Date</th><th>Tracking</th><th>Recipient</th><th>Destination</th><th>Carrier</th><th>Weight</th><th>Amount</th><th>Status</th></tr>
              </thead>
              <tbody>
                {shipments.map(s => (
                  <tr key={s.id} onClick={() => setViewing(s)} style={{ cursor: 'pointer' }}>
                    <td style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>{new Date(s.created_at).toLocaleDateString('en-MY')}</td>
                    <td><span style={{ color: '#a89dff', fontWeight: 600, fontSize: 12 }}>{s.tracking_no || s.id.slice(0, 8)}</span></td>
                    <td>
                      <p style={{ fontWeight: 500, fontSize: 13 }}>{s.recipient_name}</p>
                      <p style={{ fontSize: 11, color: 'var(--clr-text-muted)' }}>{s.recipient_phone}</p>
                    </td>
                    <td style={{ fontSize: 12 }}>{s.recipient_city}, {s.recipient_state}</td>
                    <td style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>{s.carrier || '—'}</td>
                    <td style={{ fontSize: 12 }}>{s.weight_kg}kg</td>
                    <td style={{ fontWeight: 600, color: '#22d3a8' }}>RM {Number(s.price || 0).toFixed(2)}</td>
                    <td><span className={`badge ${statusBadge(s.status_code)}`}>{statusLabel(s.status_code)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {showNew && (
        <NewShipmentModal
          customerId={customerId}
          onClose={() => setShowNew(false)}
          onBooked={() => { setShowNew(false); fetchAll() }}
        />
      )}
      {viewing && <OrderDetailModal s={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}
