import { useState, useEffect } from 'react'
import {
  User, Monitor, Package, Zap, CreditCard, Truck, Bell, Shield,
  UploadCloud, Save, Users, Calendar, DollarSign
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

  // Salary auto-pay settings
  const [autoPayEnabled, setAutoPayEnabled] = useState(false)
  const [autoPayDay, setAutoPayDay] = useState(1)
  const [salarySettingsLoading, setSalarySettingsLoading] = useState(true)
  const [salarySettingsSaved, setSalarySettingsSaved] = useState(false)

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

          {/* INVENTORY SETTINGS */}
          {activeTab === 'inventory' && (
            <div className="animation-fade-in">
              <h2 style={{ fontSize: 18, marginBottom: 20 }}>Inventory Settings</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 600 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Global Low Stock Alert Threshold (units)</label>
                  <input type="number" className="glass-input" defaultValue={10} style={{ width: '100%' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--r-md)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div>
                    <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Auto Restock (Automated Purchase Orders)</h3>
                    <p style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>Automatically generate supply orders when items hit threshold.</p>
                  </div>
                  <Toggle checked={autoRestock} onChange={() => setAutoRestock(!autoRestock)} />
                </div>
              </div>
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
