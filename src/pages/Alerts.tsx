import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell, AlertTriangle, AlertCircle, Info, Search, Check, CheckCircle, Trash2, Zap,
  Package, ShoppingCart, DollarSign, ArrowRight, RotateCcw, CheckCheck, ChevronLeft, ChevronRight,
} from 'lucide-react'
import GlassSelect from '../components/GlassSelect'
import Anthropic from '@anthropic-ai/sdk'
import { supabase } from '../lib/supabaseClient'
import { useNotifications, statusOf, timeAgo, AppNotification } from '../lib/notifications'

/**
 * Alerts reads `public.notifications` — the same table the bell in the topbar
 * reads. It used to merge live `inventory` rows with five hardcoded mock alerts
 * and keep resolution in React state, which is why nothing could be resolved:
 * the realtime subscription rebuilt the array on the next tick and every
 * status change reverted. Resolution now lives in the database (migration 025)
 * and the two surfaces stay in step by construction.
 */

const SEVERITY = {
  critical: { label: 'Critical', color: '#f43f5e', icon: AlertCircle },
  warning:  { label: 'Warning',  color: '#f59e0b', icon: AlertTriangle },
  info:     { label: 'Info',     color: '#00D4FF', icon: Info },
} as const

const CATEGORY = {
  inventory:   { label: 'Inventory',   icon: Package },
  procurement: { label: 'Procurement', icon: ShoppingCart },
  payment:     { label: 'Payment',     icon: DollarSign },
  agent:       { label: 'Agent',       icon: Zap },
} as const

const PAGE_SIZE = 12

/**
 * What to actually do about an alert, and where that happens.
 *
 * Written per category rather than per row so the panel is useful with no
 * network call and no API key — "Ask Claude Brain" refines this, it is not
 * required to get an answer.
 */
function playbook(n: AppNotification): { action: string; cta: string } {
  switch (n.category) {
    case 'inventory':
      return n.severity === 'critical'
        ? { action: 'This product is out of stock and cannot be sold. Raise a restock order now — the alert closes itself once stock is back above the reorder level.', cta: 'Open Restock' }
        : { action: 'Stock is at or below the reorder level. Order before it runs out; the alert closes itself once stock recovers.', cta: 'Open Restock' }
    case 'procurement':
      return { action: 'A purchase order was raised. Confirm it is wanted, or cancel it if the restock agent over-ordered — cancelling closes this alert automatically.', cta: 'Review Orders' }
    case 'payment':
      return { action: 'Money moved. Check it against the cash balance and the vendor bill it settles.', cta: 'Open Payments' }
    case 'agent':
      return { action: 'An autonomous agent acted on its own. Review what it did and confirm it was correct.', cta: 'Review Activity' }
    default:
      return { action: 'Review the detail above and take the appropriate action.', cta: 'Open' }
  }
}

export default function Alerts() {
  // 300 rather than the bell's 30: this is the full log, not a dropdown.
  const { items, loading, markRead, resolve, unresolve, remove } = useNotifications(300)
  const navigate = useNavigate()

  const [severity, setSeverity] = useState('All')
  const [category, setCategory] = useState('All')
  const [statusFilter, setStatusFilter] = useState('Open')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [page, setPage] = useState(0)

  const [suggestions, setSuggestions] = useState<Record<string, string>>({})
  const [isGenerating, setIsGenerating] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [liveStock, setLiveStock] = useState<{ stock: number; reorder: number } | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter(n => {
      if (severity !== 'All' && n.severity !== severity) return false
      if (category !== 'All' && n.category !== category) return false
      if (statusFilter === 'Open' && n.resolved_at) return false
      if (statusFilter === 'Resolved' && !n.resolved_at) return false
      if (!q) return true
      return (
        n.title.toLowerCase().includes(q) ||
        (n.body || '').toLowerCase().includes(q) ||
        n.category.toLowerCase().includes(q)
      )
    })
  }, [items, severity, category, statusFilter, search])

  // Any filter change invalidates the current page offset.
  useEffect(() => { setPage(0) }, [severity, category, statusFilter, search])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  /**
   * Keeps the detail panel and the list in agreement.
   *
   * The old page seeded the selection once and never reconciled it, so setting
   * the filter to Critical left the panel showing the Info alert it had picked
   * at mount — the header read "Alert Details (Info)" above a list containing
   * only a Critical row. Selecting the first visible row whenever the current
   * one is filtered away keeps the two from drifting apart.
   */
  useEffect(() => {
    if (filtered.length === 0) { setSelectedId(null); return }
    if (!selectedId || !filtered.some(n => n.id === selectedId)) {
      setSelectedId(filtered[0].id)
    }
  }, [filtered, selectedId])

  const selected = items.find(n => n.id === selectedId) || null

  // Counts describe what is still outstanding — a resolved alert is not a
  // number anyone needs on a summary card.
  const openItems = items.filter(n => !n.resolved_at)
  const counts = {
    critical: openItems.filter(n => n.severity === 'critical').length,
    warning:  openItems.filter(n => n.severity === 'warning').length,
    info:     openItems.filter(n => n.severity === 'info').length,
  }

  /**
   * For a stock alert, says whether the thing is still true.
   *
   * An alert is a snapshot of a past moment; the panel should not advise
   * ordering a product that has since been restocked.
   */
  // Keyed on the id, not the object: every realtime reload replaces `items`
  // with fresh objects, so depending on `selected` itself would refetch and
  // blank this panel on every unrelated notification change.
  const selectedKey = selected && selected.category === 'inventory' ? selected.entity_id : null

  useEffect(() => {
    let cancelled = false
    setLiveStock(null)
    if (!selectedKey) return
    ;(async () => {
      const { data } = await supabase
        .from('inventory')
        .select('current_stock, reorder_level')
        .eq('product_id', Number(selectedKey))
        .maybeSingle()
      if (!cancelled && data) {
        setLiveStock({ stock: (data as any).current_stock, reorder: (data as any).reorder_level })
      }
    })()
    return () => { cancelled = true }
  }, [selectedKey])

  // Opening an alert counts as seeing it. Keyed on the id and guarded by a ref
  // so a realtime reload cannot re-issue the write for an alert already seen.
  const seenRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!selectedId || seenRef.current.has(selectedId)) return
    seenRef.current.add(selectedId)
    markRead(selectedId)
  }, [selectedId, markRead])

  const resolveVisible = async () => {
    const ids = filtered.filter(n => !n.resolved_at).map(n => n.id)
    if (ids.length === 0) return
    if (!window.confirm(`Resolve ${ids.length} alert${ids.length === 1 ? '' : 's'} matching the current filter?`)) return
    await resolve(ids)
  }

  const askClaude = async (n: AppNotification) => {
    const key = import.meta.env.VITE_ANTHROPIC_API_KEY
    if (!key || key === 'your_api_key_here') {
      setAiError('No VITE_ANTHROPIC_API_KEY is set in .env, so the AI suggestion cannot run. The recommended action above still applies.')
      return
    }
    setIsGenerating(true)
    setAiError(null)
    try {
      const anthropic = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true })
      const stockLine = liveStock
        ? `\nCurrent stock: ${liveStock.stock} (reorder level ${liveStock.reorder})`
        : ''
      const res = await anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 200,
        system: 'You advise the operator of an inventory management system. Given one alert, reply with a concise, concrete recommendation in 1-2 sentences. No preamble.',
        messages: [{
          role: 'user',
          content: `Category: ${n.category}\nSeverity: ${n.severity}\nAlert: ${n.title}\nDetail: ${n.body || '(none)'}${stockLine}`,
        }],
      })
      const text = (res.content[0] as any)?.text
      if (text) setSuggestions(prev => ({ ...prev, [n.id]: text }))
    } catch (err: any) {
      console.error('AI suggestion failed:', err)
      setAiError(err?.message || 'The AI suggestion request failed. See the console for details.')
    } finally {
      setIsGenerating(false)
    }
  }

  const sevMeta = selected ? (SEVERITY as any)[selected.severity] ?? SEVERITY.info : SEVERITY.info
  const catMeta = selected ? (CATEGORY as any)[selected.category] : null
  const guide = selected ? playbook(selected) : null

  return (
    <div className="page-enter">
      <div className="page-header page-header-row">
        <div>
          <h1>Alerts &amp; System Control</h1>
          <p>Real-time system status, warnings, and AI recommendations</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(34,211,168,0.1)', border: '1px solid rgba(34,211,168,0.2)', padding: '6px 14px', borderRadius: 99, color: '#22d3a8', fontSize: 13, fontWeight: 600 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22d3a8', animation: 'pulse 2s infinite' }} />
          Live Updates ON
        </div>
      </div>

      {/* Summary cards — click to filter by severity, click again to clear. */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', marginBottom: 24 }}>
        {(['critical', 'warning', 'info'] as const).map(key => {
          const meta = SEVERITY[key]
          const active = severity === key
          const desc = key === 'critical' ? 'Out of stock, failures'
                     : key === 'warning'  ? 'Low stock, delays'
                     : 'Orders, payments, agents'
          return (
            <div key={key} className="stat-card"
              style={{
                '--card-glow': `${meta.color}33`, cursor: 'pointer',
                transition: 'box-shadow 0.25s ease, transform 0.18s ease',
                boxShadow: active ? `0 0 0 1px ${meta.color}99, 0 0 30px ${meta.color}55` : undefined,
              } as any}
              onClick={() => setSeverity(active ? 'All' : key)}
              onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = `0 0 0 1px ${meta.color}99, 0 0 30px ${meta.color}77, 0 0 60px ${meta.color}44`; el.style.transform = 'translateY(-2px)' }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = active ? `0 0 0 1px ${meta.color}99, 0 0 30px ${meta.color}55` : ''; el.style.transform = '' }}
            >
              <div className="stat-card-icon"><meta.icon size={18} color={meta.color} /></div>
              <div className="stat-card-label" style={{ color: meta.color }}>{meta.label} Alerts</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span className="stat-card-value">{counts[key]}</span>
                <span style={{ fontSize: 13, color: 'var(--clr-text-muted)' }}>{desc}</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Filters */}
      <div className="glass-card mb-4" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', position: 'relative', zIndex: 100 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--clr-text-muted)' }} />
          <input
            className="glass-input"
            style={{ paddingLeft: 34, width: '100%' }}
            placeholder="Search alerts by title, detail or category..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <GlassSelect
            value={statusFilter} onChange={setStatusFilter} style={{ width: 130 }}
            options={[
              { value: 'Open', label: 'Open' },
              { value: 'Resolved', label: 'Resolved' },
              { value: 'All', label: 'All Status' },
            ]}
          />
          <GlassSelect
            value={severity} onChange={setSeverity} style={{ width: 130 }}
            options={[
              { value: 'All', label: 'All Types' },
              { value: 'critical', label: 'Critical' },
              { value: 'warning', label: 'Warning' },
              { value: 'info', label: 'Info' },
            ]}
          />
          <GlassSelect
            value={category} onChange={setCategory} style={{ width: 150 }}
            options={[
              { value: 'All', label: 'All Categories' },
              { value: 'inventory', label: 'Inventory' },
              { value: 'procurement', label: 'Procurement' },
              { value: 'payment', label: 'Payment' },
              { value: 'agent', label: 'Agent' },
            ]}
          />
          <button
            className="btn btn-ghost"
            onClick={resolveVisible}
            disabled={filtered.every(n => n.resolved_at)}
            title="Resolve every alert matching the current filter"
          >
            <CheckCheck size={14} /> Resolve Filtered
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Alert log */}
        <div className="glass-card" style={{ flex: '2 1 460px', minWidth: 0 }}>
          <div className="section-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Alert Log</span>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--clr-text-muted)' }}>
              {filtered.length} {statusFilter === 'Open' ? 'open' : statusFilter === 'Resolved' ? 'resolved' : 'total'}
            </span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr><th>Type</th><th>Category</th><th>Alert</th><th>Time</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--clr-text-muted)' }}>Loading alerts…</td></tr>
                ) : visible.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--clr-text-muted)', padding: 28 }}>
                    {items.length === 0
                      ? 'Nothing yet. Low stock, purchase orders, payments and agent activity land here.'
                      : 'No alerts match these filters.'}
                  </td></tr>
                ) : visible.map(n => {
                  const meta = (SEVERITY as any)[n.severity] ?? SEVERITY.info
                  const cat = (CATEGORY as any)[n.category]
                  const isSel = selectedId === n.id
                  const status = statusOf(n)
                  return (
                    <tr key={n.id} onClick={() => setSelectedId(n.id)}
                      style={{
                        cursor: 'pointer',
                        background: isSel ? 'rgba(255,255,255,0.05)' : undefined,
                        opacity: n.resolved_at ? 0.55 : 1,
                      }}>
                      <td>
                        <span className="badge" style={{ background: `${meta.color}22`, color: meta.color }}>
                          <meta.icon size={12} /> {meta.label}
                        </span>
                      </td>
                      <td style={{ color: 'var(--clr-text-muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
                        {cat ? <><cat.icon size={11} style={{ verticalAlign: -1, marginRight: 4 }} />{cat.label}</> : n.category}
                      </td>
                      <td style={{ fontWeight: isSel ? 600 : 500 }}>
                        {n.title}
                        {n.body && (
                          <span style={{ display: 'block', fontSize: 11, color: 'var(--clr-text-muted)', marginTop: 2 }}>
                            {n.body}
                          </span>
                        )}
                      </td>
                      <td style={{ color: 'var(--clr-text-muted)', fontSize: 12, whiteSpace: 'nowrap' }}>{timeAgo(n.created_at)}</td>
                      <td>
                        <span className={`badge ${status === 'Resolved' ? 'badge-success' : status === 'Read' ? 'badge-info' : 'badge-accent'}`}>
                          {status}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {n.resolved_at ? (
                            <button className="btn btn-ghost" style={{ padding: 4 }} title="Reopen"
                              onClick={e => { e.stopPropagation(); unresolve(n.id) }}><RotateCcw size={14} /></button>
                          ) : (
                            <>
                              {!n.read_at && (
                                <button className="btn btn-ghost" style={{ padding: 4 }} title="Mark read"
                                  onClick={e => { e.stopPropagation(); markRead(n.id) }}><Check size={14} /></button>
                              )}
                              <button className="btn btn-ghost" style={{ padding: 4, color: '#22d3a8' }} title="Resolve"
                                onClick={e => { e.stopPropagation(); resolve(n.id) }}><CheckCircle size={14} /></button>
                            </>
                          )}
                          <button className="btn btn-ghost text-danger" style={{ padding: 4 }} title="Delete permanently"
                            onClick={e => { e.stopPropagation(); if (window.confirm('Delete this alert permanently?')) remove(n.id) }}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, gap: 12 }}>
              <span style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>
                Page {safePage + 1} of {pageCount}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost" disabled={safePage === 0}
                  onClick={() => setPage(p => Math.max(0, p - 1))}><ChevronLeft size={14} /> Prev</button>
                <button className="btn btn-ghost" disabled={safePage >= pageCount - 1}
                  onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}>Next <ChevronRight size={14} /></button>
              </div>
            </div>
          )}
        </div>

        {/* Detail panel */}
        <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          {selected && guide ? (
            <div className="glass-card" style={{ border: `1px solid ${sevMeta.color}44` }}>
              <div className="section-title" style={{ color: sevMeta.color, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <sevMeta.icon size={15} /> Alert Details ({sevMeta.label})
              </div>

              <div style={{ padding: '4px 0 14px 0' }}>
                <p style={{ fontSize: 11, color: 'var(--clr-text-muted)', textTransform: 'uppercase' }}>Issue Category</p>
                <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
                  {catMeta ? catMeta.label : selected.category}
                </p>

                <p style={{ fontSize: 11, color: 'var(--clr-text-muted)', textTransform: 'uppercase' }}>Alert</p>
                <p style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.45, marginBottom: 10 }}>{selected.title}</p>

                {selected.body && (
                  <>
                    <p style={{ fontSize: 11, color: 'var(--clr-text-muted)', textTransform: 'uppercase' }}>Description</p>
                    <p style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 12 }}>{selected.body}</p>
                  </>
                )}

                <div style={{ display: 'flex', gap: 18, fontSize: 12, color: 'var(--clr-text-muted)' }}>
                  <span>Raised {timeAgo(selected.created_at)}</span>
                  <span>Status: <strong style={{ color: selected.resolved_at ? '#22d3a8' : '#fff' }}>{statusOf(selected)}</strong></span>
                </div>

                {/* Is the condition still true? An alert is a snapshot; the
                    panel should not tell you to reorder something that has
                    already been restocked. */}
                {liveStock && (
                  <div style={{
                    marginTop: 12, padding: '10px 12px', borderRadius: 'var(--r-md)', fontSize: 12.5,
                    background: liveStock.stock > liveStock.reorder ? 'rgba(34,211,168,0.1)' : 'rgba(244,63,94,0.1)',
                    border: `1px solid ${liveStock.stock > liveStock.reorder ? 'rgba(34,211,168,0.28)' : 'rgba(244,63,94,0.28)'}`,
                    color: liveStock.stock > liveStock.reorder ? '#22d3a8' : '#f43f5e',
                  }}>
                    {liveStock.stock > liveStock.reorder
                      ? `Already fixed — stock is back to ${liveStock.stock}, above the reorder level of ${liveStock.reorder}.`
                      : `Still outstanding — stock is ${liveStock.stock}, reorder level ${liveStock.reorder}.`}
                  </div>
                )}
              </div>

              {/* Recommended action + AI refinement */}
              <div style={{ background: 'rgba(0, 212, 255, 0.08)', borderRadius: 'var(--r-md)', padding: 16, border: '1px solid rgba(0, 212, 255, 0.2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#00D4FF', fontWeight: 600, fontSize: 14 }}>
                    <Zap size={16} /> Recommended Action
                  </div>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 12, padding: '4px 10px', height: 'auto', minHeight: 24, border: '1px solid rgba(0,212,255,0.3)', color: '#00D4FF' }}
                    onClick={() => askClaude(selected)}
                    disabled={isGenerating}
                  >
                    {isGenerating ? 'Analyzing…' : 'Ask Claude Brain'}
                  </button>
                </div>

                <p style={{ fontSize: 13, color: 'var(--clr-text-muted)', lineHeight: 1.6, marginBottom: 12 }}>
                  {suggestions[selected.id] || guide.action}
                </p>

                {aiError && (
                  <p style={{ fontSize: 12, color: '#f59e0b', lineHeight: 1.5, marginBottom: 12 }}>{aiError}</p>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {selected.link && (
                    <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.14)' }}
                      onClick={() => navigate(selected.link!)}>
                      {guide.cta} <ArrowRight size={14} />
                    </button>
                  )}
                  {selected.resolved_at ? (
                    <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center' }}
                      onClick={() => unresolve(selected.id)}>
                      <RotateCcw size={14} /> Reopen Alert
                    </button>
                  ) : (
                    <button className="btn btn-primary" style={{ width: '100%' }}
                      onClick={() => resolve(selected.id)}>
                      <CheckCircle size={15} /> Mark Resolved
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, opacity: 0.5 }}>
              <Bell size={32} color="var(--clr-text-muted)" style={{ marginBottom: 12 }} />
              <p>Select an alert to view details</p>
            </div>
          )}

          <div className="glass-card">
            <div className="section-title">How Alerts Close</div>
            <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 7, fontSize: 12.5, color: 'var(--clr-text-muted)', lineHeight: 1.5 }}>
              <li>Stock alerts close themselves once stock is back above the reorder level.</li>
              <li>Purchase-order alerts close themselves when the order is cancelled.</li>
              <li>Anything else closes when you mark it resolved here.</li>
              <li>Resolved alerts leave the bell in the top bar immediately.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
