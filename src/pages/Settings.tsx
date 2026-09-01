import { useState, useEffect } from 'react'
import {
  User, Monitor, Package, Zap, CreditCard, Truck, Bell, Shield,
  UploadCloud, Save, Calendar, DollarSign,
  ShoppingCart, Shuffle, Edit3, Check, RefreshCw, AlertTriangle, ChevronDown
} from 'lucide-react'
import GlassSelect from '../components/GlassSelect'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'

const TABS = [
  { id: 'profile',       label: 'Profile',           icon: User },
  { id: 'system',        label: 'System',             icon: Monitor },
  { id: 'salary',        label: 'Salary / Auto-Pay',  icon: DollarSign },
  { id: 'inventory',     label: 'Inventory',          icon: Package },
  { id: 'ai',            label: 'AI Settings',        icon: Zap },
  { id: 'payments',      label: 'Payments',           icon: CreditCard },
  { id: 'logistics',     label: 'Logistics',          icon: Truck },
  { id: 'notifications', label: 'Notifications',      icon: Bell },
  { id: 'security',      label: 'Security',           icon: Shield },
]

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <div onClick={onChange} style={{ width: 40, height: 22, borderRadius: 11, background: checked ? '#22d3a8' : 'rgba(255,255,255,0.1)', position: 'relative', cursor: 'pointer', transition: 'background 0.2s' }}>
      <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: checked ? 21 : 3, transition: 'left 0.2s' }} />
    </div>
  )
}

function SaveBar({ saving, saved, onSave, label = 'Save Settings' }: { saving: boolean; saved: boolean; onSave: () => void; label?: string }) {
  return (
    <button className="btn btn-primary" onClick={onSave} disabled={saving} style={{ alignSelf: 'flex-start', marginTop: 8 }}>
      <Save size={15} /> {saving ? 'Saving…' : saved ? '✓ Saved!' : label}
    </button>
  )
}

export default function Settings() {
  const { profile } = useAuth()
  const ownerId = profile?.owner_id ?? null
  const [activeTab, setActiveTab] = useState('profile')

  // ── Profile ──────────────────────────────────────────────────────────────────
  const [profileName,    setProfileName]    = useState('Hasidul Islam')
  const [profileEmail,   setProfileEmail]   = useState('admin@stockmind.ai')
  const [profileCompany, setProfileCompany] = useState('Antigravity Inc.')

  // ── System ───────────────────────────────────────────────────────────────────
  const [systemCurrency, setSystemCurrency] = useState('USD')
  const [systemTimezone, setSystemTimezone] = useState('MY')
  const [systemBusiness, setSystemBusiness] = useState('Retail')

  // ── AI ───────────────────────────────────────────────────────────────────────
  const [aiEnabled,    setAiEnabled]    = useState(true)
  const [autoRecom,    setAutoRecom]    = useState(true)
  const [aiModelType,  setAiModelType]  = useState('Regression')
  const [aiInterval,   setAiInterval]   = useState('Weekly')
  const [aiConfidence, setAiConfidence] = useState(85)

  // ── Autonomous Agents (restock + payroll) ───────────────────────────────────
  const [restockAgentEnabled, setRestockAgentEnabled] = useState(false)
  const [payrollAgentEnabled, setPayrollAgentEnabled] = useState(false)
  const [agentToggleBusy, setAgentToggleBusy] = useState<'restock' | 'payroll' | null>(null)
  const [agentRuns, setAgentRuns] = useState<any[]>([])

  // ── Payments ─────────────────────────────────────────────────────────────────
  const [paymentStripe,  setPaymentStripe]  = useState(true)
  const [paymentACH,     setPaymentACH]     = useState(true)
  const [paymentPaypal,  setPaymentPaypal]  = useState(false)
  const [paymentApiKey,  setPaymentApiKey]  = useState('sk_test_51MockKey...')

  // ── Logistics ────────────────────────────────────────────────────────────────
  const [logisticsProvider, setLogisticsProvider] = useState('DHL')
  const [autoShipping,      setAutoShipping]      = useState(false)

  // ── Notifications ────────────────────────────────────────────────────────────
  const [notifLowStock,  setNotifLowStock]  = useState(true)
  const [notifPayments,  setNotifPayments]  = useState(true)
  const [notifLogistics, setNotifLogistics] = useState(true)
  const [notifAI,        setNotifAI]        = useState(true)
  const [notifEmail,     setNotifEmail]     = useState(true)
  const [notifSMS,       setNotifSMS]       = useState(false)

  // ── Salary / Auto-Pay ────────────────────────────────────────────────────────
  const [autoPayEnabled,         setAutoPayEnabled]         = useState(false)
  const [autoPayDay,             setAutoPayDay]             = useState(1)
  const [salarySettingsLoading,  setSalarySettingsLoading]  = useState(true)
  const [salarySettingsSaved,    setSalarySettingsSaved]    = useState(false)

  // ── Inventory sub-tab ────────────────────────────────────────────────────────
  const [invSubTab,    setInvSubTab]    = useState<'sale' | 'stock'>('sale')
  const [invProducts,  setInvProducts]  = useState<any[]>([])
  const [invLoading,   setInvLoading]   = useState(false)

  // Record Sale
  const [saleProductId, setSaleProductId] = useState<number | ''>('')
  const [saleQty,       setSaleQty]       = useState(1)
  const [saleDate,      setSaleDate]      = useState(new Date().toISOString().split('T')[0])
  const [salePromo,     setSalePromo]     = useState(false)
  const [saleLoading,   setSaleLoading]   = useState(false)
  const [saleMsg,       setSaleMsg]       = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Stock Adjustment
  const [stockEdits,   setStockEdits]   = useState<Record<number, { stock: number; reorder: number }>>({})
  const [stockSaving,  setStockSaving]  = useState<number | null>(null)
  const [stockSaved,   setStockSaved]   = useState<number | null>(null)

  // ── Per-tab save state ───────────────────────────────────────────────────────
  const [profileSaving,  setProfileSaving]  = useState(false)
  const [profileSaved,   setProfileSaved]   = useState(false)
  const [systemSaving,   setSystemSaving]   = useState(false)
  const [systemSaved,    setSystemSaved]    = useState(false)
  const [aiSaving,       setAiSaving]       = useState(false)
  const [aiSaved,        setAiSaved]        = useState(false)
  const [paymentSaving,  setPaymentSaving]  = useState(false)
  const [paymentSaved,   setPaymentSaved]   = useState(false)
  const [logisticsSaving, setLogisticsSaving] = useState(false)
  const [logisticsSaved,  setLogisticsSaved]  = useState(false)
  const [notifSaving,    setNotifSaving]    = useState(false)
  const [notifSaved,     setNotifSaved]     = useState(false)
  const [globalSaving,   setGlobalSaving]   = useState(false)
  const [globalSaved,    setGlobalSaved]    = useState(false)

  // ── Load all settings from Supabase on mount ─────────────────────────────────
  useEffect(() => {
    const loadSettings = async () => {
      setSalarySettingsLoading(true)
      const { data } = await supabase.from('app_settings').select('*')
      if (data) {
        const get = (key: string, fallback: string) =>
          (data as any[]).find(s => s.setting_key === key)?.setting_value ?? fallback

        setAutoPayEnabled(get('auto_pay_enabled', 'false') === 'true')
        setAutoPayDay(parseInt(get('auto_pay_day', '1')) || 1)

        setProfileName(get('profile_name', 'Hasidul Islam'))
        setProfileEmail(get('profile_email', 'admin@stockmind.ai'))
        setProfileCompany(get('profile_company', 'Antigravity Inc.'))

        setSystemCurrency(get('system_currency', 'USD'))
        setSystemTimezone(get('system_timezone', 'MY'))
        setSystemBusiness(get('system_business', 'Retail'))

        setAiEnabled(get('ai_enabled', 'true') === 'true')
        setAiModelType(get('ai_model_type', 'Regression'))
        setAiInterval(get('ai_interval', 'Weekly'))
        setAiConfidence(parseInt(get('ai_confidence', '85')) || 85)
        setAutoRecom(get('ai_auto_suggestions', 'true') === 'true')

        setRestockAgentEnabled(get('agent_restock_enabled', 'false') === 'true')
        setPayrollAgentEnabled(get('agent_payroll_enabled', 'false') === 'true')

        setPaymentStripe(get('payment_stripe', 'true') === 'true')
        setPaymentACH(get('payment_ach', 'true') === 'true')
        setPaymentPaypal(get('payment_paypal', 'false') === 'true')

        setLogisticsProvider(get('logistics_provider', 'DHL'))
        setAutoShipping(get('logistics_auto_shipping', 'false') === 'true')

        setNotifLowStock(get('notif_low_stock', 'true') === 'true')
        setNotifPayments(get('notif_payments', 'true') === 'true')
        setNotifLogistics(get('notif_logistics', 'true') === 'true')
        setNotifAI(get('notif_ai', 'true') === 'true')
        setNotifEmail(get('notif_email', 'true') === 'true')
        setNotifSMS(get('notif_sms', 'false') === 'true')
      }
      setSalarySettingsLoading(false)
    }
    loadSettings()
    fetchAgentRuns()
  }, [])

  useEffect(() => {
    if (activeTab === 'inventory' && invProducts.length === 0) loadInvProducts()
  }, [activeTab])

  // ── Helpers ──────────────────────────────────────────────────────────────────
  async function upsertSettings(pairs: [string, string][], setSaving: (v: boolean) => void, setSaved: (v: boolean) => void) {
    setSaving(true)
    await supabase.from('app_settings').upsert(
      pairs.map(([key, val]) => ({ setting_key: key, setting_value: val, updated_at: new Date().toISOString() })),
      { onConflict: 'setting_key' }
    )
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  // Agent toggles persist immediately — these gate live Edge Functions, so
  // there's no separate "Save" step like the rest of this page.
  async function toggleAgent(kind: 'restock' | 'payroll', next: boolean) {
    setAgentToggleBusy(kind)
    const key = kind === 'restock' ? 'agent_restock_enabled' : 'agent_payroll_enabled'
    const { error } = await supabase.from('app_settings').upsert(
      { setting_key: key, setting_value: next ? 'true' : 'false', updated_at: new Date().toISOString() },
      { onConflict: 'setting_key' }
    )
    if (!error) {
      if (kind === 'restock') setRestockAgentEnabled(next)
      else setPayrollAgentEnabled(next)
    }
    setAgentToggleBusy(null)
  }

  async function fetchAgentRuns() {
    const { data } = await supabase.from('agent_runs').select('*').order('created_at', { ascending: false }).limit(10)
    setAgentRuns(data || [])
  }

  const saveProfile  = () => upsertSettings([
    ['profile_name', profileName], ['profile_email', profileEmail], ['profile_company', profileCompany]
  ], setProfileSaving, setProfileSaved)

  const saveSystem   = () => upsertSettings([
    ['system_currency', systemCurrency], ['system_timezone', systemTimezone], ['system_business', systemBusiness]
  ], setSystemSaving, setSystemSaved)

  const saveAI       = () => upsertSettings([
    ['ai_enabled', aiEnabled.toString()], ['ai_model_type', aiModelType],
    ['ai_interval', aiInterval], ['ai_confidence', aiConfidence.toString()],
    ['ai_auto_suggestions', autoRecom.toString()]
  ], setAiSaving, setAiSaved)

  const savePayments = () => upsertSettings([
    ['payment_stripe', paymentStripe.toString()], ['payment_ach', paymentACH.toString()],
    ['payment_paypal', paymentPaypal.toString()]
  ], setPaymentSaving, setPaymentSaved)

  const saveLogistics = () => upsertSettings([
    ['logistics_provider', logisticsProvider], ['logistics_auto_shipping', autoShipping.toString()]
  ], setLogisticsSaving, setLogisticsSaved)

  const saveNotifications = () => upsertSettings([
    ['notif_low_stock', notifLowStock.toString()], ['notif_payments', notifPayments.toString()],
    ['notif_logistics', notifLogistics.toString()], ['notif_ai', notifAI.toString()],
    ['notif_email', notifEmail.toString()], ['notif_sms', notifSMS.toString()]
  ], setNotifSaving, setNotifSaved)

  const saveSalarySettings = () => upsertSettings([
    ['auto_pay_enabled', autoPayEnabled.toString()], ['auto_pay_day', autoPayDay.toString()]
  ], setSalarySettingsLoading, setSalarySettingsSaved)

  const saveAllSettings = async () => {
    setGlobalSaving(true)
    await supabase.from('app_settings').upsert([
      { setting_key: 'profile_name',           setting_value: profileName,             updated_at: new Date().toISOString() },
      { setting_key: 'profile_email',           setting_value: profileEmail,            updated_at: new Date().toISOString() },
      { setting_key: 'profile_company',         setting_value: profileCompany,          updated_at: new Date().toISOString() },
      { setting_key: 'system_currency',         setting_value: systemCurrency,          updated_at: new Date().toISOString() },
      { setting_key: 'system_timezone',         setting_value: systemTimezone,          updated_at: new Date().toISOString() },
      { setting_key: 'system_business',         setting_value: systemBusiness,          updated_at: new Date().toISOString() },
      { setting_key: 'ai_enabled',              setting_value: aiEnabled.toString(),    updated_at: new Date().toISOString() },
      { setting_key: 'ai_model_type',           setting_value: aiModelType,             updated_at: new Date().toISOString() },
      { setting_key: 'ai_interval',             setting_value: aiInterval,              updated_at: new Date().toISOString() },
      { setting_key: 'ai_confidence',           setting_value: aiConfidence.toString(), updated_at: new Date().toISOString() },
      { setting_key: 'ai_auto_suggestions',     setting_value: autoRecom.toString(),    updated_at: new Date().toISOString() },
      { setting_key: 'payment_stripe',          setting_value: paymentStripe.toString(),  updated_at: new Date().toISOString() },
      { setting_key: 'payment_ach',             setting_value: paymentACH.toString(),     updated_at: new Date().toISOString() },
      { setting_key: 'payment_paypal',          setting_value: paymentPaypal.toString(),  updated_at: new Date().toISOString() },
      { setting_key: 'logistics_provider',      setting_value: logisticsProvider,         updated_at: new Date().toISOString() },
      { setting_key: 'logistics_auto_shipping', setting_value: autoShipping.toString(),   updated_at: new Date().toISOString() },
      { setting_key: 'notif_low_stock',         setting_value: notifLowStock.toString(),  updated_at: new Date().toISOString() },
      { setting_key: 'notif_payments',          setting_value: notifPayments.toString(),  updated_at: new Date().toISOString() },
      { setting_key: 'notif_logistics',         setting_value: notifLogistics.toString(), updated_at: new Date().toISOString() },
      { setting_key: 'notif_ai',                setting_value: notifAI.toString(),         updated_at: new Date().toISOString() },
      { setting_key: 'notif_email',             setting_value: notifEmail.toString(),      updated_at: new Date().toISOString() },
      { setting_key: 'notif_sms',               setting_value: notifSMS.toString(),        updated_at: new Date().toISOString() },
      { setting_key: 'auto_pay_enabled',        setting_value: autoPayEnabled.toString(),  updated_at: new Date().toISOString() },
      { setting_key: 'auto_pay_day',            setting_value: autoPayDay.toString(),      updated_at: new Date().toISOString() },
    ], { onConflict: 'setting_key' })
    setGlobalSaving(false)
    setGlobalSaved(true)
    setTimeout(() => setGlobalSaved(false), 2500)
  }

  // ── Inventory helpers (unchanged) ─────────────────────────────────────────────
  const loadInvProducts = async () => {
    setInvLoading(true)
    const { data } = await supabase
      .from('products')
      .select('id, name, family, unit_price, inventory(id, current_stock, reorder_level)')
      .order('family')
    if (data) {
      setInvProducts(data.map((p: any) => ({
        ...p,
        current_stock:  Array.isArray(p.inventory) ? p.inventory[0]?.current_stock  ?? 0 : p.inventory?.current_stock  ?? 0,
        reorder_level:  Array.isArray(p.inventory) ? p.inventory[0]?.reorder_level  ?? 0 : p.inventory?.reorder_level  ?? 0,
        inventory_id:   Array.isArray(p.inventory) ? p.inventory[0]?.id              : p.inventory?.id,
      })))
    }
    setInvLoading(false)
  }

  const recordSale = async () => {
    if (!saleProductId || saleQty < 1) return
    setSaleLoading(true); setSaleMsg(null)
    try {
      // owner_id satisfies the tenancy RLS policy on sales_transactions.
      const { error } = await supabase.from('sales_transactions').insert({
        product_id: saleProductId, sale_date: saleDate, quantity_sold: saleQty,
        on_promotion: salePromo, owner_id: ownerId,
      })
      if (error) throw error
      const product = invProducts.find(p => p.id === saleProductId)

      // Stock is NOT adjusted here. The trg_sale_decrement_inventory trigger on
      // sales_transactions already does it, atomically, as part of the insert
      // above. Writing it from the client too would either double-decrement or
      // — worse — overwrite a concurrent sale, because the value would be
      // computed from this browser's cached copy of current_stock.
      // Read the authoritative number back instead of guessing at it.
      if (product?.inventory_id) {
        const { data: fresh } = await supabase
          .from('inventory')
          .select('current_stock')
          .eq('id', product.inventory_id)
          .maybeSingle()

        if (fresh) {
          setInvProducts(prev => prev.map(p => p.id === saleProductId
            ? { ...p, current_stock: fresh.current_stock } : p))
        }
      }
      setSaleMsg({ type: 'success', text: `Recorded: ${saleQty} × ${product?.name} sold on ${saleDate}` })
      setSaleQty(1); setSaleProductId('')
    } catch (e: any) { setSaleMsg({ type: 'error', text: e.message }) }
    setSaleLoading(false)
  }

  const saveStockEdit = async (productId: number) => {
    const edit = stockEdits[productId]; if (!edit) return
    setStockSaving(productId)
    const product = invProducts.find(p => p.id === productId)
    if (product?.inventory_id) {
      await supabase.from('inventory').update({
        current_stock: edit.stock, reorder_level: edit.reorder, last_updated: new Date().toISOString()
      }).eq('id', product.inventory_id)
      setInvProducts(prev => prev.map(p => p.id === productId ? { ...p, current_stock: edit.stock, reorder_level: edit.reorder } : p))
    }
    setStockSaving(null); setStockSaved(productId)
    setTimeout(() => setStockSaved(null), 2000)
    setStockEdits(prev => { const n = { ...prev }; delete n[productId]; return n })
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────────────────────────────────────
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
                <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 'var(--r-md)', background: isActive ? 'rgba(108,99,255,0.15)' : 'transparent', color: isActive ? '#6C63FF' : 'var(--clr-text-muted)', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: isActive ? 600 : 500, textAlign: 'left', transition: 'all 0.2s' }}>
                  <tab.icon size={16} />
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Main Content Pane */}
        <div className="glass-card" style={{ flex: 1, minHeight: 450, padding: 32 }}>

          {/* ── PROFILE ── */}
          {activeTab === 'profile' && (
            <div className="animation-fade-in">
              <h2 style={{ fontSize: 18, marginBottom: 20 }}>Profile Settings</h2>
              <div style={{ display: 'flex', gap: 32 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 90, height: 90, borderRadius: '50%', background: 'linear-gradient(135deg, #6C63FF, #00D4FF)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 700 }}>H</div>
                  <button className="btn btn-ghost btn-sm" style={{ fontSize: 12 }}><UploadCloud size={14} /> Upload Image</button>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Full Name</label>
                      <input className="glass-input" value={profileName} onChange={e => setProfileName(e.target.value)} style={{ width: '100%' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Email</label>
                      <input className="glass-input" value={profileEmail} onChange={e => setProfileEmail(e.target.value)} style={{ width: '100%' }} />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Company Name</label>
                      <input className="glass-input" value={profileCompany} onChange={e => setProfileCompany(e.target.value)} style={{ width: '100%' }} />
                    </div>
                  </div>
                  <SaveBar saving={profileSaving} saved={profileSaved} onSave={saveProfile} label="Save Profile" />
                </div>
              </div>
            </div>
          )}

          {/* ── SYSTEM ── */}
          {activeTab === 'system' && (
            <div className="animation-fade-in">
              <h2 style={{ fontSize: 18, marginBottom: 20 }}>System / Business Settings</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 600 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Currency</label>
                    <GlassSelect style={{ width: '100%' }} value={systemCurrency} onChange={setSystemCurrency} options={[
                      { value: 'USD', label: 'USD ($)' }, { value: 'MYR', label: 'MYR (RM)' },
                      { value: 'EUR', label: 'EUR (€)' }, { value: 'GBP', label: 'GBP (£)' }
                    ]} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Time Zone</label>
                    <GlassSelect style={{ width: '100%' }} value={systemTimezone} onChange={setSystemTimezone} options={[
                      { value: 'US', label: 'Eastern Time (US)' },
                      { value: 'MY', label: 'Malaysia Time (MYT)' },
                      { value: 'UK', label: 'Greenwich Mean Time (GMT)' }
                    ]} />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Business Type</label>
                    <GlassSelect style={{ width: '100%' }} value={systemBusiness} onChange={setSystemBusiness} options={[
                      { value: 'Retail', label: 'Retail' }, { value: 'Wholesale', label: 'Wholesale' },
                      { value: 'Manufacturing', label: 'Manufacturing' }, { value: 'SaaS', label: 'SaaS / Services' }
                    ]} />
                  </div>
                </div>
                <SaveBar saving={systemSaving} saved={systemSaved} onSave={saveSystem} label="Save System Settings" />
              </div>
            </div>
          )}

          {/* ── SALARY / AUTO-PAY ── */}
          {activeTab === 'salary' && (
            <div className="animation-fade-in">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                <DollarSign color="#22d3a8" />
                <h2 style={{ fontSize: 18 }}>Salary & Auto-Pay Settings</h2>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 600 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', background: 'rgba(34,211,168,0.05)', borderRadius: 'var(--r-md)', border: '1px solid rgba(34,211,168,0.15)' }}>
                  <div>
                    <h3 style={{ fontSize: 14, fontWeight: 600, color: '#22d3a8', marginBottom: 4 }}>Automatic Salary Payment</h3>
                    <p style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>Automatically mark all employee salaries as paid on a specific day each month.</p>
                  </div>
                  <Toggle checked={autoPayEnabled} onChange={() => setAutoPayEnabled(!autoPayEnabled)} />
                </div>
                <div style={{ opacity: autoPayEnabled ? 1 : 0.4, pointerEvents: autoPayEnabled ? 'auto' : 'none', transition: 'opacity 0.3s' }}>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Payment Day of Month</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Calendar size={16} color="var(--clr-text-muted)" />
                    <select className="glass-input" style={{ width: 140 }} value={autoPayDay} onChange={e => setAutoPayDay(parseInt(e.target.value))}>
                      {Array.from({ length: 28 }, (_, i) => i + 1).map(day => (
                        <option key={day} value={day}>{day}{day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th'} of every month</option>
                      ))}
                    </select>
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--clr-text-muted)', marginTop: 8 }}>
                    All due salaries will be automatically marked as paid on the {autoPayDay}{autoPayDay === 1 ? 'st' : autoPayDay === 2 ? 'nd' : autoPayDay === 3 ? 'rd' : 'th'} of each month.
                  </p>
                </div>
                <div style={{ background: 'rgba(0,212,255,0.05)', border: '1px solid rgba(0,212,255,0.15)', borderRadius: 'var(--r-md)', padding: 14 }}>
                  <p style={{ fontSize: 12, color: 'rgba(0,212,255,0.8)', lineHeight: 1.6 }}>
                    💡 When auto-pay is enabled, salary records for all active employees will be created and marked as "Paid" on the selected day. You can still manually pay individual employees from the Employees page anytime.
                  </p>
                </div>
                <button className="btn btn-primary" onClick={saveSalarySettings} style={{ alignSelf: 'flex-start' }}>
                  <Save size={16} /> {salarySettingsSaved ? '✓ Saved!' : 'Save Salary Settings'}
                </button>
              </div>
            </div>
          )}

          {/* ── INVENTORY ── */}
          {activeTab === 'inventory' && (
            <div className="animation-fade-in">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Package color="#6C63FF" size={20} />
                  <h2 style={{ fontSize: 18 }}>Inventory Management</h2>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => { setInvProducts([]); setTimeout(loadInvProducts, 50) }}>
                  <RefreshCw size={14} /> Refresh
                </button>
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 24, background: 'rgba(255,255,255,0.04)', padding: 4, borderRadius: 'var(--r-md)', border: '1px solid var(--clr-border)', width: 'fit-content' }}>
                {([{ id: 'sale', label: 'Record Sale', icon: ShoppingCart }, { id: 'stock', label: 'Manage Stock', icon: Edit3 }] as const).map(t => (
                  <button key={t.id} onClick={() => setInvSubTab(t.id)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 14px', borderRadius: 'calc(var(--r-md) - 2px)', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', transition: 'all 0.2s', background: invSubTab === t.id ? 'linear-gradient(135deg,#6C63FF,#846cff)' : 'transparent', color: invSubTab === t.id ? '#fff' : 'var(--clr-text-muted)' }}
                    onMouseEnter={e => { if (invSubTab !== t.id) (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 1px rgba(108,99,255,0.4), 0 0 12px rgba(108,99,255,0.3)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '' }}
                  ><t.icon size={14} /> {t.label}</button>
                ))}
              </div>

              {invSubTab === 'sale' && (
                <div style={{ maxWidth: 560 }}>
                  <p style={{ fontSize: 13, color: 'var(--clr-text-muted)', marginBottom: 20 }}>Log a real or simulated sale. This inserts a row into <code style={{ background: 'rgba(108,99,255,0.15)', padding: '1px 6px', borderRadius: 4, fontSize: 12 }}>sales_transactions</code> and decrements live inventory stock.</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Product</label>
                      <div style={{ position: 'relative' }}>
                        <select className="glass-input glass-select" value={saleProductId} onChange={e => setSaleProductId(Number(e.target.value))} style={{ width: '100%', paddingRight: 32 }}>
                          <option value="">— Select a product —</option>
                          {invProducts.map(p => <option key={p.id} value={p.id}>[{p.family}] {p.name} — Stock: {p.current_stock}</option>)}
                        </select>
                        <ChevronDown size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--clr-text-muted)' }} />
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Quantity Sold</label>
                        <input type="number" className="glass-input" min={1} value={saleQty} onChange={e => setSaleQty(Math.max(1, parseInt(e.target.value) || 1))} style={{ width: '100%' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Sale Date</label>
                        <input type="date" className="glass-input" value={saleDate} onChange={e => setSaleDate(e.target.value)} style={{ width: '100%' }} />
                      </div>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer' }}>
                      <input type="checkbox" checked={salePromo} onChange={e => setSalePromo(e.target.checked)} /> On Promotion / Discount
                    </label>
                    {saleProductId !== '' && (() => {
                      const p = invProducts.find(x => x.id === saleProductId)
                      if (!p) return null
                      const afterStock = Math.max(0, p.current_stock - saleQty)
                      const isLow = afterStock <= p.reorder_level
                      return (
                        <div style={{ padding: 14, borderRadius: 'var(--r-md)', background: isLow ? 'rgba(244,63,94,0.06)' : 'rgba(34,211,168,0.05)', border: `1px solid ${isLow ? 'rgba(244,63,94,0.3)' : 'rgba(34,211,168,0.2)'}` }}>
                          <p style={{ fontSize: 12, color: isLow ? '#f43f5e' : '#22d3a8', marginBottom: 4, fontWeight: 600 }}>{isLow ? '⚠ Below reorder level after this sale' : '✓ Stock sufficient'}</p>
                          <p style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>Current: <strong style={{ color: '#fff' }}>{p.current_stock}</strong> → After sale: <strong style={{ color: isLow ? '#f43f5e' : '#22d3a8' }}>{afterStock}</strong> &nbsp;|&nbsp; Reorder at: {p.reorder_level}</p>
                        </div>
                      )
                    })()}
                    {saleMsg && (
                      <div style={{ padding: 12, borderRadius: 'var(--r-md)', background: saleMsg.type === 'success' ? 'rgba(34,211,168,0.08)' : 'rgba(244,63,94,0.08)', border: `1px solid ${saleMsg.type === 'success' ? 'rgba(34,211,168,0.3)' : 'rgba(244,63,94,0.3)'}`, fontSize: 13, color: saleMsg.type === 'success' ? '#22d3a8' : '#f43f5e' }}>{saleMsg.text}</div>
                    )}
                    <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={recordSale} disabled={!saleProductId || saleLoading}>
                      <ShoppingCart size={15} /> {saleLoading ? 'Recording…' : 'Record Sale'}
                    </button>
                  </div>
                </div>
              )}

              {invSubTab === 'stock' && (
                <div>
                  <p style={{ fontSize: 13, color: 'var(--clr-text-muted)', marginBottom: 16 }}>Directly edit current stock or reorder level for any product. Changes are saved to Supabase immediately.</p>
                  {invLoading ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{[...Array(6)].map((_, i) => <div key={i} className="shimmer" style={{ height: 44, borderRadius: 8 }} />)}</div>
                  ) : (
                    <div style={{ maxHeight: 480, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {invProducts.map(p => {
                        const edit = stockEdits[p.id]
                        const stock = edit?.stock ?? p.current_stock
                        const reorder = edit?.reorder ?? p.reorder_level
                        const isDirty = !!edit
                        const isLow = stock <= p.reorder_level
                        return (
                          <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 120px 80px', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 'var(--r-md)', background: 'rgba(255,255,255,0.03)', border: `1px solid ${isDirty ? 'rgba(108,99,255,0.4)' : isLow ? 'rgba(244,63,94,0.2)' : 'rgba(255,255,255,0.06)'}`, transition: 'border-color 0.2s' }}>
                            <div><p style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{p.name}</p><p style={{ fontSize: 11, color: 'var(--clr-text-muted)' }}>{p.family}</p></div>
                            <div>
                              <label style={{ fontSize: 10, color: 'var(--clr-text-muted)', display: 'block', marginBottom: 3 }}>STOCK</label>
                              <input type="number" min={0} value={stock} onChange={e => setStockEdits(prev => ({ ...prev, [p.id]: { stock: Math.max(0, parseInt(e.target.value) || 0), reorder: prev[p.id]?.reorder ?? p.reorder_level } }))} style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: `1px solid ${isLow && !isDirty ? 'rgba(244,63,94,0.4)' : 'rgba(255,255,255,0.12)'}`, borderRadius: 6, padding: '5px 8px', color: isLow ? '#f43f5e' : '#fff', fontSize: 13, fontWeight: 600, outline: 'none' }} />
                            </div>
                            <div>
                              <label style={{ fontSize: 10, color: 'var(--clr-text-muted)', display: 'block', marginBottom: 3 }}>REORDER AT</label>
                              <input type="number" min={0} value={reorder} onChange={e => setStockEdits(prev => ({ ...prev, [p.id]: { stock: prev[p.id]?.stock ?? p.current_stock, reorder: Math.max(0, parseInt(e.target.value) || 0) } }))} style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '5px 8px', color: '#fff', fontSize: 13, outline: 'none' }} />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                              {stockSaved === p.id ? <span style={{ color: '#22d3a8', fontSize: 12, fontWeight: 600 }}><Check size={14} style={{ verticalAlign: 'middle' }} /> Saved</span> : isDirty ? <button className="btn btn-primary btn-sm" disabled={stockSaving === p.id} onClick={() => saveStockEdit(p.id)}>{stockSaving === p.id ? '…' : <><Check size={13} /> Save</>}</button> : isLow ? <span style={{ fontSize: 11, color: '#f43f5e', display: 'flex', alignItems: 'center', gap: 4 }}><AlertTriangle size={12} /> Low</span> : null}
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

          {/* ── AI SETTINGS ── */}
          {activeTab === 'ai' && (
            <div className="animation-fade-in">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}><Zap color="#00D4FF" /><h2 style={{ fontSize: 18 }}>AI Control Core</h2></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 600 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', background: 'rgba(0,212,255,0.05)', borderRadius: 'var(--r-md)', border: '1px solid rgba(0,212,255,0.1)' }}>
                  <div><h3 style={{ fontSize: 14, fontWeight: 600, color: '#00D4FF', marginBottom: 4 }}>Enable AI Predictions</h3><p style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>Use machine learning to forecast demand continuously.</p></div>
                  <Toggle checked={aiEnabled} onChange={() => setAiEnabled(!aiEnabled)} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, opacity: aiEnabled ? 1 : 0.5, pointerEvents: aiEnabled ? 'auto' : 'none' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Model Type</label>
                    <GlassSelect style={{ width: '100%' }} value={aiModelType} onChange={setAiModelType} options={[
                      { value: 'Regression', label: 'Linear Regression' }, { value: 'ARIMA', label: 'Time Series (ARIMA)' }, { value: 'LSTM', label: 'Neural Net (LSTM)' }
                    ]} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Prediction Interval</label>
                    <GlassSelect style={{ width: '100%' }} value={aiInterval} onChange={setAiInterval} options={[
                      { value: 'Daily', label: 'Daily' }, { value: 'Weekly', label: 'Weekly' }, { value: 'Monthly', label: 'Monthly' }
                    ]} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Confidence Threshold (%)</label>
                    <input type="number" className="glass-input" value={aiConfidence} min={50} max={99} onChange={e => setAiConfidence(Math.min(99, Math.max(50, parseInt(e.target.value) || 85)))} style={{ width: '100%' }} />
                    <p style={{ fontSize: 11, color: 'var(--clr-text-muted)', marginTop: 6 }}>Alerts trigger only if AI confidence exceeds this.</p>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', marginTop: 10, background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--r-md)', border: '1px solid rgba(255,255,255,0.05)', opacity: aiEnabled ? 1 : 0.5, pointerEvents: aiEnabled ? 'auto' : 'none' }}>
                  <div><h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Auto Suggestion UI Prompts</h3><p style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>AI directly suggests actions within the alert detail panel.</p></div>
                  <Toggle checked={autoRecom} onChange={() => setAutoRecom(!autoRecom)} />
                </div>
                <SaveBar saving={aiSaving} saved={aiSaved} onSave={saveAI} label="Save AI Settings" />

                <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '8px 0' }} />

                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                    <Zap color="#a78bfa" size={18} />
                    <h2 style={{ fontSize: 16, margin: 0 }}>Autonomous Agents</h2>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 16, marginTop: 0 }}>
                    These run server-side with no approval step. While off, the agent never touches your data — restock orders and payroll only happen when you click the buttons yourself.
                  </p>

                  {[
                    { kind: 'restock' as const, label: 'Restock Agent', enabled: restockAgentEnabled,
                      desc: 'Watches stock levels and places vendor orders the instant a product drops below reorder level, plus a daily safety sweep.' },
                    { kind: 'payroll' as const, label: 'Payroll Agent', enabled: payrollAgentEnabled,
                      desc: 'Pays every employee with a due salary automatically — checked daily, acts when payday data is due.' },
                  ].map(a => (
                    <div key={a.kind} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '16px', marginBottom: 12, background: a.enabled ? 'rgba(108,99,255,0.07)' : 'rgba(255,255,255,0.03)', borderRadius: 'var(--r-md)', border: `1px solid ${a.enabled ? 'rgba(108,99,255,0.25)' : 'rgba(255,255,255,0.05)'}`, transition: 'background 0.3s ease, border-color 0.3s ease' }}>
                      <div>
                        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: a.enabled ? '#a78bfa' : '#fff' }}>
                          {a.label} {a.enabled && <span style={{ fontSize: 10, color: '#22d3a8', fontWeight: 700, marginLeft: 6 }}>● ACTIVE</span>}
                        </h3>
                        <p style={{ fontSize: 12, color: 'var(--clr-text-muted)', margin: 0 }}>{a.desc}</p>
                      </div>
                      <button
                        disabled={agentToggleBusy === a.kind}
                        onClick={() => toggleAgent(a.kind, !a.enabled)}
                        style={{ width: 44, height: 24, borderRadius: 12, border: 'none', cursor: agentToggleBusy === a.kind ? 'wait' : 'pointer', position: 'relative', background: a.enabled ? 'linear-gradient(135deg,#6C63FF,#00D4FF)' : 'rgba(255,255,255,0.1)', transition: 'background 0.3s ease', flexShrink: 0, opacity: agentToggleBusy === a.kind ? 0.6 : 1 }}
                        aria-label={`Toggle ${a.label}`}
                      >
                        <div style={{ position: 'absolute', top: 3, left: a.enabled ? 23 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.3s ease', boxShadow: '0 2px 4px rgba(0,0,0,0.3)' }} />
                      </button>
                    </div>
                  ))}

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1 }}>Recent Agent Activity</span>
                    <button className="btn btn-ghost btn-sm" onClick={fetchAgentRuns}><RefreshCw size={12} /></button>
                  </div>
                  {agentRuns.length === 0 ? (
                    <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>No agent runs logged yet.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
                      {agentRuns.map(r => {
                        const s = r.summary || {}
                        const color = r.run_type === 'payroll' ? '#a78bfa' : '#f59e0b'
                        return (
                          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', fontSize: 11 }}>
                            <span style={{ padding: '2px 7px', borderRadius: 8, background: `${color}1e`, color, fontWeight: 700, fontSize: 10, flexShrink: 0 }}>{r.run_type.toUpperCase()}</span>
                            <span style={{ color: 'rgba(255,255,255,0.4)', flexShrink: 0 }}>{r.trigger_source}</span>
                            <span style={{ flex: 1, color: 'rgba(255,255,255,0.6)' }}>
                              {s.note || `${s.done || 0} done${s.skipped ? ` · ${s.skipped} skipped` : ''}${s.total_amount ? ` · $${Number(s.total_amount).toLocaleString()}` : ''}`}
                            </span>
                            <span style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>{new Date(r.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── PAYMENTS ── */}
          {activeTab === 'payments' && (
            <div className="animation-fade-in">
              <h2 style={{ fontSize: 18, marginBottom: 20 }}>Payment Settings</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 600 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Enabled Payment Methods</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer', marginBottom: 10 }}>
                    <input type="checkbox" checked={paymentStripe} onChange={e => setPaymentStripe(e.target.checked)} /> Credit Card (Stripe)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer', marginBottom: 10 }}>
                    <input type="checkbox" checked={paymentACH} onChange={e => setPaymentACH(e.target.checked)} /> Online Banking / ACH
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer' }}>
                    <input type="checkbox" checked={paymentPaypal} onChange={e => setPaymentPaypal(e.target.checked)} /> PayPal Gateway
                  </label>
                </div>
                <div style={{ height: 1, background: 'rgba(255,255,255,0.1)' }} />
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>API Key (Stripe simulated)</label>
                  <input type="password" className="glass-input" value={paymentApiKey} onChange={e => setPaymentApiKey(e.target.value)} style={{ width: '100%', fontFamily: 'monospace' }} />
                </div>
                <SaveBar saving={paymentSaving} saved={paymentSaved} onSave={savePayments} label="Save Payment Settings" />
              </div>
            </div>
          )}

          {/* ── LOGISTICS ── */}
          {activeTab === 'logistics' && (
            <div className="animation-fade-in">
              <h2 style={{ fontSize: 18, marginBottom: 20 }}>Logistics Settings</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 600 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Default Shipping Logistics Provider</label>
                  <GlassSelect style={{ width: '100%' }} value={logisticsProvider} onChange={setLogisticsProvider} options={[
                    { value: 'DHL', label: 'DHL Express' }, { value: 'FedEx', label: 'FedEx Freight' },
                    { value: 'UPS', label: 'UPS Ground' }, { value: 'ANA', label: 'ANA Cargo' }
                  ]} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--r-md)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div><h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>AI Auto Shipping Optimization</h3><p style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>Automatically select the cheapest/fastest option per order.</p></div>
                  <Toggle checked={autoShipping} onChange={() => setAutoShipping(!autoShipping)} />
                </div>
                <SaveBar saving={logisticsSaving} saved={logisticsSaved} onSave={saveLogistics} label="Save Logistics Settings" />
              </div>
            </div>
          )}

          {/* ── NOTIFICATIONS ── */}
          {activeTab === 'notifications' && (
            <div className="animation-fade-in">
              <h2 style={{ fontSize: 18, marginBottom: 20 }}>Notification Settings</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 600 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Internal System Alerts</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer', marginBottom: 10 }}><input type="checkbox" checked={notifLowStock}  onChange={e => setNotifLowStock(e.target.checked)}  /> Low Stock &amp; Inventory Outages</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer', marginBottom: 10 }}><input type="checkbox" checked={notifPayments}  onChange={e => setNotifPayments(e.target.checked)}  /> Payment Failures</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer', marginBottom: 10 }}><input type="checkbox" checked={notifLogistics} onChange={e => setNotifLogistics(e.target.checked)} /> Logistics Delays</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer' }}><input type="checkbox" checked={notifAI}        onChange={e => setNotifAI(e.target.checked)}        /> AI Behavior Insights</label>
                </div>
                <div style={{ height: 1, background: 'rgba(255,255,255,0.1)' }} />
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>External Forwarding</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer', marginBottom: 10 }}><input type="checkbox" checked={notifEmail} onChange={e => setNotifEmail(e.target.checked)} /> Forward Critical Alerts to Email</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer' }}><input type="checkbox" checked={notifSMS}   onChange={e => setNotifSMS(e.target.checked)}   /> Push Notifications to SMS</label>
                </div>
                <SaveBar saving={notifSaving} saved={notifSaved} onSave={saveNotifications} label="Save Notification Settings" />
              </div>
            </div>
          )}

          {/* ── SECURITY ── */}
          {activeTab === 'security' && (
            <div className="animation-fade-in">
              <h2 style={{ fontSize: 18, marginBottom: 20 }}>Security Settings</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 600 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div><label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Current Password</label><input type="password" className="glass-input" defaultValue="*********" style={{ width: '100%' }} /></div>
                  <div><label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>New Password</label><input type="password" className="glass-input" placeholder="Enter new password" style={{ width: '100%' }} /></div>
                  <button className="btn btn-ghost" style={{ alignSelf: 'flex-start' }}>Update Password</button>
                </div>
                <div style={{ height: 1, background: 'rgba(255,255,255,0.1)' }} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', background: 'rgba(108,99,255,0.05)', borderRadius: 'var(--r-md)', border: '1px solid rgba(108,99,255,0.2)' }}>
                  <div><h3 style={{ fontSize: 14, fontWeight: 600, color: '#a89dff', marginBottom: 4 }}>Two-Factor Authentication</h3><p style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>Secure your admin account with an authenticator app.</p></div>
                  <button className="btn btn-primary btn-sm">Enable 2FA</button>
                </div>
              </div>
            </div>
          )}

          {/* ── Global Save ── */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', marginTop: 40, paddingTop: 20, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 14 }}>
            {globalSaved && <span style={{ fontSize: 13, color: '#22d3a8', fontWeight: 600 }}>✓ All settings saved to database</span>}
            <button className="btn btn-primary" onClick={saveAllSettings} disabled={globalSaving}>
              <Save size={16} /> {globalSaving ? 'Saving All…' : 'Save Global Changes'}
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}
