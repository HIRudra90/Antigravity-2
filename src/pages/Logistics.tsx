import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabaseClient'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Sector,
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
const carrierMeta: Record<string, { avgDays: number; reliability: string; coverage: string; tier: string; avgCost: string; strength: string }> = {
  'J&T':       { avgDays: 2.1, reliability: '94%', coverage: 'Nationwide', tier: 'Budget',     avgCost: 'RM 8–15',   strength: 'Best for bulk orders & nationwide reach' },
  'Pos Laju':  { avgDays: 2.5, reliability: '91%', coverage: 'Nationwide', tier: 'Budget',     avgCost: 'RM 7–12',   strength: 'Most affordable, strong rural coverage' },
  'DHL':       { avgDays: 1.8, reliability: '98%', coverage: 'International', tier: 'Premium', avgCost: 'RM 20–50',  strength: 'Fastest delivery, best for high-value items' },
  'Ninja Van': { avgDays: 2.8, reliability: '89%', coverage: 'Nationwide', tier: 'Mid-range',  avgCost: 'RM 10–20',  strength: 'Good for same-day in major cities' },
}
const ttStyle = { contentStyle: { background: 'rgba(5,8,16,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '10px 16px' }, labelStyle: { color: '#fff', fontWeight: 700, fontSize: 13 }, itemStyle: { fontSize: 12 } }

function GlowSlice(props: any) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props
  return (
    <Sector
      cx={cx} cy={cy}
      innerRadius={innerRadius - 4}
      outerRadius={outerRadius + 14}
      startAngle={startAngle}
      endAngle={endAngle}
      fill={fill}
      style={{ filter: `drop-shadow(0 0 10px ${fill}) drop-shadow(0 0 22px ${fill}cc)` }}
    />
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function Logistics() {
  const [tab, setTab] = useState<'dashboard' | 'orders'>('dashboard')
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [viewing, setViewing] = useState<Shipment | null>(null)
  const [customerId, setCustomerId] = useState<number | null>(null)
  const [activeCarrierIdx, setActiveCarrierIdx] = useState<number | null>(null)
  const [hoverCarrierIdx, setHoverCarrierIdx] = useState<number | null>(null)
  const [modalCard, setModalCard] = useState<string | null>(null)
  // Hover previews on top of whatever's pinned by a click; leaving the chart
  // falls back to the pinned slice instead of clearing the panel.
  const displayCarrierIdx = hoverCarrierIdx ?? activeCarrierIdx
  const activeCarrier = displayCarrierIdx !== null ? providerUsage[displayCarrierIdx] : null
  const activeMeta = activeCarrier ? carrierMeta[activeCarrier.name] : null

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
          { id: 'active',         label: 'Active Shipments', value: active,                      color: '#6C63FF' },
          { id: 'delivered',      label: 'Delivered',        value: delivered,                   color: '#22d3a8' },
          { id: 'totalSpent',     label: 'Total Spent',      value: `RM ${totalMYR.toFixed(2)}`, color: '#00D4FF' },
          { id: 'totalShipments', label: 'Total Shipments',  value: shipments.length,            color: '#f59e0b' },
        ].map(s => (
          <div key={s.label} className="stat-card"
            onClick={() => setModalCard(s.id)}
            style={{ '--card-glow': `${s.color}33`, cursor: 'pointer', transition: 'box-shadow 0.25s ease, transform 0.18s ease' } as any}
            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = `0 0 0 1px ${s.color}99, 0 0 30px ${s.color}77, 0 0 60px ${s.color}44`; el.style.transform = 'translateY(-2px)' }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = ''; el.style.transform = '' }}
          >
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
          {/* ── Bar + Line charts ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div className="glass-card">
              <div className="section-title">Delivery Time per Carrier (Days)</div>
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={deliveryTime} barCategoryGap="35%">
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="company" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      cursor={false}
                      contentStyle={{ background: 'rgba(5,8,16,0.96)', border: '1px solid #00D4FF44', borderRadius: 12, padding: '10px 16px', boxShadow: '0 0 20px #00D4FF22' }}
                      labelStyle={{ color: '#fff', fontWeight: 700, fontSize: 13, marginBottom: 4 }}
                      itemStyle={{ color: '#00D4FF', fontWeight: 600, fontSize: 12 }}
                      formatter={(v: any) => [`${v} days`, 'Avg Delivery']}
                    />
                    <Bar dataKey="time" name="Avg Days" fill="#00D4FF" radius={[6,6,0,0]}
                      activeBar={{ fill: '#00D4FF', strokeWidth: 0, filter: 'drop-shadow(0 0 8px #00D4FF) drop-shadow(0 0 18px #00D4FFAA) brightness(1.3)' }} />
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
                    <Tooltip
                      contentStyle={{ background: 'rgba(5,8,16,0.96)', border: '1px solid #f43f5e44', borderRadius: 12, padding: '10px 16px', boxShadow: '0 0 20px #f43f5e22' }}
                      labelStyle={{ color: '#fff', fontWeight: 700, fontSize: 13, marginBottom: 4 }}
                      itemStyle={{ color: '#f43f5e', fontWeight: 600, fontSize: 12 }}
                    />
                    <Line type="monotone" dataKey="cost" stroke="#f43f5e" strokeWidth={2.5} dot={{ fill: '#f43f5e', r: 3 }} activeDot={{ r: 8, stroke: '#fff', strokeWidth: 2, filter: 'drop-shadow(0 0 10px #f43f5e)' }} name="Cost (RM)" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* ── Carrier Usage — full width with side detail panel ── */}
          <div className="glass-card" style={{ marginBottom: 16 }}>
            <div className="section-title" style={{ marginBottom: 16 }}>Carrier Usage</div>
            <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
              {/* Donut chart */}
              <div style={{ flex: '0 0 260px' }}>
                <PieChart width={260} height={240}>
                  <Pie
                    data={providerUsage}
                    cx="50%" cy="50%"
                    innerRadius={60} outerRadius={95}
                    paddingAngle={4}
                    dataKey="value"
                    activeIndex={displayCarrierIdx ?? undefined}
                    activeShape={GlowSlice}
                    onMouseEnter={(_, idx) => setHoverCarrierIdx(idx)}
                    onMouseLeave={() => setHoverCarrierIdx(null)}
                    onClick={(_, idx) => setActiveCarrierIdx(prev => prev === idx ? null : idx)}
                    style={{ cursor: 'pointer' }}
                  >
                    {providerUsage.map((c, i) => (
                      <Cell
                        key={i}
                        fill={c.color}
                        opacity={displayCarrierIdx === null || displayCarrierIdx === i ? 1 : 0.3}
                        style={{ transition: 'opacity 0.2s ease' }}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    cursor={false}
                    contentStyle={{ background: 'rgba(5,8,16,0.96)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '8px 14px' }}
                    labelStyle={{ display: 'none' }}
                    itemStyle={{ color: '#fff' }}
                    wrapperStyle={{ outline: 'none' }}
                    formatter={(v: any, _: any, props: any) => {
                      const c = props?.payload?.color ?? '#fff'
                      return [<span style={{ color: c, fontWeight: 700 }}>{v}%</span>, <span style={{ color: '#fff', fontWeight: 600 }}>{props?.payload?.name}</span>]
                    }}
                  />
                </PieChart>

                {/* Legend dots */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', justifyContent: 'center' }}>
                  {providerUsage.map((p, i) => (
                    <div
                      key={p.name}
                      onClick={() => setActiveCarrierIdx(prev => prev === i ? null : i)}
                      onMouseEnter={() => setHoverCarrierIdx(i)}
                      onMouseLeave={() => setHoverCarrierIdx(null)}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer',
                        opacity: displayCarrierIdx === null || displayCarrierIdx === i ? 1 : 0.4,
                        transition: 'opacity 0.2s ease' }}
                    >
                      <div style={{ width: 9, height: 9, borderRadius: 3, background: p.color,
                        boxShadow: displayCarrierIdx === i ? `0 0 8px ${p.color}` : 'none',
                        transition: 'box-shadow 0.2s ease' }} />
                      <span style={{ color: displayCarrierIdx === i ? '#fff' : 'var(--clr-text-muted)', fontWeight: displayCarrierIdx === i ? 700 : 400 }}>{p.name}</span>
                      <span style={{ color: p.color, fontWeight: 700 }}>{p.value}%</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Divider */}
              <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,0.07)', flexShrink: 0 }} />

              {/* Detail panel */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {activeCarrier && activeMeta ? (
                  <div style={{ animation: 'pageIn 0.2s ease-out' }}>
                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                      <div style={{ width: 14, height: 14, borderRadius: 4, background: activeCarrier.color, flexShrink: 0,
                        boxShadow: `0 0 10px ${activeCarrier.color}, 0 0 20px ${activeCarrier.color}88` }} />
                      <h3 style={{ fontSize: 22, fontWeight: 800, color: activeCarrier.color, margin: 0 }}>{activeCarrier.name}</h3>
                      <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 20, background: `${activeCarrier.color}22`, color: activeCarrier.color, border: `1px solid ${activeCarrier.color}44`, fontWeight: 600 }}>
                        {activeMeta.tier}
                      </span>
                    </div>

                    {/* Usage bar */}
                    <div style={{ marginBottom: 18 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>Usage Share</span>
                        <span style={{ fontSize: 14, fontWeight: 800, color: activeCarrier.color }}>{activeCarrier.value}%</span>
                      </div>
                      <div style={{ height: 10, background: 'rgba(255,255,255,0.06)', borderRadius: 6, overflow: 'hidden' }}>
                        <div style={{ width: `${activeCarrier.value}%`, height: '100%', background: activeCarrier.color, borderRadius: 6,
                          boxShadow: `0 0 10px ${activeCarrier.color}99`, transition: 'width 0.4s ease' }} />
                      </div>
                    </div>

                    {/* Stats grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                      {[
                        { label: 'Avg Delivery',  value: `${activeMeta.avgDays} days`, color: activeCarrier.color },
                        { label: 'Reliability',   value: activeMeta.reliability,        color: '#22d3a8' },
                        { label: 'Coverage',      value: activeMeta.coverage,           color: '#00D4FF' },
                        { label: 'Avg Cost',      value: activeMeta.avgCost,            color: '#f59e0b' },
                      ].map(s => (
                        <div key={s.label} style={{ padding: '12px 14px', borderRadius: 10,
                          background: `${s.color}09`, border: `1px solid ${s.color}22` }}>
                          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 5 }}>{s.label}</div>
                          <div style={{ fontSize: 15, fontWeight: 800, color: s.color }}>{s.value}</div>
                        </div>
                      ))}
                    </div>

                    {/* Strength note */}
                    <div style={{ padding: '12px 16px', borderRadius: 10,
                      background: `${activeCarrier.color}0d`, border: `1px solid ${activeCarrier.color}33` }}>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>Best for</div>
                      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', lineHeight: 1.5 }}>{activeMeta.strength}</div>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    height: '100%', gap: 12, padding: '20px 0' }}>
                    <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(255,255,255,0.04)',
                      border: '1px dashed rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Truck size={22} color="rgba(255,255,255,0.2)" />
                    </div>
                    <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', textAlign: 'center', maxWidth: 200 }}>
                      Hover or click a segment to see carrier details
                    </p>
                  </div>
                )}
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

      {/* ── Stat Card Detail Modals ──────────────────────────────── */}
      {modalCard && createPortal(
        <div className="modal-backdrop" onClick={() => setModalCard(null)}>
          <div className="modal-panel" style={{ maxWidth: 680, maxHeight: '88vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            {(() => {
              const colors: Record<string, string> = { active: '#6C63FF', delivered: '#22d3a8', totalSpent: '#00D4FF', totalShipments: '#f59e0b' }
              const titles: Record<string, string> = { active: 'Active Shipments', delivered: 'Delivered Shipments', totalSpent: 'Shipping Cost Analysis', totalShipments: 'All Shipments' }
              const mc = colors[modalCard] || '#6C63FF'
              const activeList    = shipments.filter(s => s.status_code < 700)
              const deliveredList = shipments.filter(s => s.status_code >= 700 && s.status_code < 800)
              return (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: mc, boxShadow: `0 0 10px ${mc}` }} />
                      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{titles[modalCard]}</h2>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={() => setModalCard(null)}><X size={16} /></button>
                  </div>

                  {/* active shipments */}
                  {modalCard === 'active' && (
                    activeList.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--clr-text-muted)' }}>
                        <CheckCircle size={32} style={{ color: '#22d3a8', display: 'block', margin: '0 auto 12px' }} />
                        <p>No active shipments — all deliveries completed!</p>
                      </div>
                    ) : (
                      <div>
                        <p style={{ fontSize: 13, color: 'var(--clr-text-muted)', marginBottom: 12 }}>{activeList.length} shipment{activeList.length !== 1 ? 's' : ''} currently in transit</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 430, overflowY: 'auto' }}>
                          {activeList.map(s => (
                            <div key={s.id} style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(108,99,255,0.05)', border: '1px solid rgba(108,99,255,0.18)' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                <span style={{ fontWeight: 600, color: '#a89dff', fontSize: 12, fontFamily: 'monospace' }}>{s.tracking_no || s.id.slice(0,8)}</span>
                                <span className={`badge ${statusBadge(s.status_code)}`}>{statusLabel(s.status_code)}</span>
                              </div>
                              <p style={{ fontSize: 13, fontWeight: 500 }}>{s.recipient_name} — {s.recipient_city}, {s.recipient_state}</p>
                              <p style={{ fontSize: 11, color: 'var(--clr-text-muted)', marginTop: 2 }}>{s.carrier || s.service_name || '—'} · RM {Number(s.price || 0).toFixed(2)}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  )}

                  {/* delivered shipments */}
                  {modalCard === 'delivered' && (
                    deliveredList.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--clr-text-muted)' }}>
                        <Package size={32} style={{ display: 'block', margin: '0 auto 12px', opacity: 0.25 }} />
                        <p>No delivered shipments yet.</p>
                      </div>
                    ) : (
                      <div>
                        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                          {[
                            { label: 'Delivered', value: deliveredList.length.toString(), color: '#22d3a8' },
                            { label: 'Total Value', value: `RM ${deliveredList.reduce((a, s) => a + (Number(s.price) || 0), 0).toFixed(2)}`, color: '#00D4FF' },
                          ].map(s => (
                            <div key={s.label} style={{ flex: 1, padding: '12px 14px', borderRadius: 10, background: `${s.color}0d`, border: `1px solid ${s.color}22` }}>
                              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>{s.label}</div>
                              <div style={{ fontSize: 18, fontWeight: 800, color: s.color }}>{s.value}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto' }}>
                          {deliveredList.map(s => (
                            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, background: 'rgba(34,211,168,0.05)', border: '1px solid rgba(34,211,168,0.15)' }}>
                              <CheckCircle size={14} color="#22d3a8" style={{ flexShrink: 0 }} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <p style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.recipient_name}</p>
                                <p style={{ fontSize: 11, color: 'var(--clr-text-muted)' }}>{s.carrier || '—'} · {s.recipient_city}</p>
                              </div>
                              <span style={{ fontSize: 13, fontWeight: 700, color: '#22d3a8', flexShrink: 0 }}>RM {Number(s.price || 0).toFixed(2)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  )}

                  {/* totalSpent */}
                  {modalCard === 'totalSpent' && (
                    <div>
                      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                        {[
                          { label: 'Total Spent', value: `RM ${totalMYR.toFixed(2)}`, color: '#00D4FF' },
                          { label: 'Avg per Shipment', value: shipments.length ? `RM ${(totalMYR / shipments.length).toFixed(2)}` : 'RM 0', color: '#6C63FF' },
                          { label: 'Shipments', value: shipments.length.toString(), color: '#f59e0b' },
                        ].map(s => (
                          <div key={s.label} style={{ flex: 1, padding: '12px 14px', borderRadius: 10, background: `${s.color}0d`, border: `1px solid ${s.color}22` }}>
                            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>{s.label}</div>
                            <div style={{ fontSize: 15, fontWeight: 800, color: s.color }}>{s.value}</div>
                          </div>
                        ))}
                      </div>
                      <p style={{ fontSize: 13, color: 'var(--clr-text-muted)', marginBottom: 8 }}>6-month shipping cost trend</p>
                      <div style={{ height: 200 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={shippingCost}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                            <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `RM${v}`} />
                            <Tooltip contentStyle={{ background: 'rgba(5,8,16,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10 }} />
                            <Line type="monotone" dataKey="cost" stroke="#00D4FF" strokeWidth={2.5} dot={{ fill: '#00D4FF', r: 4 }} activeDot={{ r: 8, stroke: '#fff', strokeWidth: 2, filter: 'drop-shadow(0 0 10px #00D4FF)' }} name="Cost (RM)" />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                      <p style={{ fontSize: 12, color: 'var(--clr-text-muted)', marginTop: 12 }}>Carrier breakdown by cost: DHL avg RM 20–50 · J&T avg RM 8–15 · Pos Laju avg RM 7–12</p>
                    </div>
                  )}

                  {/* totalShipments */}
                  {modalCard === 'totalShipments' && (
                    shipments.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--clr-text-muted)' }}>
                        <Truck size={32} style={{ display: 'block', margin: '0 auto 12px', opacity: 0.2 }} />
                        <p>No shipments booked yet.</p>
                      </div>
                    ) : (
                      <div>
                        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                          {[
                            { label: 'Total', value: shipments.length.toString(), color: '#f59e0b' },
                            { label: 'In Transit', value: activeList.length.toString(), color: '#6C63FF' },
                            { label: 'Delivered', value: deliveredList.length.toString(), color: '#22d3a8' },
                          ].map(s => (
                            <div key={s.label} style={{ flex: 1, padding: '12px 14px', borderRadius: 10, background: `${s.color}0d`, border: `1px solid ${s.color}22` }}>
                              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>{s.label}</div>
                              <div style={{ fontSize: 18, fontWeight: 800, color: s.color }}>{s.value}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 380, overflowY: 'auto' }}>
                          {shipments.map(s => (
                            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <p style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.recipient_name}</p>
                                <p style={{ fontSize: 11, color: 'var(--clr-text-muted)' }}>{s.carrier || '—'} · {s.recipient_city}, {s.recipient_state}</p>
                              </div>
                              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                <p style={{ fontSize: 13, fontWeight: 700, color: '#22d3a8' }}>RM {Number(s.price || 0).toFixed(2)}</p>
                                <span className={`badge ${statusBadge(s.status_code)}`} style={{ fontSize: 10 }}>{statusLabel(s.status_code)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  )}
                </>
              )
            })()}
          </div>
        </div>,
        document.body
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
