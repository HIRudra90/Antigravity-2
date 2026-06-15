import { useState, useEffect } from 'react'
import {
  User, Monitor, Package, Zap, CreditCard, Truck, Bell, Shield,
  UploadCloud, Save, Calendar, DollarSign,
  ShoppingCart, Shuffle, Edit3, Check, RefreshCw, AlertTriangle, ChevronDown
} from 'lucide-react'
import GlassSelect from '../components/GlassSelect'
import { supabase } from '../lib/supabaseClient'

const TABS = [
  { id: 'profile',       label: 'Profile',       icon: User },
  { id: 'system',        label: 'System',        icon: Monitor },
  { id: 'salary',        label: 'Salary / Auto-Pay', icon: DollarSign },
  { id: 'inventory',     label: 'Inventory',     icon: Package },
  { id: 'ai',            label: 'AI Settings',   icon: Zap },
  { id: 'payments',      label: 'Payments',      icon: CreditCard },
  { id: 'logistics',     label: 'Logistics',     icon: Truck },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'security',      label: 'Security',      icon: Shield },
]

function Toggle({ checked, onChange }: { checked: boolean, onChange: () => void }) {
  return (
    <div onClick={onChange} style={{ width: 40, height: 22, borderRadius: 11, background: checked ? '#22d3a8' : 'rgba(255,255,255,0.1)', position: 'relative', cursor: 'pointer', transition: 'background 0.2s' }}>
      <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: checked ? 21 : 3, transition: 'left 0.2s' }} />
    </div>
  )
}

export default function Settings() {
  const [activeTab, setActiveTab] = useState('profile')
  const [autoRestock, setAutoRestock] = useState(false)
  const [aiEnabled, setAiEnabled] = useState(true)
  const [autoRecom, setAutoRecom] = useState(true)
  const [autoShipping, setAutoShipping] = useState(false)

  // ── Inventory Management ──────────────────────────────────────
  const [invSubTab, setInvSubTab] = useState<'sale' | 'generate' | 'stock'>('sale')
  const [invProducts, setInvProducts] = useState<any[]>([])
  const [invLoading, setInvLoading] = useState(false)

  // Record Sale
  const [saleProductId, setSaleProductId] = useState<number | ''>('')
  const [saleQty, setSaleQty] = useState(1)
  const [saleDate, setSaleDate] = useState(new Date().toISOString().split('T')[0])
  const [salePromo, setSalePromo] = useState(false)
  const [saleLoading, setSaleLoading] = useState(false)
  const [saleMsg, setSaleMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  // Generate Synthetic Data
  const [genProductId, setGenProductId] = useState<number | 'all'>('all')
  const [genStartDate, setGenStartDate] = useState('2026-01-01')
  const [genEndDate, setGenEndDate] = useState(new Date().toISOString().split('T')[0])
  const [genMinQty, setGenMinQty] = useState(5)
  const [genMaxQty, setGenMaxQty] = useState(30)
  const [genLoading, setGenLoading] = useState(false)
  const [genMsg, setGenMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  // Stock Adjustment
  const [stockEdits, setStockEdits] = useState<Record<number, { stock: number; reorder: number }>>({})
  const [stockSaving, setStockSaving] = useState<number | null>(null)
  const [stockSaved, setStockSaved] = useState<number | null>(null)

  // Salary auto-pay settings
  const [autoPayEnabled, setAutoPayEnabled] = useState(false)
  const [autoPayDay, setAutoPayDay] = useState(1)
  const [salarySettingsLoading, setSalarySettingsLoading] = useState(true)
  const [salarySettingsSaved, setSalarySettingsSaved] = useState(false)

  useEffect(() => {
    if (activeTab === 'inventory' && invProducts.length === 0) loadInvProducts()
  }, [activeTab])

  const loadInvProducts = async () => {
    setInvLoading(true)
    const { data } = await supabase
      .from('products')
      .select('id, name, family, unit_price, inventory(id, current_stock, reorder_level)')
      .order('family')
    if (data) {
      setInvProducts(data.map((p: any) => ({
        ...p,
        current_stock: Array.isArray(p.inventory) ? p.inventory[0]?.current_stock ?? 0 : p.inventory?.current_stock ?? 0,
        reorder_level: Array.isArray(p.inventory) ? p.inventory[0]?.reorder_level ?? 0 : p.inventory?.reorder_level ?? 0,
        inventory_id: Array.isArray(p.inventory) ? p.inventory[0]?.id : p.inventory?.id,
      })))
    }
    setInvLoading(false)
  }

  const recordSale = async () => {
    if (!saleProductId || saleQty < 1) return
    setSaleLoading(true); setSaleMsg(null)
    try {
      const { error } = await supabase.from('sales_transactions').insert({
        product_id: saleProductId, sale_date: saleDate, quantity_sold: saleQty, on_promotion: salePromo
      })
      if (error) throw error
      const product = invProducts.find(p => p.id === saleProductId)
      if (product?.inventory_id) {
        await supabase.from('inventory').update({
          current_stock: Math.max(0, product.current_stock - saleQty),
          last_updated: new Date().toISOString()
        }).eq('id', product.inventory_id)
        setInvProducts(prev => prev.map(p => p.id === saleProductId
          ? { ...p, current_stock: Math.max(0, p.current_stock - saleQty) } : p))
      }
      setSaleMsg({ type: 'success', text: `Recorded: ${saleQty} × ${product?.name} sold on ${saleDate}` })
      setSaleQty(1); setSaleProductId('')
    } catch (e: any) { setSaleMsg({ type: 'error', text: e.message }) }
    setSaleLoading(false)
  }

  const generateSyntheticData = async () => {
    setGenLoading(true); setGenMsg(null)
    try {
      const start = new Date(genStartDate); const end = new Date(genEndDate)
      if (start > end) throw new Error('Start date must be before end date')
      const targets = genProductId === 'all' ? invProducts : invProducts.filter(p => p.id === genProductId)
      const rows: any[] = []
      const cur = new Date(start)
      while (cur <= end) {
        const dateStr = cur.toISOString().split('T')[0]
        for (const p of targets) {
          rows.push({
            product_id: p.id,
            sale_date: dateStr,
            quantity_sold: Math.floor(Math.random() * (genMaxQty - genMinQty + 1)) + genMinQty,
            on_promotion: Math.random() < 0.15
          })
        }
        cur.setDate(cur.getDate() + 1)
      }
      let inserted = 0
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase.from('sales_transactions').insert(rows.slice(i, i + 500))
        if (error) throw error
        inserted += Math.min(500, rows.length - i)
      }
      setGenMsg({ type: 'success', text: `Generated ${inserted.toLocaleString()} records for ${targets.length} product(s) across ${Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1} days.` })
    } catch (e: any) { setGenMsg({ type: 'error', text: e.message }) }
    setGenLoading(false)
  }

  const saveStockEdit = async (productId: number) => {
    const edit = stockEdits[productId]; if (!edit) return
    setStockSaving(productId)
    const product = invProducts.find(p => p.id === productId)
    if (product?.inventory_id) {
      await supabase.from('inventory').update({
        current_stock: edit.stock, reorder_level: edit.reorder, last_updated: new Date().toISOString()
      }).eq('id', product.inventory_id)
      setInvProducts(prev => prev.map(p => p.id === productId
        ? { ...p, current_stock: edit.stock, reorder_level: edit.reorder } : p))
    }
    setStockSaving(null); setStockSaved(productId)
    setTimeout(() => setStockSaved(null), 2000)
    setStockEdits(prev => { const n = { ...prev }; delete n[productId]; return n })
  }

  useEffect(() => {
    const loadSettings = async () => {
      setSalarySettingsLoading(true)
      const { data } = await supabase.from('app_settings').select('*')
      if (data) {
        const autoPaySetting = data.find((s: any) => s.setting_key === 'auto_pay_enabled')
        const autoPayDaySetting = data.find((s: any) => s.setting_key === 'auto_pay_day')
        if (autoPaySetting) setAutoPayEnabled(autoPaySetting.setting_value === 'true')
        if (autoPayDaySetting) setAutoPayDay(parseInt(autoPayDaySetting.setting_value) || 1)
      }
      setSalarySettingsLoading(false)
    }
    loadSettings()
  }, [])

  const saveSalarySettings = async () => {
    await supabase.from('app_settings').upsert([
      { setting_key: 'auto_pay_enabled', setting_value: autoPayEnabled.toString(), updated_at: new Date().toISOString() },
      { setting_key: 'auto_pay_day', setting_value: autoPayDay.toString(), updated_at: new Date().toISOString() }
    ], { onConflict: 'setting_key' })
    setSalarySettingsSaved(true)
    setTimeout(() => setSalarySettingsSaved(false), 2000)
  }

  return (
    <div className="page-enter">
      <div className="page-header" style={{ marginBottom: 24 }}>
        <h1>Settings & Configuration</h1>
        <p>Control panel for system behavior, internal security, and AI logic</p>
      </div>

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        {/* Vertical Tabs Sidebar */}
        <div className="glass-card" style={{ width: 220, flexShrink: 0, padding: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {TABS.map(tab => {
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                    borderRadius: 'var(--r-md)', background: isActive ? 'rgba(108,99,255,0.15)' : 'transparent',
                    color: isActive ? '#6C63FF' : 'var(--clr-text-muted)',
                    border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: isActive ? 600 : 500,
                    textAlign: 'left', transition: 'all 0.2s'
                  }}
                >
                  <tab.icon size={16} />
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Main Content Pane */}
        <div className="glass-card" style={{ flex: 1, minHeight: 450, padding: 32 }}>
          
          {/* PROFILE SETTINGS */}
          {activeTab === 'profile' && (
            <div className="animation-fade-in">
              <h2 style={{ fontSize: 18, marginBottom: 20 }}>Profile Settings</h2>
              <div style={{ display: 'flex', gap: 32 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 90, height: 90, borderRadius: '50%', background: 'linear-gradient(135deg, #6C63FF, #00D4FF)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 700 }}>H</div>
                  <button className="btn btn-ghost btn-sm" style={{ fontSize: 12 }}><UploadCloud size={14} /> Upload Image</button>
                </div>
                <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Full Name</label>
                    <input className="glass-input" defaultValue="Hasidul Islam" style={{ width: '100%' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Email</label>
                    <input className="glass-input" defaultValue="admin@stockmind.ai" style={{ width: '100%' }} />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Company Name</label>
                    <input className="glass-input" defaultValue="Antigravity Inc." style={{ width: '100%' }} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SALARY / AUTO-PAY SETTINGS */}
          {activeTab === 'salary' && (
            <div className="animation-fade-in">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                <DollarSign color="#22d3a8" />
                <h2 style={{ fontSize: 18 }}>Salary & Auto-Pay Settings</h2>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 600 }}>
                {/* Auto-pay toggle */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', background: 'rgba(34,211,168,0.05)', borderRadius: 'var(--r-md)', border: '1px solid rgba(34,211,168,0.15)' }}>
                  <div>
                    <h3 style={{ fontSize: 14, fontWeight: 600, color: '#22d3a8', marginBottom: 4 }}>Automatic Salary Payment</h3>
                    <p style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>Automatically mark all employee salaries as paid on a specific day each month.</p>
                  </div>
                  <Toggle checked={autoPayEnabled} onChange={() => setAutoPayEnabled(!autoPayEnabled)} />
                </div>

                {/* Auto-pay day selection */}
                <div style={{ opacity: autoPayEnabled ? 1 : 0.4, pointerEvents: autoPayEnabled ? 'auto' : 'none', transition: 'opacity 0.3s' }}>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Payment Day of Month</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Calendar size={16} color="var(--clr-text-muted)" />
                    <select
                      className="glass-input"
                      style={{ width: 140 }}
                      value={autoPayDay}
                      onChange={e => setAutoPayDay(parseInt(e.target.value))}
                    >
                      {Array.from({ length: 28 }, (_, i) => i + 1).map(day => (
                        <option key={day} value={day}>
                          {day}{day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th'} of every month
                        </option>
                      ))}
                    </select>
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--clr-text-muted)', marginTop: 8 }}>
                    All due salaries will be automatically marked as paid on the {autoPayDay}{autoPayDay === 1 ? 'st' : autoPayDay === 2 ? 'nd' : autoPayDay === 3 ? 'rd' : 'th'} of each month.
                  </p>
                </div>

                {/* Info box */}
                <div style={{ background: 'rgba(0,212,255,0.05)', border: '1px solid rgba(0,212,255,0.15)', borderRadius: 'var(--r-md)', padding: 14 }}>
                  <p style={{ fontSize: 12, color: 'rgba(0,212,255,0.8)', lineHeight: 1.6 }}>
                    💡 When auto-pay is enabled, salary records for all active employees will be created and marked as "Paid" on the selected day. You can still manually pay individual employees from the Employees page anytime.
                  </p>
                </div>

                {/* Save button */}
                <button className="btn btn-primary" onClick={saveSalarySettings} style={{ alignSelf: 'flex-start' }}>
                  <Save size={16} /> {salarySettingsSaved ? '✓ Saved!' : 'Save Salary Settings'}
                </button>
              </div>
            </div>
          )}

          {/* SYSTEM SETTINGS */}
          {activeTab === 'system' && (
            <div className="animation-fade-in">
              <h2 style={{ fontSize: 18, marginBottom: 20 }}>System / Business Settings</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, maxWidth: 600 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Currency</label>
                  <GlassSelect style={{ width: '100%' }} defaultValue="USD" options={[
                    { value: 'USD', label: 'USD ($)' },
                    { value: 'MYR', label: 'MYR (RM)' },
                    { value: 'EUR', label: 'EUR (€)' },
                    { value: 'GBP', label: 'GBP (£)' }
                  ]} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Time Zone</label>
                  <GlassSelect style={{ width: '100%' }} defaultValue="MY" options={[
                    { value: 'US', label: 'Eastern Time (US)' },
                    { value: 'MY', label: 'Malaysia Time (MYT)' },
                    { value: 'UK', label: 'Greenwich Mean Time (GMT)' }
                  ]} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Business Type</label>
                  <GlassSelect style={{ width: '100%' }} defaultValue="Retail" options={[
                    { value: 'Retail', label: 'Retail' },
                    { value: 'Wholesale', label: 'Wholesale' },
                    { value: 'Manufacturing', label: 'Manufacturing' },
                    { value: 'SaaS', label: 'SaaS / Services' }
                  ]} />
                </div>
              </div>
            </div>
          )}

          {/* INVENTORY MANAGEMENT */}
          {activeTab === 'inventory' && (
            <div className="animation-fade-in">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Package color="#6C63FF" size={20} />
                  <h2 style={{ fontSize: 18 }}>Inventory Management</h2>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => { setInvProducts([]); setTimeout(loadInvProducts, 50) }} title="Refresh">
                  <RefreshCw size={14} /> Refresh
                </button>
              </div>

              {/* Sub-tab nav */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 24, background: 'rgba(255,255,255,0.04)', padding: 4, borderRadius: 'var(--r-md)', border: '1px solid var(--clr-border)', width: 'fit-content' }}>
                {([
                  { id: 'sale',     label: 'Record Sale',     icon: ShoppingCart },
                  { id: 'generate', label: 'Generate Data',   icon: Shuffle },
                  { id: 'stock',    label: 'Manage Stock',    icon: Edit3 },
                ] as const).map(t => (
                  <button key={t.id} onClick={() => setInvSubTab(t.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7, padding: '7px 14px',
                      borderRadius: 'calc(var(--r-md) - 2px)', fontSize: 13, fontWeight: 600,
                      border: 'none', cursor: 'pointer', transition: 'all 0.2s',
                      background: invSubTab === t.id ? 'linear-gradient(135deg,#6C63FF,#846cff)' : 'transparent',
                      color: invSubTab === t.id ? '#fff' : 'var(--clr-text-muted)',
                    }}
                    onMouseEnter={e => { if (invSubTab !== t.id) (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 1px rgba(108,99,255,0.4), 0 0 12px rgba(108,99,255,0.3)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '' }}
                  >
                    <t.icon size={14} /> {t.label}
                  </button>
                ))}
              </div>

              {/* ── RECORD SALE ── */}
              {invSubTab === 'sale' && (
                <div style={{ maxWidth: 560 }}>
                  <p style={{ fontSize: 13, color: 'var(--clr-text-muted)', marginBottom: 20 }}>
                    Log a real or simulated sale. This inserts a row into <code style={{ background: 'rgba(108,99,255,0.15)', padding: '1px 6px', borderRadius: 4, fontSize: 12 }}>sales_transactions</code> and decrements live inventory stock.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Product</label>
                      <div style={{ position: 'relative' }}>
                        <select className="glass-input glass-select"
                          value={saleProductId}
                          onChange={e => setSaleProductId(Number(e.target.value))}
                          style={{ width: '100%', paddingRight: 32 }}
                        >
                          <option value="">— Select a product —</option>
                          {invProducts.map(p => (
                            <option key={p.id} value={p.id}>
                              [{p.family}] {p.name} — Stock: {p.current_stock}
                            </option>
                          ))}
                        </select>
                        <ChevronDown size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--clr-text-muted)' }} />
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Quantity Sold</label>
                        <input type="number" className="glass-input" min={1} value={saleQty}
                          onChange={e => setSaleQty(Math.max(1, parseInt(e.target.value) || 1))} style={{ width: '100%' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Sale Date</label>
                        <input type="date" className="glass-input" value={saleDate}
                          onChange={e => setSaleDate(e.target.value)} style={{ width: '100%' }} />
                      </div>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer' }}>
                      <input type="checkbox" checked={salePromo} onChange={e => setSalePromo(e.target.checked)} />
                      On Promotion / Discount
                    </label>

                    {/* Selected product info */}
                    {saleProductId !== '' && (() => {
                      const p = invProducts.find(x => x.id === saleProductId)
                      if (!p) return null
                      const afterStock = Math.max(0, p.current_stock - saleQty)
                      const isLow = afterStock <= p.reorder_level
                      return (
                        <div style={{ padding: 14, borderRadius: 'var(--r-md)', background: isLow ? 'rgba(244,63,94,0.06)' : 'rgba(34,211,168,0.05)', border: `1px solid ${isLow ? 'rgba(244,63,94,0.3)' : 'rgba(34,211,168,0.2)'}` }}>
                          <p style={{ fontSize: 12, color: isLow ? '#f43f5e' : '#22d3a8', marginBottom: 4, fontWeight: 600 }}>
                            {isLow ? '⚠ Below reorder level after this sale' : '✓ Stock sufficient'}
                          </p>
                          <p style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>
                            Current: <strong style={{ color: '#fff' }}>{p.current_stock}</strong> → After sale: <strong style={{ color: isLow ? '#f43f5e' : '#22d3a8' }}>{afterStock}</strong> &nbsp;|&nbsp; Reorder at: {p.reorder_level}
                          </p>
                        </div>
                      )
                    })()}

                    {saleMsg && (
                      <div style={{ padding: 12, borderRadius: 'var(--r-md)', background: saleMsg.type === 'success' ? 'rgba(34,211,168,0.08)' : 'rgba(244,63,94,0.08)', border: `1px solid ${saleMsg.type === 'success' ? 'rgba(34,211,168,0.3)' : 'rgba(244,63,94,0.3)'}`, fontSize: 13, color: saleMsg.type === 'success' ? '#22d3a8' : '#f43f5e' }}>
                        {saleMsg.text}
                      </div>
                    )}

                    <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }}
                      onClick={recordSale} disabled={!saleProductId || saleLoading}>
                      <ShoppingCart size={15} /> {saleLoading ? 'Recording…' : 'Record Sale'}
                    </button>
                  </div>
                </div>
              )}

              {/* ── GENERATE SYNTHETIC DATA ── */}
              {invSubTab === 'generate' && (
                <div style={{ maxWidth: 560 }}>
                  <div style={{ padding: 14, borderRadius: 'var(--r-md)', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.25)', marginBottom: 20 }}>
                    <p style={{ fontSize: 12, color: '#f59e0b', lineHeight: 1.6 }}>
                      <strong>Synthetic Data Generator</strong> — Creates realistic daily sales records across a date range. Use this to populate historical data so the AI pipeline (XGBoost → LLM → PPO) has enough training signal to run.
                    </p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Product (or All Products)</label>
                      <div style={{ position: 'relative' }}>
                        <select className="glass-input glass-select" value={genProductId}
                          onChange={e => setGenProductId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                          style={{ width: '100%', paddingRight: 32 }}>
                          <option value="all">All Products ({invProducts.length})</option>
                          {invProducts.map(p => <option key={p.id} value={p.id}>[{p.family}] {p.name}</option>)}
                        </select>
                        <ChevronDown size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--clr-text-muted)' }} />
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Start Date</label>
                        <input type="date" className="glass-input" value={genStartDate} onChange={e => setGenStartDate(e.target.value)} style={{ width: '100%' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>End Date</label>
                        <input type="date" className="glass-input" value={genEndDate} onChange={e => setGenEndDate(e.target.value)} style={{ width: '100%' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Min Units / Day</label>
                        <input type="number" className="glass-input" min={1} value={genMinQty} onChange={e => setGenMinQty(Math.max(1, parseInt(e.target.value) || 1))} style={{ width: '100%' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Max Units / Day</label>
                        <input type="number" className="glass-input" min={1} value={genMaxQty} onChange={e => setGenMaxQty(Math.max(genMinQty, parseInt(e.target.value) || genMinQty))} style={{ width: '100%' }} />
                      </div>
                    </div>

                    {/* Estimate */}
                    {(() => {
                      const days = Math.max(0, Math.ceil((new Date(genEndDate).getTime() - new Date(genStartDate).getTime()) / 86400000) + 1)
                      const prods = genProductId === 'all' ? invProducts.length : 1
                      const total = days * prods
                      return (
                        <div style={{ padding: 12, borderRadius: 'var(--r-md)', background: 'rgba(108,99,255,0.07)', border: '1px solid rgba(108,99,255,0.2)', fontSize: 12, color: 'var(--clr-text-muted)' }}>
                          Estimated rows: <strong style={{ color: '#a89dff' }}>{total.toLocaleString()}</strong> &nbsp;({days} days × {prods} product{prods !== 1 ? 's' : ''})
                        </div>
                      )
                    })()}

                    {genMsg && (
                      <div style={{ padding: 12, borderRadius: 'var(--r-md)', background: genMsg.type === 'success' ? 'rgba(34,211,168,0.08)' : 'rgba(244,63,94,0.08)', border: `1px solid ${genMsg.type === 'success' ? 'rgba(34,211,168,0.3)' : 'rgba(244,63,94,0.3)'}`, fontSize: 13, color: genMsg.type === 'success' ? '#22d3a8' : '#f43f5e' }}>
                        {genMsg.type === 'success' ? '✓ ' : '✗ '}{genMsg.text}
                      </div>
                    )}

                    <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }}
                      onClick={generateSyntheticData} disabled={genLoading}>
                      <Shuffle size={15} /> {genLoading ? 'Generating…' : 'Generate Sales Data'}
                    </button>
                  </div>
                </div>
              )}

              {/* ── MANAGE STOCK ── */}
              {invSubTab === 'stock' && (
                <div>
                  <p style={{ fontSize: 13, color: 'var(--clr-text-muted)', marginBottom: 16 }}>
                    Directly edit current stock or reorder level for any product. Changes are saved to Supabase immediately.
                  </p>
                  {invLoading ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {[...Array(6)].map((_, i) => <div key={i} className="shimmer" style={{ height: 44, borderRadius: 8 }} />)}
                    </div>
                  ) : (
                    <div style={{ maxHeight: 480, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {invProducts.map(p => {
                        const edit = stockEdits[p.id]
                        const stock = edit?.stock ?? p.current_stock
                        const reorder = edit?.reorder ?? p.reorder_level
                        const isDirty = !!edit
                        const isLow = stock <= p.reorder_level
                        return (
                          <div key={p.id} style={{
                            display: 'grid', gridTemplateColumns: '1fr 120px 120px 80px',
                            alignItems: 'center', gap: 10, padding: '10px 14px',
                            borderRadius: 'var(--r-md)', background: 'rgba(255,255,255,0.03)',
                            border: `1px solid ${isDirty ? 'rgba(108,99,255,0.4)' : isLow ? 'rgba(244,63,94,0.2)' : 'rgba(255,255,255,0.06)'}`,
                            transition: 'border-color 0.2s'
                          }}>
                            <div>
                              <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{p.name}</p>
                              <p style={{ fontSize: 11, color: 'var(--clr-text-muted)' }}>{p.family}</p>
                            </div>
                            <div>
                              <label style={{ fontSize: 10, color: 'var(--clr-text-muted)', display: 'block', marginBottom: 3 }}>STOCK</label>
                              <input type="number" min={0} value={stock}
                                onChange={e => setStockEdits(prev => ({ ...prev, [p.id]: { stock: Math.max(0, parseInt(e.target.value) || 0), reorder: prev[p.id]?.reorder ?? p.reorder_level } }))}
                                style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: `1px solid ${isLow && !isDirty ? 'rgba(244,63,94,0.4)' : 'rgba(255,255,255,0.12)'}`, borderRadius: 6, padding: '5px 8px', color: isLow ? '#f43f5e' : '#fff', fontSize: 13, fontWeight: 600, outline: 'none' }} />
                            </div>
                            <div>
                              <label style={{ fontSize: 10, color: 'var(--clr-text-muted)', display: 'block', marginBottom: 3 }}>REORDER AT</label>
                              <input type="number" min={0} value={reorder}
                                onChange={e => setStockEdits(prev => ({ ...prev, [p.id]: { stock: prev[p.id]?.stock ?? p.current_stock, reorder: Math.max(0, parseInt(e.target.value) || 0) } }))}
                                style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '5px 8px', color: '#fff', fontSize: 13, outline: 'none' }} />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                              {stockSaved === p.id ? (
                                <span style={{ color: '#22d3a8', fontSize: 12, fontWeight: 600 }}><Check size={14} style={{ verticalAlign: 'middle' }} /> Saved</span>
                              ) : isDirty ? (
                                <button className="btn btn-primary btn-sm" disabled={stockSaving === p.id}
                                  onClick={() => saveStockEdit(p.id)}>
                                  {stockSaving === p.id ? '…' : <><Check size={13} /> Save</>}
                                </button>
                              ) : isLow ? (
                                <span style={{ fontSize: 11, color: '#f43f5e', display: 'flex', alignItems: 'center', gap: 4 }}><AlertTriangle size={12} /> Low</span>
                              ) : null}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* AI SETTINGS */}
          {activeTab === 'ai' && (
            <div className="animation-fade-in">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                <Zap color="#00D4FF" />
                <h2 style={{ fontSize: 18 }}>AI Control Core</h2>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 600 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', background: 'rgba(0,212,255,0.05)', borderRadius: 'var(--r-md)', border: '1px solid rgba(0,212,255,0.1)' }}>
                  <div>
                    <h3 style={{ fontSize: 14, fontWeight: 600, color: '#00D4FF', marginBottom: 4 }}>Enable AI Predictions</h3>
                    <p style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>Use machine learning to forecast demand continuously.</p>
                  </div>
                  <Toggle checked={aiEnabled} onChange={() => setAiEnabled(!aiEnabled)} />
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, opacity: aiEnabled ? 1 : 0.5, pointerEvents: aiEnabled ? 'auto' : 'none' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Model Type</label>
                    <GlassSelect style={{ width: '100%' }} defaultValue="Regression" options={[
                      { value: 'Regression', label: 'Linear Regression' },
                      { value: 'ARIMA', label: 'Time Series (ARIMA)' },
                      { value: 'LSTM', label: 'Neural Net (LSTM)' }
                    ]} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Prediction Interval</label>
                    <GlassSelect style={{ width: '100%' }} defaultValue="Weekly" options={[
                      { value: 'Daily', label: 'Daily' },
                      { value: 'Weekly', label: 'Weekly' },
                      { value: 'Monthly', label: 'Monthly' }
                    ]} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Confidence Threshold (%)</label>
                    <input type="number" className="glass-input" defaultValue={85} min={50} max={99} style={{ width: '100%' }} />
                    <p style={{ fontSize: 11, color: 'var(--clr-text-muted)', marginTop: 6 }}>Alerts trigger only if AI confidence exceeds this.</p>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', marginTop: 10, background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--r-md)', border: '1px solid rgba(255,255,255,0.05)', opacity: aiEnabled ? 1 : 0.5, pointerEvents: aiEnabled ? 'auto' : 'none' }}>
                  <div>
                    <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Auto Suggestion UI Prompts</h3>
                    <p style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>AI directly suggests actions within the alert detail panel.</p>
                  </div>
                  <Toggle checked={autoRecom} onChange={() => setAutoRecom(!autoRecom)} />
                </div>
              </div>
            </div>
          )}

          {/* PAYMENTS */}
          {activeTab === 'payments' && (
            <div className="animation-fade-in">
              <h2 style={{ fontSize: 18, marginBottom: 20 }}>Payment Settings</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 600 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Enabled Payment Methods</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer', marginBottom: 10 }}>
                    <input type="checkbox" defaultChecked /> Credit Card (Stripe)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer', marginBottom: 10 }}>
                    <input type="checkbox" defaultChecked /> Online Banking / ACH
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer' }}>
                    <input type="checkbox" /> PayPal Gateway
                  </label>
                </div>
                <div style={{ height: 1, background: 'rgba(255,255,255,0.1)' }} />
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>API Key (Stripe simulated)</label>
                  <input type="password" className="glass-input" defaultValue="sk_test_51MockKey..." style={{ width: '100%', fontFamily: 'monospace' }} />
                </div>
              </div>
            </div>
          )}

          {/* LOGISTICS */}
          {activeTab === 'logistics' && (
            <div className="animation-fade-in">
              <h2 style={{ fontSize: 18, marginBottom: 20 }}>Logistics Settings</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 600 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Default Shipping Logistics Provider</label>
                  <GlassSelect style={{ width: '100%' }} defaultValue="DHL" options={[
                    { value: 'DHL', label: 'DHL Express' },
                    { value: 'FedEx', label: 'FedEx Freight' },
                    { value: 'UPS', label: 'UPS Ground' },
                    { value: 'ANA', label: 'ANA Cargo' }
                  ]} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--r-md)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div>
                    <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>AI Auto Shipping Optimization</h3>
                    <p style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>Automatically select the cheapest/fastest option per order.</p>
                  </div>
                  <Toggle checked={autoShipping} onChange={() => setAutoShipping(!autoShipping)} />
                </div>
              </div>
            </div>
          )}

          {/* NOTIFICATIONS */}
          {activeTab === 'notifications' && (
            <div className="animation-fade-in">
              <h2 style={{ fontSize: 18, marginBottom: 20 }}>Notification Settings</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 600 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Internal System Alerts</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer', marginBottom: 10 }}>
                    <input type="checkbox" defaultChecked /> Low Stock & Inventory Outages
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer', marginBottom: 10 }}>
                    <input type="checkbox" defaultChecked /> Payment Failures
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer', marginBottom: 10 }}>
                    <input type="checkbox" defaultChecked /> Logistics Delays
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer' }}>
                    <input type="checkbox" defaultChecked /> AI Behavior Insights
                  </label>
                </div>
                <div style={{ height: 1, background: 'rgba(255,255,255,0.1)' }} />
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>External Forwarding</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer', marginBottom: 10 }}>
                    <input type="checkbox" defaultChecked /> Forward Critical Alerts to Email
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer' }}>
                    <input type="checkbox" /> Push Notifications to SMS
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* SECURITY */}
          {activeTab === 'security' && (
            <div className="animation-fade-in">
              <h2 style={{ fontSize: 18, marginBottom: 20 }}>Security Settings</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 600 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Current Password</label>
                    <input type="password" className="glass-input" defaultValue="*********" style={{ width: '100%' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>New Password</label>
                    <input type="password" className="glass-input" defaultValue="" placeholder="Enter new password" style={{ width: '100%' }} />
                  </div>
                  <button className="btn btn-ghost" style={{ alignSelf: 'flex-start' }}>Update Password</button>
                </div>
                <div style={{ height: 1, background: 'rgba(255,255,255,0.1)' }} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', background: 'rgba(108,99,255,0.05)', borderRadius: 'var(--r-md)', border: '1px solid rgba(108,99,255,0.2)' }}>
                  <div>
                    <h3 style={{ fontSize: 14, fontWeight: 600, color: '#a89dff', marginBottom: 4 }}>Two-Factor Authentication</h3>
                    <p style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>Secure your admin account with an authenticator app.</p>
                  </div>
                  <button className="btn btn-primary btn-sm">Enable 2FA</button>
                </div>
              </div>
            </div>
          )}

          {/* Global Save Button at bottom */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', marginTop: 40, paddingTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
             <button className="btn btn-primary"><Save size={16} /> Save Global Changes</button>
          </div>

        </div>
      </div>
    </div>
  )
}
