import { useState } from 'react'
import {
  Bell, AlertTriangle, AlertCircle, Info, Search, Filter, Calendar, Check, CheckCircle, Trash2, Zap
} from 'lucide-react'
import GlassSelect from '../components/GlassSelect'
import Anthropic from '@anthropic-ai/sdk'

// Dummy intelligent background data
const dummyAlerts = [
  { id: '1', type: 'Critical', category: 'Inventory', message: 'Out of stock (Laptop Pro 16")', time: '2 min ago', status: 'New', detail: 'Laptop Pro 16" inventory has reached 0 across all tracked warehouses.', suggestion: 'Restock 150 units immediately to fulfill pending local orders.' },
  { id: '2', type: 'Warning', category: 'Inventory', message: 'Low stock (Mechanical Keyboards)', time: '1 hour ago', status: 'New', detail: 'Stock level is 34 units (reorder point is 50).', suggestion: 'Trigger restock order within 2 days.' },
  { id: '3', type: 'Info', category: 'Sales', message: 'Demand spike detected in Apparel', time: 'Just now', status: 'New', detail: 'Apparel category sales increased by 38% in the last 4 hours.', suggestion: 'Increase buffer stock for upcoming weekend peak.' },
  { id: '4', type: 'Critical', category: 'Payment', message: 'Failed payment from TechStart', time: '3 hours ago', status: 'Reviewing', detail: 'Invoice #TXN-8812 for $3,100 failed due to bank block.', suggestion: 'Send automated email reminder with alternative payment link.' },
  { id: '5', type: 'Warning', category: 'Logistics', message: 'Delivery delay for SHP-9921', time: 'Yesterday', status: 'Resolved', detail: 'FedEx reports a weather delay in customs clearance.', suggestion: 'Notify customer about updated ETA (Apr 3).' },
  { id: '6', type: 'Info', category: 'AI', message: 'Price reduction recommended', time: 'Yesterday', status: 'New', detail: 'Standing Desks are experiencing 15% lower movement.', suggestion: 'Reduce price of Standing Desks by 10%.' },
  { id: '7', type: 'Warning', category: 'AI', message: 'High demand predicted next week', time: '2 days ago', status: 'Read', detail: 'Predictive algorithm AR-4 projects a 25% surge in Electronics.', suggestion: 'Review supplier allocation limits.' },
]

const colorMap: Record<string, string> = {
  Critical: '#f43f5e',
  Warning: '#f59e0b',
  Info: '#00D4FF'
}

const iconMap: Record<string, any> = {
  Critical: AlertCircle,
  Warning: AlertTriangle,
  Info: Info
}

export default function Alerts() {
  const [alerts, setAlerts] = useState(dummyAlerts)
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(dummyAlerts[0].id)
  const [filterType, setFilterType] = useState('All')
  const [search, setSearch] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)

  const selectedAlert = alerts.find(a => a.id === selectedAlertId)

  // Filtering
  const filteredAlerts = alerts.filter((a: any) => {
    const matchType = filterType === 'All' || a.type === filterType
    const matchSearch = a.message.toLowerCase().includes(search.toLowerCase()) || a.category.toLowerCase().includes(search.toLowerCase())
    return matchType && matchSearch
  })

  // Counts
  const criticalCount = alerts.filter((a: any) => a.type === 'Critical').length
  const warningCount = alerts.filter((a: any) => a.type === 'Warning').length
  const infoCount = alerts.filter((a: any) => a.type === 'Info').length

  const handleAction = (id: string, action: string) => {
    if (action === 'delete') {
      setAlerts(alerts.filter((a: any) => a.id !== id))
    } else {
      setAlerts(alerts.map((a: any) => a.id === id ? { ...a, status: action } : a))
    }
  }

  const handleGenerateSuggestion = async (alert: any) => {
    if (!import.meta.env.VITE_ANTHROPIC_API_KEY || import.meta.env.VITE_ANTHROPIC_API_KEY === 'your_api_key_here') {
      window.alert("Please set your real VITE_ANTHROPIC_API_KEY in the .env file!");
      return;
    }
    
    setIsGenerating(true);
    try {
      const anthropic = new Anthropic({
        apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY,
        dangerouslyAllowBrowser: true
      });
      
      const response = await anthropic.messages.create({
        model: "claude-3-haiku-20240307",
        max_tokens: 150,
        system: "You are the AI brain of Antigravity, an intelligent inventory & system management dashboard. Provide a concise, 1-2 sentence smart suggestion to resolve the alert.",
        messages: [
          { role: "user", content: `Alert Category: ${alert.category}\nAlert Message: ${alert.message}\nAlert Detail: ${alert.detail}` }
        ]
      });
      
      const newSuggestion = (response.content[0] as any).text;
      setAlerts(alerts.map((a: any) => a.id === alert.id ? { ...a, suggestion: newSuggestion } : a));
    } catch (error) {
      console.error("Failed to generate AI suggestion:", error);
      window.alert("Failed to generate suggestion. See console for details.");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="page-enter">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>Alerts & System Control</h1>
          <p>Real-time system status, warnings, and AI recommendations</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(34,211,168,0.1)', border: '1px solid rgba(34,211,168,0.2)', padding: '6px 14px', borderRadius: 99, color: '#22d3a8', fontSize: 13, fontWeight: 600 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22d3a8', animation: 'pulse 2s infinite' }} />
          Live Updates ON
        </div>
      </div>

      {/* A. Alert Summary Cards */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 24 }}>
        {[
          { type: 'Critical', count: criticalCount, label: 'Critical Alerts', desc: 'Out of stock, Failures', color: '#f43f5e', icon: AlertCircle },
          { type: 'Warning', count: warningCount, label: 'Warnings', desc: 'Low stock, Delays', color: '#f59e0b', icon: AlertTriangle },
          { type: 'Info', count: infoCount, label: 'Info Alerts', desc: 'New orders, AI insights', color: '#00D4FF', icon: Info },
        ].map(s => (
          <div key={s.type} className="stat-card" style={{ '--card-glow': `${s.color}33` } as any} onClick={() => setFilterType(s.type === filterType ? 'All' : s.type)}>
            <div className="stat-card-icon"><s.icon size={18} color={s.color} /></div>
            <div className="stat-card-label" style={{ color: s.color }}>{s.label}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="stat-card-value">{s.count}</span>
              <span style={{ fontSize: 13, color: 'var(--clr-text-muted)' }}>{s.desc}</span>
            </div>
          </div>
        ))}
      </div>

      {/* B. Filters & Controls */}
      <div className="glass-card mb-4" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', position: 'relative', zIndex: 100 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--clr-text-muted)' }} />
          <input
            className="glass-input"
            style={{ paddingLeft: 34, width: '100%' }}
            placeholder="Search alerts by product or issue..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <GlassSelect
            value={filterType}
            onChange={(val) => setFilterType(val)}
            style={{ width: 140 }}
            options={[
              { value: 'All', label: 'All Types' },
              { value: 'Critical', label: 'Critical' },
              { value: 'Warning', label: 'Warning' },
              { value: 'Info', label: 'Info' }
            ]}
          />
          <button className="btn btn-ghost"><Calendar size={14} /> Date Range</button>
          <button className="btn btn-ghost"><Filter size={14} /> More Filters</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* C. Main Alert List */}
        <div className="glass-card" style={{ flex: 2 }}>
          <div className="section-title">Alert Log</div>
          <table className="data-table">
            <thead>
              <tr><th>Type</th><th>Category</th><th>Message</th><th>Time</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {filteredAlerts.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--clr-text-muted)' }}>No alerts found.</td></tr>
              ) : filteredAlerts.map((a: any) => {
                const Icon = iconMap[a.type]
                const isSel = selectedAlertId === a.id
                return (
                  <tr key={a.id} onClick={() => setSelectedAlertId(a.id)} style={{ cursor: 'pointer', background: isSel ? 'rgba(255,255,255,0.05)' : undefined }}>
                    <td>
                      <span className="badge" style={{ background: `${colorMap[a.type]}22`, color: colorMap[a.type] }}>
                        <Icon size={12} /> {a.type}
                      </span>
                    </td>
                    <td style={{ color: 'var(--clr-text-muted)', fontSize: 12 }}>{a.category}</td>
                    <td style={{ fontWeight: isSel ? 600 : 500 }}>{a.message}</td>
                    <td style={{ color: 'var(--clr-text-muted)', fontSize: 12 }}>{a.time}</td>
                    <td><span className={`badge ${a.status === 'Resolved' ? 'badge-success' : a.status === 'Read' ? 'badge-info' : 'badge-accent'}`}>{a.status}</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: 8, opacity: isSel ? 1 : 0.6 }}>
                        <button className="btn btn-ghost" style={{ padding: 4 }} title="Mark Read" onClick={(e) => { e.stopPropagation(); handleAction(a.id, 'Read') }}><Check size={14} /></button>
                        <button className="btn btn-ghost" style={{ padding: 4 }} title="Resolve" onClick={(e) => { e.stopPropagation(); handleAction(a.id, 'Resolved') }}><CheckCircle size={14} /></button>
                        <button className="btn btn-ghost text-danger" style={{ padding: 4 }} title="Delete" onClick={(e) => { e.stopPropagation(); handleAction(a.id, 'delete') }}><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* D & E. Alert Detail Panel + AI Smart Suggestions */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {selectedAlert ? (
            <div className="glass-card" style={{ border: `1px solid ${colorMap[selectedAlert.type]}44` }}>
              <div className="section-title" style={{ color: colorMap[selectedAlert.type], borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 12 }}>
                Alert Details ({selectedAlert.type})
              </div>
              <div style={{ padding: '4px 0 16px 0' }}>
                <p style={{ fontSize: 11, color: 'var(--clr-text-muted)', textTransform: 'uppercase' }}>Issue Category</p>
                <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{selectedAlert.category}</p>

                <p style={{ fontSize: 11, color: 'var(--clr-text-muted)', textTransform: 'uppercase' }}>Description</p>
                <p style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 12 }}>{selectedAlert.detail}</p>
              </div>

              {/* AI Smart Suggestions Panel */}
              <div style={{ background: 'rgba(0, 212, 255, 0.08)', borderRadius: 'var(--r-md)', padding: 16, border: '1px solid rgba(0, 212, 255, 0.2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#00D4FF', fontWeight: 600, fontSize: 14 }}>
                    <Zap size={16} /> AI Suggestion
                  </div>
                  <button 
                    className="btn btn-ghost" 
                    style={{ fontSize: 12, padding: '4px 10px', height: 'auto', minHeight: 24, border: '1px solid rgba(0,212,255,0.3)', color: '#00D4FF' }}
                    onClick={() => handleGenerateSuggestion(selectedAlert)}
                    disabled={isGenerating}
                  >
                    {isGenerating ? 'Analyzing...' : 'Ask Claude Brain'}
                  </button>
                </div>
                <p style={{ fontSize: 13, color: 'var(--clr-text-muted)', lineHeight: 1.6, marginBottom: 12 }}>
                  {selectedAlert.suggestion}
                </p>
                {selectedAlert.status !== 'Resolved' && (
                  <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => handleAction(selectedAlert.id, 'Resolved')}>
                    Approve & Resolve
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, opacity: 0.5 }}>
              <Bell size={32} color="var(--clr-text-muted)" style={{ marginBottom: 12 }} />
              <p>Select an alert to view details</p>
            </div>
          )}

          <div className="glass-card">
            <div className="section-title">Automated Workflows</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" defaultChecked /> Auto-notify warehouse on Low Stock
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" defaultChecked /> Weekly Alert Digest via Email
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" /> Push Notifications to Mobile UI
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
