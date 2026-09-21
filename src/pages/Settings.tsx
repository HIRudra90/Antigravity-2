import { useState, useEffect } from 'react'
import {
  User, Monitor, Package, Zap, CreditCard, Truck, Bell, Shield,
  UploadCloud, Save, Calendar, DollarSign,
  ShoppingCart, Shuffle, Edit3, Check, RefreshCw, AlertTriangle, ChevronDown,
  Building2
} from 'lucide-react'
import GlassSelect from '../components/GlassSelect'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import { useLocale, CURRENCIES, TIMEZONES } from '../lib/locale'
import { NOTIFICATION_CATEGORIES } from '../lib/notifications'
import { backendFetch, describeBackendError, ModelStatus } from '../lib/backend'

// Profile moved out: the picture, company name and login credentials are now
// edited from the profile card at the bottom of the sidebar, which is where
// they are displayed. Two editors for one set of values meant whichever was
// opened second showed stale text.
const TABS = [
  { id: 'system',        label: 'System',             icon: Monitor },
  { id: 'salary',        label: 'Salary / Auto-Pay',  icon: DollarSign },
  { id: 'vendorpay',     label: 'Vendor Auto-Pay',    icon: Building2 },
  { id: 'inventory',     label: 'Inventory',          icon: Package },
  { id: 'ai',            label: 'AI Settings',        icon: Zap },
  { id: 'payments',      label: 'Payments',           icon: CreditCard },
  { id: 'logistics',     label: 'Logistics',          icon: Truck },
  { id: 'notifications', label: 'Notifications',      icon: Bell },
  { id: 'security',      label: 'Security',           icon: Shield },
]

// The only horizons /api/predict/pipeline accepts. The old Daily/Weekly/Monthly
// dropdown matched none of them, which is why changing it never did anything.
export const FORECAST_PERIODS = [
  { value: '7d',   label: '7 Days',  days: 7 },
  { value: '30d',  label: '30 Days', days: 30 },
  { value: '90d',  label: '90 Days', days: 90 },
  { value: '365d', label: '1 Year',  days: 365 },
]

type AgentKind = 'restock' | 'payroll' | 'vendorpay'

// Every switch that can start an agent, per agent.
//
// Payroll and vendor pay are each gated by TWO settings: the agent master
// switch and the user-facing auto-pay toggle. Both have to move together —
// when the agent card wrote only the master switch, turning it on here left
// auto-pay off, so the card read "● ACTIVE" while nothing ever ran.
const AGENT_KEYS: Record<AgentKind, string[]> = {
  restock:   ['agent_restock_enabled'],
  payroll:   ['agent_payroll_enabled',    'auto_pay_enabled'],
  vendorpay: ['agent_vendor_pay_enabled', 'auto_vendor_pay_enabled'],
}

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
  const locale = useLocale()
  const { fmtDate, fmtDateTime } = locale
  const ownerId = profile?.owner_id ?? null
  // 'system' is the first tab now that Profile has moved to the sidebar card;
  // defaulting to the removed id would have opened this page on a blank panel.
  const [activeTab, setActiveTab] = useState('system')

  // ── System ───────────────────────────────────────────────────────────────────
  const [systemCurrency, setSystemCurrency] = useState('USD')
  const [systemTimezone, setSystemTimezone] = useState('MY')
  const [systemBusiness, setSystemBusiness] = useState('Retail')

  // ── AI ───────────────────────────────────────────────────────────────────────
  const [aiEnabled,    setAiEnabled]    = useState(true)
  const [autoRecom,    setAutoRecom]    = useState(true)
  const [aiConfidence, setAiConfidence] = useState(85)
  // The horizon sent to /api/predict/pipeline. The old "Prediction Interval"
  // (Daily/Weekly/Monthly) matched nothing the backend accepts, so it could
  // never have taken effect; these four values are the contract.
  const [aiForecastPeriod, setAiForecastPeriod] = useState('30d')
  const [modelStatus,        setModelStatus]        = useState<any>(null)
  const [modelStatusErr,     setModelStatusErr]     = useState<string | null>(null)
  const [modelStatusLoading, setModelStatusLoading] = useState(false)

  // ── Autonomous Agents (restock + payroll + vendor payment) ──────────────────
  // Payroll and vendor pay have no separate "agent enabled" state: their cards
  // read the very same booleans as their settings pages (autoPayEnabled /
  // vendorPayEnabled), so the two screens cannot drift apart.
  const [restockAgentEnabled, setRestockAgentEnabled] = useState(false)
  const [agentToggleBusy, setAgentToggleBusy] = useState<AgentKind | null>(null)
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
  // One switch per real event category (see migration 016). The old six keys
  // were read by nothing, and two of them described delivery channels that do
  // not exist in this project.
  const [notifCats, setNotifCats] = useState<Record<string, boolean>>({
    inventory: true, procurement: true, payment: true, agent: true,
  })
  const [notifCounts, setNotifCounts] = useState<Record<string, number>>({})

  // ── Salary / Auto-Pay ────────────────────────────────────────────────────────
  const [autoPayEnabled,         setAutoPayEnabled]         = useState(false)
  const [autoPayDay,             setAutoPayDay]             = useState(1)
  const [salarySettingsLoading,  setSalarySettingsLoading]  = useState(true)
  const [salarySettingsSaved,    setSalarySettingsSaved]    = useState(false)
  const [payrollPreview,         setPayrollPreview]         = useState<any>(null)
  const [payrollRunning,         setPayrollRunning]         = useState(false)
  const [payrollRunConfirm,      setPayrollRunConfirm]      = useState(false)
  const [payrollRunResult,       setPayrollRunResult]       = useState<string | null>(null)

  // ── Vendor Auto-Pay ──────────────────────────────────────────────────────────
  const [vendorPayEnabled,       setVendorPayEnabled]       = useState(false)
  const [vendorPayDay,           setVendorPayDay]           = useState(1)
  const [vendorSettingsLoading,  setVendorSettingsLoading]  = useState(false)
  const [vendorSettingsSaved,    setVendorSettingsSaved]    = useState(false)
  const [vendorPreview,          setVendorPreview]          = useState<any>(null)
  const [vendorRunning,          setVendorRunning]          = useState(false)
  const [vendorRunConfirm,       setVendorRunConfirm]       = useState(false)
  const [vendorRunResult,        setVendorRunResult]        = useState<string | null>(null)

  // ── Inventory sub-tab ────────────────────────────────────────────────────────
  const [invSubTab,    setInvSubTab]    = useState<'sale' | 'stock' | 'simulate'>('sale')
  const [invProducts,  setInvProducts]  = useState<any[]>([])
  const [invLoading,   setInvLoading]   = useState(false)

  // ── Simulation harness (migrations 036/037) ─────────────────────────────
  const [simDays,    setSimDays]    = useState(7)
  const [simRunning, setSimRunning] = useState(false)
  const [simRows,    setSimRows]    = useState<any[]>([])
  const [simError,   setSimError]   = useState<string | null>(null)

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

        // Both gates, same as vendor auto-pay: the visible toggle must not
        // read "on" while the master agent switch quietly blocks every run.
        setAutoPayEnabled(
          get('auto_pay_enabled', 'false') === 'true' &&
          get('agent_payroll_enabled', 'false') === 'true'
        )
        setAutoPayDay(parseInt(get('auto_pay_day', '1')) || 1)

        // Vendor auto-pay needs both switches on, and the visible toggle
        // reflects that — otherwise the UI could read "on" while the master
        // agent switch quietly keeps it from ever running.
        setVendorPayEnabled(
          get('auto_vendor_pay_enabled', 'false') === 'true' &&
          get('agent_vendor_pay_enabled', 'false') === 'true'
        )
        setVendorPayDay(parseInt(get('auto_vendor_pay_day', '1')) || 1)

        // profile_* keys are read by BrandProvider now, not here.
        setSystemCurrency(get('system_currency', 'USD'))
        setSystemTimezone(get('system_timezone', 'MY'))
        setSystemBusiness(get('system_business', 'Retail'))

        setAiEnabled(get('ai_enabled', 'true') === 'true')
        // Tolerate the legacy 'Weekly'/'Monthly' values: anything that is not
        // one of the four supported horizons falls back to 30d.
        const period = get('ai_forecast_period', '30d')
        setAiForecastPeriod(FORECAST_PERIODS.some(p => p.value === period) ? period : '30d')
        setAiConfidence(parseInt(get('ai_confidence', '85')) || 85)
        setAutoRecom(get('ai_auto_suggestions', 'true') === 'true')

        // Payroll and vendor-pay agent state is not loaded separately — their
        // cards read autoPayEnabled / vendorPayEnabled, set above from both
        // gates, so one source of truth serves both screens.
        setRestockAgentEnabled(get('agent_restock_enabled', 'false') === 'true')

        setPaymentStripe(get('payment_stripe', 'true') === 'true')
        setPaymentACH(get('payment_ach', 'true') === 'true')
        setPaymentPaypal(get('payment_paypal', 'false') === 'true')

        setLogisticsProvider(get('logistics_provider', 'DHL'))
        setAutoShipping(get('logistics_auto_shipping', 'false') === 'true')

        setNotifCats(Object.fromEntries(
          NOTIFICATION_CATEGORIES.map(c => [c.key, get(`notif_${c.key}`, 'true') === 'true']),
        ))
      }
      setSalarySettingsLoading(false)
    }
    loadSettings()
    fetchAgentRuns()
    loadVendorPreview()
    loadPayrollPreview()
  }, [])

  useEffect(() => {
    if (activeTab === 'inventory' && invProducts.length === 0) loadInvProducts()
    if (activeTab === 'vendorpay') loadVendorPreview()
    if (activeTab === 'salary') loadPayrollPreview()
    if (activeTab === 'ai' && !modelStatus) loadModelStatus()
    if (activeTab === 'notifications') loadNotifCounts()
  }, [activeTab])

  /**
   * Advances the clock by N days of real sales, with stock drawing down.
   *
   * This writes rows — it is a test harness, not a preview. Sales land in
   * sales_transactions, stock falls, revenue and the cash ledger move, and
   * products that cross their reorder point fire the restock agent through
   * the existing trg_low_stock webhook.
   */
  async function runSimulation(days: number) {
    if (simRunning) return
    setSimRunning(true); setSimError(null)
    try {
      const { data, error } = await supabase.rpc('simulate_sales_days', {
        p_days: days, p_multiplier: 1.0,
      })
      if (error) throw error
      setSimRows((data as any[]) || [])
      // Stock and reorder state have moved, so the product table beneath is stale.
      setInvProducts([]); loadInvProducts()
    } catch (e: any) {
      setSimError(e?.message || 'The simulation could not run.')
    } finally {
      setSimRunning(false)
    }
  }

  /** Scatters products across their replenishment cycles before a test run. */
  async function reshuffleCycle() {
    if (simRunning) return
    setSimRunning(true); setSimError(null)
    try {
      const { error } = await supabase.rpc('stagger_inventory_cycle', {
        p_min_days: 9, p_max_days: 35, p_seed: null,
      })
      if (error) throw error
      setSimRows([])
      setInvProducts([]); loadInvProducts()
    } catch (e: any) {
      setSimError(e?.message || 'The reshuffle could not run.')
    } finally {
      setSimRunning(false)
    }
  }

  async function loadVendorPreview() {
    const { data } = await supabase.rpc('vendor_autopay_preview')
    setVendorPreview(Array.isArray(data) ? data[0] : data)
  }

  async function loadPayrollPreview() {
    const { data } = await supabase.rpc('payroll_autopay_preview')
    setPayrollPreview(Array.isArray(data) ? data[0] : data)
  }

  // Which model binaries actually loaded on the backend. Both loaders treat a
  // missing file as a soft failure and fall through to a statistical policy,
  // so the panel reports what is really running rather than asserting it.
  // Retries through a cold start: the Space sleeps when idle, and one probe
  // against a booting server is not evidence the backend is down.
  async function loadModelStatus() {
    setModelStatusLoading(true)
    try {
      setModelStatus(await backendFetch<ModelStatus>('/api/model-status', { timeoutMs: 20_000, retries: 3 }))
      setModelStatusErr(null)
    } catch (e: any) {
      setModelStatus(null)
      setModelStatusErr(describeBackendError(e))
    } finally {
      setModelStatusLoading(false)
    }
  }

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

  // Agent toggles persist immediately — these gate live automation, so there's
  // no separate "Save" step like the rest of this page.
  async function toggleAgent(kind: AgentKind, next: boolean) {
    setAgentToggleBusy(kind)
    const value = next ? 'true' : 'false'
    const { error } = await supabase.from('app_settings').upsert(
      AGENT_KEYS[kind].map(setting_key => ({
        setting_key, setting_value: value, updated_at: new Date().toISOString(),
      })),
      { onConflict: 'setting_key' }
    )
    if (!error) {
      // The settings pages share these booleans, so they follow along without
      // a reload and the "Next run" figures re-read immediately.
      if (kind === 'restock') setRestockAgentEnabled(next)
      else if (kind === 'payroll') { setAutoPayEnabled(next); await loadPayrollPreview() }
      else { setVendorPayEnabled(next); await loadVendorPreview() }
    }
    setAgentToggleBusy(null)
  }

  async function fetchAgentRuns() {
    const { data } = await supabase.from('agent_runs').select('*').order('created_at', { ascending: false }).limit(10)
    setAgentRuns(data || [])
  }


  const saveSystem   = () => upsertSettings([
    ['system_currency', systemCurrency], ['system_timezone', systemTimezone], ['system_business', systemBusiness]
  ], setSystemSaving, setSystemSaved)

  const saveAI       = () => upsertSettings([
    ['ai_enabled', aiEnabled.toString()],
    // The engine is not a choice — it is whatever loaded on the backend — so
    // it is recorded for reference rather than selected.
    ['ai_model_type', modelStatus?.xgboost?.engine ?? 'XGBoost'],
    ['ai_forecast_period', aiForecastPeriod], ['ai_confidence', aiConfidence.toString()],
    ['ai_auto_suggestions', autoRecom.toString()]
  ], setAiSaving, setAiSaved)

  const savePayments = () => upsertSettings([
    ['payment_stripe', paymentStripe.toString()], ['payment_ach', paymentACH.toString()],
    ['payment_paypal', paymentPaypal.toString()]
  ], setPaymentSaving, setPaymentSaved)

  const saveLogistics = () => upsertSettings([
    ['logistics_provider', logisticsProvider], ['logistics_auto_shipping', autoShipping.toString()]
  ], setLogisticsSaving, setLogisticsSaved)

  const saveNotifications = () => upsertSettings(
    NOTIFICATION_CATEGORIES.map(c => [`notif_${c.key}`, String(notifCats[c.key] !== false)] as [string, string]),
    setNotifSaving, setNotifSaved,
  )

  // How many of each category have arrived, so the panel shows the switches
  // are connected to something real rather than asserting it.
  async function loadNotifCounts() {
    const { data } = await supabase.from('notifications').select('category')
    const tally: Record<string, number> = {}
    for (const r of (data as any[]) || []) tally[r.category] = (tally[r.category] || 0) + 1
    setNotifCounts(tally)
  }

  // Writes both gates so turning this off genuinely stops the scheduled run,
  // rather than leaving the master agent switch on somewhere else.
  const saveSalarySettings = async () => {
    await upsertSettings([
      ['auto_pay_enabled',      autoPayEnabled.toString()],
      ['agent_payroll_enabled', autoPayEnabled.toString()],
      ['auto_pay_day',          autoPayDay.toString()],
    ], setSalarySettingsLoading, setSalarySettingsSaved)
    await loadPayrollPreview()
  }

  // Manual payroll run. Forced, so it ignores the enabled/payday checks —
  // hence the confirm showing exactly who gets paid and how much.
  const runPayrollNow = async () => {
    setPayrollRunning(true)
    setPayrollRunResult(null)
    const { data, error } = await supabase.rpc('run_payroll_autopay', { p_trigger: 'manual', p_force: true })
    if (error) {
      setPayrollRunResult(`Failed: ${error.message}`)
    } else {
      const done = Number((data as any)?.done ?? 0)
      const amt  = Number((data as any)?.total_amount ?? 0)
      setPayrollRunResult(
        done > 0
          ? `Paid ${done.toLocaleString()} salar${done === 1 ? 'y' : 'ies'} — ${locale.money(amt)}.`
          : 'Nothing to pay — every active employee is already settled this month.'
      )
    }
    setPayrollRunning(false)
    setPayrollRunConfirm(false)
    await loadPayrollPreview()
    fetchAgentRuns()
  }

  // The single visible toggle writes both switches, so turning it off here
  // genuinely stops the scheduled run rather than leaving one gate open.
  const saveVendorPaySettings = async () => {
    await upsertSettings([
      ['auto_vendor_pay_enabled',  vendorPayEnabled.toString()],
      ['agent_vendor_pay_enabled', vendorPayEnabled.toString()],
      ['auto_vendor_pay_day',      vendorPayDay.toString()],
    ], setVendorSettingsLoading, setVendorSettingsSaved)
    await loadVendorPreview()
  }

  // Manual settlement. Forced, so it ignores the enabled/payday checks — which
  // is exactly why it sits behind a confirm showing the amount.
  const runVendorPayNow = async () => {
    setVendorRunning(true)
    setVendorRunResult(null)
    const { data, error } = await supabase.rpc('run_vendor_autopay', { p_trigger: 'manual', p_force: true })
    if (error) {
      setVendorRunResult(`Failed: ${error.message}`)
    } else {
      const done = Number((data as any)?.done ?? 0)
      const amt  = Number((data as any)?.total_amount ?? 0)
      setVendorRunResult(
        done > 0
          ? `Settled ${done.toLocaleString()} bill${done === 1 ? '' : 's'} — ${locale.money(amt)} paid out.`
          : 'Nothing to settle — no outstanding vendor bills.'
      )
    }
    setVendorRunning(false)
    setVendorRunConfirm(false)
    await loadVendorPreview()
    fetchAgentRuns()
  }

  const saveAllSettings = async () => {
    setGlobalSaving(true)
    // profile_name / profile_email / profile_company are deliberately absent.
    // They are owned by the sidebar profile card now, and this bulk save would
    // have written them back from state this page no longer edits — renaming
    // the company here, then pressing Save All on any other tab, would have
    // silently restored the old name.
    await supabase.from('app_settings').upsert([
      { setting_key: 'system_currency',         setting_value: systemCurrency,          updated_at: new Date().toISOString() },
      { setting_key: 'system_timezone',         setting_value: systemTimezone,          updated_at: new Date().toISOString() },
      { setting_key: 'system_business',         setting_value: systemBusiness,          updated_at: new Date().toISOString() },
      { setting_key: 'ai_enabled',              setting_value: aiEnabled.toString(),    updated_at: new Date().toISOString() },
      { setting_key: 'ai_model_type',           setting_value: modelStatus?.xgboost?.engine ?? 'XGBoost', updated_at: new Date().toISOString() },
      { setting_key: 'ai_forecast_period',      setting_value: aiForecastPeriod,        updated_at: new Date().toISOString() },
      { setting_key: 'ai_confidence',           setting_value: aiConfidence.toString(), updated_at: new Date().toISOString() },
      { setting_key: 'ai_auto_suggestions',     setting_value: autoRecom.toString(),    updated_at: new Date().toISOString() },
      { setting_key: 'payment_stripe',          setting_value: paymentStripe.toString(),  updated_at: new Date().toISOString() },
      { setting_key: 'payment_ach',             setting_value: paymentACH.toString(),     updated_at: new Date().toISOString() },
      { setting_key: 'payment_paypal',          setting_value: paymentPaypal.toString(),  updated_at: new Date().toISOString() },
      { setting_key: 'logistics_provider',      setting_value: logisticsProvider,         updated_at: new Date().toISOString() },
      { setting_key: 'logistics_auto_shipping', setting_value: autoShipping.toString(),   updated_at: new Date().toISOString() },
      ...NOTIFICATION_CATEGORIES.map(c => ({
        setting_key: `notif_${c.key}`,
        setting_value: String(notifCats[c.key] !== false),
        updated_at: new Date().toISOString(),
      })),
      // Both gates for each schedule, same as the per-tab saves. Writing only
      // auto_pay_enabled here would leave the agent switch behind and undo
      // whatever the Autonomous Agents card had just set.
      { setting_key: 'auto_pay_enabled',          setting_value: autoPayEnabled.toString(),   updated_at: new Date().toISOString() },
      { setting_key: 'agent_payroll_enabled',     setting_value: autoPayEnabled.toString(),   updated_at: new Date().toISOString() },
      { setting_key: 'auto_pay_day',              setting_value: autoPayDay.toString(),       updated_at: new Date().toISOString() },
      { setting_key: 'auto_vendor_pay_enabled',   setting_value: vendorPayEnabled.toString(), updated_at: new Date().toISOString() },
      { setting_key: 'agent_vendor_pay_enabled',  setting_value: vendorPayEnabled.toString(), updated_at: new Date().toISOString() },
      { setting_key: 'auto_vendor_pay_day',       setting_value: vendorPayDay.toString(),     updated_at: new Date().toISOString() },
      { setting_key: 'agent_restock_enabled',     setting_value: restockAgentEnabled.toString(), updated_at: new Date().toISOString() },
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

          {/* ── SYSTEM ── */}
          {activeTab === 'system' && (
            <div className="animation-fade-in">
              <h2 style={{ fontSize: 18, marginBottom: 20 }}>System / Business Settings</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 600 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Currency</label>
                    {/* Applies on selection, not on Save — every amount in the
                        app re-renders the moment this changes. */}
                    <GlassSelect
                      style={{ width: '100%' }}
                      value={locale.currency}
                      onChange={code => { setSystemCurrency(code); locale.setCurrency(code) }}
                      options={CURRENCIES.map(c => ({
                        value: c.code,
                        label: `${c.code} (${new Intl.NumberFormat(c.locale, { style: 'currency', currency: c.code })
                          .formatToParts(1).find(p => p.type === 'currency')?.value ?? c.code}) — ${c.label}`,
                      }))}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Time Zone</label>
                    <GlassSelect
                      style={{ width: '100%' }}
                      value={locale.timezone}
                      onChange={tz => { setSystemTimezone(tz); locale.setTimezone(tz) }}
                      options={TIMEZONES.map(t => ({ value: t.id, label: t.label }))}
                    />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    {/* Picking a currency moves the clock to that market's
                        zone, which is nearly always what is wanted; the
                        dropdown above still overrides it independently. */}
                    <p style={{ fontSize: 11, color: 'var(--clr-text-muted)', margin: '0 0 16px' }}>
                      Sample: <strong style={{ color: '#22d3a8' }}>{locale.money(1234567.89)}</strong>
                      {'  ·  '}
                      <strong style={{ color: '#00D4FF' }}>{locale.fmtDateTime(new Date())}</strong>
                      {'  ·  '}amounts are relabelled, not converted at an FX rate.
                    </p>
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
          {activeTab === 'salary' && (() => {
            const ord = (d: number) => `${d}${d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th'}`
            const dueCount  = Number(payrollPreview?.due_count ?? 0)
            const dueAmount = Number(payrollPreview?.due_amount ?? 0)
            const money = locale.moneyShort
            return (
              <div className="animation-fade-in">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                  <DollarSign color="#22d3a8" />
                  <h2 style={{ fontSize: 18 }}>Salary & Auto-Pay Settings</h2>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 600 }}>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', background: 'rgba(34,211,168,0.05)', borderRadius: 'var(--r-md)', border: '1px solid rgba(34,211,168,0.15)' }}>
                    <div>
                      <h3 style={{ fontSize: 14, fontWeight: 600, color: '#22d3a8', marginBottom: 4 }}>Automatic Salary Payment</h3>
                      <p style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>Automatically pay every active employee's salary on a specific day each month.</p>
                    </div>
                    <Toggle checked={autoPayEnabled} onChange={() => setAutoPayEnabled(!autoPayEnabled)} />
                  </div>

                  <div style={{ opacity: autoPayEnabled ? 1 : 0.4, pointerEvents: autoPayEnabled ? 'auto' : 'none', transition: 'opacity 0.3s' }}>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Payment Day of Month</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <Calendar size={16} color="var(--clr-text-muted)" />
                      <select className="glass-input" style={{ width: 140 }} value={autoPayDay} onChange={e => setAutoPayDay(parseInt(e.target.value))}>
                        {Array.from({ length: 28 }, (_, i) => i + 1).map(day => (
                          <option key={day} value={day}>{ord(day)} of every month</option>
                        ))}
                      </select>
                    </div>
                    <p style={{ fontSize: 11, color: 'var(--clr-text-muted)', marginTop: 8 }}>
                      All due salaries will be paid on the {ord(autoPayDay)} of each month.
                    </p>
                  </div>

                  {/* Live figures, read from the database — same shape as the
                      vendor page so both switches are read the same way. */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                    {[
                      { label: 'Salaries due', value: dueCount.toLocaleString(), color: dueCount > 0 ? '#f59e0b' : '#22d3a8',
                        sub: `${Number(payrollPreview?.active_staff ?? 0)} active staff` },
                      { label: 'Amount due',   value: money(dueAmount), color: dueAmount > 0 ? '#f43f5e' : '#22d3a8',
                        sub: `${money(Number(payrollPreview?.paid_amount ?? 0))} paid` },
                      { label: 'Next run',     value: payrollPreview?.next_run
                          ? fmtDate(payrollPreview.next_run, { month: 'short', day: 'numeric' })
                          : '—',
                        color: autoPayEnabled ? '#00D4FF' : 'rgba(255,255,255,0.35)',
                        sub: autoPayEnabled ? 'scheduled' : 'auto-pay off' },
                    ].map(s => (
                      <div key={s.label} style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                        <div style={{ fontSize: 11, color: 'var(--clr-text-muted)', marginBottom: 4 }}>{s.label}</div>
                        <div style={{ fontSize: 19, fontWeight: 800, color: s.color }}>{s.value}</div>
                        {s.sub && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{s.sub}</div>}
                      </div>
                    ))}
                  </div>

                  <div style={{ background: 'rgba(0,212,255,0.05)', border: '1px solid rgba(0,212,255,0.15)', borderRadius: 'var(--r-md)', padding: 14 }}>
                    <p style={{ fontSize: 12, color: 'rgba(0,212,255,0.8)', lineHeight: 1.6 }}>
                      💡 When auto-pay is enabled, salary records for every active employee are created and marked as "Paid" on the selected day. Inactive and On Leave staff are never paid and never have a record raised. You can still pay individuals from the Employees page at any time, and turning this off stops the scheduled run immediately.
                    </p>
                  </div>

                  {/* Manual run. Bypasses the schedule, so it states the amount
                      first and needs a second click. */}
                  <div style={{ background: 'rgba(244,63,94,0.04)', border: '1px solid rgba(244,63,94,0.15)', borderRadius: 'var(--r-md)', padding: 14 }}>
                    <h4 style={{ fontSize: 13, fontWeight: 600, color: '#f43f5e', marginBottom: 6 }}>Pay all due salaries now</h4>
                    <p style={{ fontSize: 11.5, color: 'var(--clr-text-muted)', lineHeight: 1.6, marginBottom: 12 }}>
                      Runs immediately, regardless of the schedule or the toggle above. This marks every active employee's due salary as paid and cannot be undone from this page.
                    </p>
                    {!payrollRunConfirm ? (
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={dueCount === 0}
                        onClick={() => { setPayrollRunResult(null); setPayrollRunConfirm(true) }}
                        style={{ fontSize: 12, color: dueCount === 0 ? 'rgba(255,255,255,0.3)' : '#f43f5e', borderColor: 'rgba(244,63,94,0.3)' }}
                      >
                        <DollarSign size={13} /> {dueCount === 0 ? 'Nothing due' : `Pay ${dueCount.toLocaleString()} salaries · ${money(dueAmount)}`}
                      </button>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, color: '#f43f5e', fontWeight: 600 }}>
                          Pay {money(dueAmount)} to {dueCount.toLocaleString()} employee{dueCount === 1 ? '' : 's'}?
                        </span>
                        <button className="btn btn-danger btn-sm" onClick={runPayrollNow} disabled={payrollRunning} style={{ fontSize: 12 }}>
                          {payrollRunning ? 'Paying…' : 'Yes, pay now'}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setPayrollRunConfirm(false)} disabled={payrollRunning} style={{ fontSize: 12 }}>Cancel</button>
                      </div>
                    )}
                    {payrollRunResult && (
                      <p style={{ fontSize: 12, color: payrollRunResult.startsWith('Failed') ? '#f43f5e' : '#22d3a8', marginTop: 10 }}>
                        {payrollRunResult}
                      </p>
                    )}
                  </div>

                  <button className="btn btn-primary" onClick={saveSalarySettings} disabled={salarySettingsLoading} style={{ alignSelf: 'flex-start' }}>
                    <Save size={16} /> {salarySettingsSaved ? '✓ Saved!' : 'Save Salary Settings'}
                  </button>
                </div>
              </div>
            )
          })()}

          {/* ── VENDOR AUTO-PAY ── */}
          {activeTab === 'vendorpay' && (() => {
            const ord = (d: number) => `${d}${d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th'}`
            const dueOrders = Number(vendorPreview?.due_orders ?? 0)
            const dueAmount = Number(vendorPreview?.due_amount ?? 0)
            const money = locale.moneyShort
            return (
              <div className="animation-fade-in">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                  <Building2 color="#f59e0b" />
                  <h2 style={{ fontSize: 18 }}>Vendor Payment & Auto-Pay Settings</h2>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 600 }}>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', background: 'rgba(245,158,11,0.05)', borderRadius: 'var(--r-md)', border: '1px solid rgba(245,158,11,0.15)' }}>
                    <div>
                      <h3 style={{ fontSize: 14, fontWeight: 600, color: '#f59e0b', marginBottom: 4 }}>Automatic Vendor Payment</h3>
                      <p style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>Automatically settle every outstanding vendor bill on a specific day each month.</p>
                    </div>
                    <Toggle checked={vendorPayEnabled} onChange={() => setVendorPayEnabled(!vendorPayEnabled)} />
                  </div>

                  <div style={{ opacity: vendorPayEnabled ? 1 : 0.4, pointerEvents: vendorPayEnabled ? 'auto' : 'none', transition: 'opacity 0.3s' }}>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Payment Day of Month</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <Calendar size={16} color="var(--clr-text-muted)" />
                      <select className="glass-input" style={{ width: 140 }} value={vendorPayDay} onChange={e => setVendorPayDay(parseInt(e.target.value))}>
                        {Array.from({ length: 28 }, (_, i) => i + 1).map(day => (
                          <option key={day} value={day}>{ord(day)} of every month</option>
                        ))}
                      </select>
                    </div>
                    <p style={{ fontSize: 11, color: 'var(--clr-text-muted)', marginTop: 8 }}>
                      All unpaid vendor bills will be settled on the {ord(vendorPayDay)} of each month.
                    </p>
                  </div>

                  {/* What a run would actually do, read live from the database. */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                    {[
                      { label: 'Outstanding bills', value: dueOrders.toLocaleString(), color: dueOrders > 0 ? '#f59e0b' : '#22d3a8' },
                      { label: 'Amount due',        value: money(dueAmount),           color: dueAmount > 0 ? '#f43f5e' : '#22d3a8' },
                      { label: 'Next run',          value: vendorPreview?.next_run
                          ? fmtDate(vendorPreview.next_run, { month: 'short', day: 'numeric' })
                          : '—',
                        color: vendorPayEnabled ? '#00D4FF' : 'rgba(255,255,255,0.35)',
                        sub: vendorPayEnabled ? 'scheduled' : 'auto-pay off' },
                    ].map(s => (
                      <div key={s.label} style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                        <div style={{ fontSize: 11, color: 'var(--clr-text-muted)', marginBottom: 4 }}>{s.label}</div>
                        <div style={{ fontSize: 19, fontWeight: 800, color: s.color }}>{s.value}</div>
                        {s.sub && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{s.sub}</div>}
                      </div>
                    ))}
                  </div>

                  <div style={{ background: 'rgba(0,212,255,0.05)', border: '1px solid rgba(0,212,255,0.15)', borderRadius: 'var(--r-md)', padding: 14 }}>
                    <p style={{ fontSize: 12, color: 'rgba(0,212,255,0.8)', lineHeight: 1.6 }}>
                      💡 When vendor auto-pay is enabled, every purchase order still marked unpaid is stamped as settled on the selected day, and each payment appears under Payment → Vendor Payments. You can still settle individual bills manually there at any time. Turning this off stops the scheduled run immediately.
                    </p>
                  </div>

                  {/* Manual run. Bypasses the schedule, so it states the damage
                      first and needs a second click. */}
                  <div style={{ background: 'rgba(244,63,94,0.04)', border: '1px solid rgba(244,63,94,0.15)', borderRadius: 'var(--r-md)', padding: 14 }}>
                    <h4 style={{ fontSize: 13, fontWeight: 600, color: '#f43f5e', marginBottom: 6 }}>Settle all bills now</h4>
                    <p style={{ fontSize: 11.5, color: 'var(--clr-text-muted)', lineHeight: 1.6, marginBottom: 12 }}>
                      Runs immediately, regardless of the schedule or the toggle above. This marks every outstanding bill as paid and cannot be undone from this page.
                    </p>
                    {!vendorRunConfirm ? (
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={dueOrders === 0}
                        onClick={() => { setVendorRunResult(null); setVendorRunConfirm(true) }}
                        style={{ fontSize: 12, color: dueOrders === 0 ? 'rgba(255,255,255,0.3)' : '#f43f5e', borderColor: 'rgba(244,63,94,0.3)' }}
                      >
                        <DollarSign size={13} /> {dueOrders === 0 ? 'Nothing outstanding' : `Settle ${dueOrders.toLocaleString()} bills · ${money(dueAmount)}`}
                      </button>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, color: '#f43f5e', fontWeight: 600 }}>
                          Pay {money(dueAmount)} across {dueOrders.toLocaleString()} bills?
                        </span>
                        <button className="btn btn-danger btn-sm" onClick={runVendorPayNow} disabled={vendorRunning} style={{ fontSize: 12 }}>
                          {vendorRunning ? 'Settling…' : 'Yes, settle now'}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setVendorRunConfirm(false)} disabled={vendorRunning} style={{ fontSize: 12 }}>Cancel</button>
                      </div>
                    )}
                    {vendorRunResult && (
                      <p style={{ fontSize: 12, color: vendorRunResult.startsWith('Failed') ? '#f43f5e' : '#22d3a8', marginTop: 10 }}>
                        {vendorRunResult}
                      </p>
                    )}
                  </div>

                  <button className="btn btn-primary" onClick={saveVendorPaySettings} disabled={vendorSettingsLoading} style={{ alignSelf: 'flex-start' }}>
                    <Save size={16} /> {vendorSettingsSaved ? '✓ Saved!' : 'Save Vendor Payment Settings'}
                  </button>
                </div>
              </div>
            )
          })()}

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
                {([{ id: 'sale', label: 'Record Sale', icon: ShoppingCart }, { id: 'stock', label: 'Manage Stock', icon: Edit3 }, { id: 'simulate', label: 'Simulate Days', icon: Calendar }] as const).map(t => (
                  <button key={t.id} onClick={() => setInvSubTab(t.id)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 14px', borderRadius: 'calc(var(--r-md) - 2px)', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', transition: 'all 0.2s', background: invSubTab === t.id ? 'linear-gradient(135deg,#6C63FF,#846cff)' : 'transparent', color: invSubTab === t.id ? '#fff' : 'var(--clr-text-muted)' }}
                    onMouseEnter={e => { if (invSubTab !== t.id) (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 1px rgba(108,99,255,0.4), 0 0 12px rgba(108,99,255,0.3)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '' }}
                  ><t.icon size={14} /> {t.label}</button>
                ))}
              </div>

              {invSubTab === 'simulate' && (
                <div style={{ maxWidth: 760 }}>
                  <p style={{ fontSize: 13, color: 'var(--clr-text-muted)', marginBottom: 6, lineHeight: 1.6 }}>
                    Advances the clock by whole days of realistic sales, drawn from each product&rsquo;s own
                    demand. Stock falls, revenue and cash move, and products cross their reorder points on
                    different days &mdash; so the restock agent can be watched behaving normally instead of
                    reacting to the whole catalogue at once.
                  </p>
                  <p style={{ fontSize: 12, color: '#f59e0b', marginBottom: 18, lineHeight: 1.6 }}>
                    This writes real rows. Simulated days are dated forward from the last sale, so they can
                    run ahead of today&rsquo;s date &mdash; that is what fast-forwarding means.
                  </p>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
                    {[1, 7, 30].map(d => (
                      <button key={d} className="btn btn-ghost" disabled={simRunning}
                        onClick={() => { setSimDays(d); runSimulation(d) }}
                        style={{ opacity: simRunning ? 0.5 : 1 }}>
                        <Calendar size={14} /> Advance {d} day{d === 1 ? '' : 's'}
                      </button>
                    ))}
                    <span style={{ width: 1, height: 26, background: 'rgba(255,255,255,0.12)' }} />
                    <input
                      type="number" min={1} max={90} value={simDays}
                      onChange={e => setSimDays(Math.max(1, Math.min(90, Number(e.target.value) || 1)))}
                      className="glass-input" style={{ width: 74, fontSize: 13, padding: '7px 10px' }}
                    />
                    <button className="btn btn-primary" disabled={simRunning}
                      onClick={() => runSimulation(simDays)}>
                      {simRunning ? 'Running…' : `Run ${simDays} days`}
                    </button>
                    <span style={{ width: 1, height: 26, background: 'rgba(255,255,255,0.12)' }} />
                    <button className="btn btn-ghost" disabled={simRunning} onClick={reshuffleCycle}
                      title="Scatter products across their replenishment cycles">
                      <RefreshCw size={14} /> Reshuffle cycle
                    </button>
                  </div>

                  {simError && (
                    <div style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 14, fontSize: 12.5,
                      background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.3)', color: '#f43f5e' }}>
                      {simError}
                    </div>
                  )}

                  {simRows.length > 0 && (
                    <div style={{ overflowX: 'auto' }}>
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Day</th><th>Products sold</th><th>Units</th>
                            <th>Revenue</th><th>Lost to stockout</th><th>Crossed reorder</th>
                          </tr>
                        </thead>
                        <tbody>
                          {simRows.map((r: any) => (
                            <tr key={r.day}>
                              <td style={{ whiteSpace: 'nowrap' }}>{r.day}</td>
                              <td>{r.rows_inserted}</td>
                              <td>{Number(r.units_sold).toLocaleString()}</td>
                              <td style={{ color: '#22d3a8', fontWeight: 600 }}>{locale.moneyShort(Number(r.revenue))}</td>
                              {/* Unmet demand is the point of the exercise: it is
                                  what a reorder level set too low actually costs. */}
                              <td style={{ color: Number(r.lost_units) > 0 ? '#f43f5e' : 'var(--clr-text-muted)', fontWeight: Number(r.lost_units) > 0 ? 700 : 400 }}>
                                {Number(r.lost_units).toLocaleString()}
                              </td>
                              <td style={{ color: Number(r.crossed_reorder) > 0 ? '#f59e0b' : 'var(--clr-text-muted)' }}>
                                {r.crossed_reorder}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

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
                {/* ── Engine status ──
                    Not a dropdown: the engine is whatever binary loaded on the
                    backend, and both loaders fall back to a statistical policy
                    when a file is missing. Offering ARIMA/LSTM as choices was
                    fiction — none of them exist in the pipeline. */}
                <div style={{ opacity: aiEnabled ? 1 : 0.5, transition: 'opacity 0.3s' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <label style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>Live Model Pipeline</label>
                    <button className="btn btn-ghost btn-sm" onClick={loadModelStatus} disabled={modelStatusLoading} style={{ fontSize: 11 }}>
                      <RefreshCw size={12} /> {modelStatusLoading ? 'Checking…' : 'Re-check'}
                    </button>
                  </div>

                  {modelStatusErr && (
                    <div style={{ padding: 12, borderRadius: 10, background: 'rgba(244,63,94,0.07)', border: '1px solid rgba(244,63,94,0.25)', marginBottom: 10 }}>
                      <p style={{ margin: 0, fontSize: 12, color: '#f43f5e' }}>
                        Backend unreachable ({modelStatusErr}). Forecasts will fall back to the statistical policy until it responds.
                      </p>
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {[
                      { key: 'xgboost', name: 'XGBoost', role: 'Demand forecasting — predicts units sold per product family',
                        loaded: modelStatus?.xgboost?.loaded, engine: modelStatus?.xgboost?.engine, primary: true },
                      { key: 'ppo', name: 'PPO (Stable-Baselines3)', role: 'Reorder optimisation — chooses the order quantity',
                        loaded: modelStatus?.ppo?.loaded, engine: modelStatus?.ppo?.engine, primary: false },
                      { key: 'llm', name: 'GPT-4o-mini', role: 'Market sentiment from oil price, holidays and news',
                        loaded: modelStatus ? true : undefined, engine: 'OpenRouter', primary: false },
                    ].map(m => {
                      const on = m.loaded === true
                      const c = on ? '#22d3a8' : m.loaded === false ? '#f59e0b' : 'rgba(255,255,255,0.3)'
                      return (
                        <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10, background: m.primary ? 'rgba(0,212,255,0.05)' : 'rgba(255,255,255,0.03)', border: `1px solid ${m.primary ? 'rgba(0,212,255,0.18)' : 'rgba(255,255,255,0.07)'}` }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: c, boxShadow: on ? `0 0 8px ${c}` : 'none', flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: on ? '#fff' : 'rgba(255,255,255,0.6)' }}>
                              {m.name}
                              {m.primary && <span style={{ fontSize: 9, marginLeft: 8, padding: '2px 6px', borderRadius: 5, background: 'rgba(0,212,255,0.15)', color: '#00D4FF', fontWeight: 700 }}>FORECAST ENGINE</span>}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--clr-text-muted)', marginTop: 2 }}>{m.role}</div>
                          </div>
                          <span style={{ fontSize: 10, fontWeight: 700, color: c, flexShrink: 0, textAlign: 'right' }}>
                            {m.loaded === undefined ? 'UNKNOWN' : on ? 'LOADED' : 'FALLBACK'}
                            {m.engine && m.loaded === false && (
                              <div style={{ fontSize: 9, fontWeight: 500, color: 'var(--clr-text-muted)', marginTop: 2 }}>{m.engine}</div>
                            )}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, opacity: aiEnabled ? 1 : 0.5, pointerEvents: aiEnabled ? 'auto' : 'none' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Default Forecast Horizon</label>
                    <GlassSelect
                      style={{ width: '100%' }}
                      value={aiForecastPeriod}
                      onChange={setAiForecastPeriod}
                      options={FORECAST_PERIODS.map(p => ({ value: p.value, label: p.label }))}
                    />
                    <p style={{ fontSize: 11, color: 'var(--clr-text-muted)', marginTop: 6 }}>
                      How far ahead XGBoost projects. Used as the default on the Sales Forecast page and sent to the model as <code style={{ fontSize: 10 }}>forecast_period</code>.
                    </p>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Confidence Threshold (%)</label>
                    <input type="number" className="glass-input" value={aiConfidence} min={50} max={99} onChange={e => setAiConfidence(Math.min(99, Math.max(50, parseInt(e.target.value) || 85)))} style={{ width: '100%' }} />
                    <p style={{ fontSize: 11, color: 'var(--clr-text-muted)', marginTop: 6 }}>
                      A forecast below this confidence is shown but not turned into an automatic restock suggestion.
                    </p>
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
                    These run server-side with no approval step. While off, the agent never touches your data — restock orders, payroll and vendor payments only happen when you click the buttons yourself.
                  </p>

                  {[
                    { kind: 'restock' as const, label: 'Restock Agent', enabled: restockAgentEnabled, tab: null,
                      desc: 'Watches stock levels and places vendor orders the instant a product drops below reorder level, plus a daily safety sweep.' },
                    { kind: 'payroll' as const, label: 'Payroll Agent', enabled: autoPayEnabled, tab: 'salary',
                      desc: `Pays every active employee with a due salary on the ${autoPayDay}${autoPayDay === 1 ? 'st' : autoPayDay === 2 ? 'nd' : autoPayDay === 3 ? 'rd' : 'th'} of each month. Checked daily, acts only on payday.` },
                    { kind: 'vendorpay' as const, label: 'Vendor Payment Agent', enabled: vendorPayEnabled, tab: 'vendorpay',
                      desc: `Settles every outstanding vendor bill on the ${vendorPayDay}${vendorPayDay === 1 ? 'st' : vendorPayDay === 2 ? 'nd' : vendorPayDay === 3 ? 'rd' : 'th'} of each month. Checked daily, acts only on that day.` },
                  ].map(a => (
                    <div key={a.kind} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '16px', marginBottom: 12, background: a.enabled ? 'rgba(108,99,255,0.07)' : 'rgba(255,255,255,0.03)', borderRadius: 'var(--r-md)', border: `1px solid ${a.enabled ? 'rgba(108,99,255,0.25)' : 'rgba(255,255,255,0.05)'}`, transition: 'background 0.3s ease, border-color 0.3s ease' }}>
                      <div>
                        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: a.enabled ? '#a78bfa' : '#fff' }}>
                          {a.label} {a.enabled && <span style={{ fontSize: 10, color: '#22d3a8', fontWeight: 700, marginLeft: 6 }}>● ACTIVE</span>}
                        </h3>
                        <p style={{ fontSize: 12, color: 'var(--clr-text-muted)', margin: 0 }}>{a.desc}</p>
                        {/* This toggle and the settings page drive the same
                            switches, so say where the day and amounts live. */}
                        {a.tab && (
                          <button
                            onClick={() => setActiveTab(a.tab as string)}
                            style={{ background: 'none', border: 'none', padding: 0, marginTop: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600, color: '#6C63FF' }}
                          >
                            Configure schedule →
                          </button>
                        )}
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
                        const color = r.run_type === 'payroll' ? '#a78bfa'
                                    : r.run_type === 'vendor_pay' ? '#22d3a8'
                                    : '#f59e0b'
                        return (
                          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', fontSize: 11 }}>
                            <span style={{ padding: '2px 7px', borderRadius: 8, background: `${color}1e`, color, fontWeight: 700, fontSize: 10, flexShrink: 0 }}>{r.run_type.toUpperCase()}</span>
                            <span style={{ color: 'rgba(255,255,255,0.4)', flexShrink: 0 }}>{r.trigger_source}</span>
                            <span style={{ flex: 1, color: 'rgba(255,255,255,0.6)' }}>
                              {s.note || `${s.done || 0} done${s.skipped ? ` · ${s.skipped} skipped` : ''}${s.total_amount ? ` · ${locale.symbol}${Number(s.total_amount).toLocaleString()}` : ''}`}
                            </span>
                            <span style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>{fmtDateTime(r.created_at)}</span>
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
              <p style={{ fontSize: 12.5, color: 'var(--clr-text-muted)', marginTop: -10, marginBottom: 20, lineHeight: 1.7, maxWidth: 620 }}>
                These are the four things this system actually produces events for. Each is raised by a database
                trigger, so it fires whether the change came from you, an agent or the admin console. Turning a
                category off stops it being recorded at all.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 620 }}>
                {NOTIFICATION_CATEGORIES.map(c => {
                  const on = notifCats[c.key] !== false
                  const count = notifCounts[c.key] ?? 0
                  return (
                    <div key={c.key} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: 16,
                      borderRadius: 'var(--r-md)',
                      background: on ? `${c.color}0d` : 'rgba(255,255,255,0.025)',
                      border: `1px solid ${on ? `${c.color}30` : 'rgba(255,255,255,0.06)'}`,
                      transition: 'background 0.25s, border-color 0.25s',
                    }}>
                      <div style={{ minWidth: 0 }}>
                        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: on ? c.color : 'rgba(255,255,255,0.65)' }}>
                          {c.label}
                          {count > 0 && (
                            <span style={{ fontSize: 10, fontWeight: 700, marginLeft: 8, padding: '2px 7px', borderRadius: 6, background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.55)' }}>
                              {count} received
                            </span>
                          )}
                        </h3>
                        <p style={{ fontSize: 12, color: 'var(--clr-text-muted)', margin: 0 }}>{c.desc}</p>
                      </div>
                      <Toggle checked={on} onChange={() => setNotifCats(p => ({ ...p, [c.key]: !on }))} />
                    </div>
                  )
                })}

                <div style={{ background: 'rgba(0,212,255,0.05)', border: '1px solid rgba(0,212,255,0.15)', borderRadius: 'var(--r-md)', padding: 14 }}>
                  <p style={{ fontSize: 12, color: 'rgba(0,212,255,0.8)', lineHeight: 1.65, margin: 0 }}>
                    💡 Notifications appear on the bell at the top right of every page. Clicking one marks it read and
                    opens the page it refers to. Repeats are collapsed, so a product going low twice in one day is a
                    single entry, and a daily agent run that did nothing stays silent.
                  </p>
                </div>

                {/* Two old options are gone on purpose. Saying why is better
                    than leaving switches that quietly do nothing. */}
                <details style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>
                  <summary style={{ cursor: 'pointer', color: 'rgba(255,255,255,0.45)' }}>Why SMS and email forwarding were removed</summary>
                  <p style={{ lineHeight: 1.7, marginTop: 8 }}>
                    No SMS provider is configured anywhere in this project, so that switch could never have sent
                    anything. Email runs through EmailJS, which is browser-side — it can only send while a tab is
                    open, which is exactly when an alert is least needed. Both would need a server-side sender to
                    work honestly. The old “Logistics Delays” and “AI Behavior Insights” options had no event
                    source behind them either.
                  </p>
                </details>

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
