import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'

export interface Reminder {
  id: string
  title: string
  note: string | null
  remind_at: string
  created_at: string
  notified_at: string | null
  done_at: string | null
}

/**
 * The calendar day a given instant falls on, in the chosen timezone.
 *
 * 'en-CA' formats as YYYY-MM-DD, which is both the key the calendar grid uses
 * and the value an <input type="date"> expects — so the same string works as
 * a map key and as form state.
 */
export function dateKeyInTz(value: Date | string, tz: string): string {
  return new Date(value).toLocaleDateString('en-CA', { timeZone: tz })
}

/**
 * Turns a wall-clock date and time in `tz` into the absolute instant it names.
 *
 * "9:00 AM on the 25th" is not a point in time until you say where, and the
 * user is picking a time in whichever zone Settings is set to — which may not
 * be the browser's. Reading the form value with `new Date('2026-09-25T09:00')`
 * would silently interpret it in the *browser's* zone and fire the reminder at
 * the wrong moment for anyone whose Settings zone differs.
 *
 * The trick: read the naive value as if it were UTC, ask what wall-clock time
 * that instant shows in `tz`, and subtract the difference. Exact except when a
 * DST transition lands inside the hour being named, where an hour that occurs
 * twice (or not at all) has no single right answer anyway.
 */
export function zonedToUtc(dateStr: string, timeStr: string, tz: string): Date {
  const naive = new Date(`${dateStr}T${timeStr}:00Z`)
  if (isNaN(naive.getTime())) return new Date(NaN)
  const asTz = new Date(naive.toLocaleString('en-US', { timeZone: tz }))
  const asUtc = new Date(naive.toLocaleString('en-US', { timeZone: 'UTC' }))
  return new Date(naive.getTime() - (asTz.getTime() - asUtc.getTime()))
}

/** Today's date key in `tz`, for defaulting the form and marking "today". */
export function todayKey(tz: string): string {
  return dateKeyInTz(new Date(), tz)
}

let channelSeq = 0

/**
 * Reads and writes the reminder list, kept live.
 *
 * Firing is not this hook's job — a scheduled database job (migration 030)
 * turns a due reminder into a notification, so it arrives whether or not the
 * app is open. This only manages the entries.
 */
export function useReminders() {
  const [items, setItems] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(true)

  // Unique per instance: a hardcoded topic breaks when the hook mounts twice.
  const topic = useRef<string>()
  if (!topic.current) topic.current = `reminders-live-${++channelSeq}`

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('reminders')
      .select('*')
      .order('remind_at', { ascending: true })
    setItems((data as Reminder[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const loadRef = useRef(load)
  useEffect(() => { loadRef.current = load }, [load])

  useEffect(() => {
    const ch = supabase
      .channel(topic.current!)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reminders' },
          () => { loadRef.current() })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  const add = useCallback(async (title: string, note: string, remindAt: Date) => {
    const { error } = await supabase.from('reminders').insert({
      title: title.trim(),
      note: note.trim() || null,
      remind_at: remindAt.toISOString(),
    })
    if (error) throw error
    await load()
  }, [load])

  /**
   * Marks a reminder done. Clearing notified_at as well means an entry that
   * was ticked off before it fired will not fire later if it is reopened.
   */
  const setDone = useCallback(async (id: string, done: boolean) => {
    setItems(prev => prev.map(r =>
      r.id === id ? { ...r, done_at: done ? new Date().toISOString() : null } : r))
    const { error } = await supabase.from('reminders')
      .update({ done_at: done ? new Date().toISOString() : null })
      .eq('id', id)
    if (error) throw error
    await load()
  }, [load])

  const remove = useCallback(async (id: string) => {
    setItems(prev => prev.filter(r => r.id !== id))
    const { error } = await supabase.from('reminders').delete().eq('id', id)
    if (error) throw error
    await load()
  }, [load])

  return { items, loading, add, setDone, remove, reload: load }
}
