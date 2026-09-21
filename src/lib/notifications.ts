import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'

export interface AppNotification {
  id: string
  category: 'inventory' | 'procurement' | 'payment' | 'agent' | 'reminder'
  severity: 'critical' | 'warning' | 'info'
  title: string
  body: string | null
  link: string | null
  entity_type: string | null
  entity_id: string | null
  created_at: string
  read_at: string | null
  /**
   * Non-null once the underlying condition is handled. Deliberately separate
   * from read_at: read = "this reached a human", resolved = "this is dealt
   * with". The bell cares about the former, the Alerts page about the latter.
   */
  resolved_at: string | null
}

/** Resolved > Read > New. What the Alerts page shows in its Status column. */
export type AlertStatus = 'Resolved' | 'Read' | 'New'

export function statusOf(n: AppNotification): AlertStatus {
  if (n.resolved_at) return 'Resolved'
  if (n.read_at) return 'Read'
  return 'New'
}

export const NOTIFICATION_CATEGORIES = [
  {
    key: 'inventory',
    label: 'Inventory',
    desc: 'A product crosses into low stock or runs out.',
    color: '#f43f5e',
  },
  {
    key: 'procurement',
    label: 'Purchase Orders',
    desc: 'A purchase order is raised, by you or by the restock agent.',
    color: '#f59e0b',
  },
  {
    key: 'payment',
    label: 'Payments',
    desc: 'A vendor bill is settled or a salary is paid.',
    color: '#22d3a8',
  },
  {
    key: 'agent',
    label: 'Agent Activity',
    desc: 'An autonomous agent acts. Daily runs that do nothing stay silent.',
    color: '#a78bfa',
  },
  {
    key: 'reminder',
    label: 'Reminders',
    desc: 'A reminder you set in the calendar comes due.',
    color: '#00D4FF',
  },
] as const

/**
 * Reads the notification feed and keeps it live.
 *
 * Rows are written by database triggers (migration 016), so an event is
 * recorded whichever path caused it — the UI, an agent, the admin console or
 * raw SQL. This hook only reads and marks them seen.
 */
/**
 * Realtime topics must be unique per subscriber.
 *
 * This hook is mounted twice at once on the Alerts page — the bell lives in
 * the Topbar, which renders on every route. A hardcoded topic meant both
 * instances claimed the same channel: the second subscribe is rejected as a
 * duplicate, and whichever unmounts first tears the subscription out from
 * under the other. Each instance gets its own topic instead.
 */
let channelSeq = 0

export function useNotifications(limit = 30) {
  const [items, setItems] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)

  const topic = useRef<string>()
  if (!topic.current) topic.current = `notifications-live-${++channelSeq}`

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
    setItems((data as AppNotification[]) || [])
    setLoading(false)
  }, [limit])

  useEffect(() => { load() }, [load])

  // The callback is read through a ref so a changing `load` identity cannot
  // tear down and rebuild the channel — resubscribing on every render would
  // drop events in the gap.
  const loadRef = useRef(load)
  useEffect(() => { loadRef.current = load }, [load])

  useEffect(() => {
    const ch = supabase
      .channel(topic.current!)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' },
          () => { loadRef.current() })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  // Resolving writes read_at too, so an unresolved check is strictly redundant
  // here — it is stated anyway so the badge stays correct if a row is ever
  // resolved directly in SQL without its read_at being set.
  const unread = items.filter(n => !n.read_at && !n.resolved_at)
  /** Still outstanding. The bell's inbox, and the Alerts page's default view. */
  const open = items.filter(n => !n.resolved_at)

  /**
   * Marks one notification seen.
   *
   * Local state moves first so the row de-highlights on the click rather than
   * after a network round trip; the write follows. A failed write is corrected
   * by the next realtime event or reload, which is preferable to a bell badge
   * that lags every interaction.
   */
  const markRead = useCallback(async (id: string) => {
    const now = new Date().toISOString()
    setItems(prev => prev.map(n => (n.id === id && !n.read_at ? { ...n, read_at: now } : n)))
    await supabase.from('notifications').update({ read_at: now }).eq('id', id).is('read_at', null)
  }, [])

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString()
    const ids = items.filter(n => !n.read_at).map(n => n.id)
    if (ids.length === 0) return
    setItems(prev => prev.map(n => (n.read_at ? n : { ...n, read_at: now })))
    await supabase.from('notifications').update({ read_at: now }).in('id', ids)
  }, [items])

  /**
   * Marks notifications handled.
   *
   * read_at is set alongside resolved_at because resolving something implies
   * having seen it, and leaving it unread would keep it in the bell badge
   * after the Alerts page had already closed it — the two surfaces would
   * disagree about the same row.
   *
   * Optimistic like markRead, and for the same reason: the row should change
   * on the click. A failed write is corrected by the next realtime event.
   */
  const resolve = useCallback(async (ids: string | string[]) => {
    const list = Array.isArray(ids) ? ids : [ids]
    if (list.length === 0) return
    const now = new Date().toISOString()
    setItems(prev => prev.map(n =>
      list.includes(n.id) ? { ...n, resolved_at: n.resolved_at ?? now, read_at: n.read_at ?? now } : n
    ))
    await supabase
      .from('notifications')
      .update({ resolved_at: now, read_at: now })
      .in('id', list)
      .is('resolved_at', null)
  }, [])

  /** Reopens a resolved alert. Leaves read_at alone — it was still seen. */
  const unresolve = useCallback(async (id: string) => {
    setItems(prev => prev.map(n => (n.id === id ? { ...n, resolved_at: null } : n)))
    await supabase.from('notifications').update({ resolved_at: null }).eq('id', id)
  }, [])

  const remove = useCallback(async (id: string) => {
    setItems(prev => prev.filter(n => n.id !== id))
    await supabase.from('notifications').delete().eq('id', id)
  }, [])

  return {
    items, unread, open, loading,
    markRead, markAllRead, resolve, unresolve, remove, reload: load,
  }
}

/** "3m ago" / "2h ago" / "5d ago" — a feed reads better in relative time. */
export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(diff) || diff < 0) return 'just now'
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d < 30 ? `${d}d ago` : `${Math.floor(d / 30)}mo ago`
}
