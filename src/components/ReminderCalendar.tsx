import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft, ChevronRight, Plus, Trash2, Check, Clock as ClockIcon, Bell, X,
} from 'lucide-react'
import { useLocale } from '../lib/locale'
import {
  useReminders, dateKeyInTz, zonedToUtc, todayKey, Reminder,
} from '../lib/reminders'

const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

/** Grid of 42 day-cells (6 weeks) covering the month, Monday-first. */
function monthGrid(year: number, month: number): { key: string; inMonth: boolean }[] {
  const first = new Date(Date.UTC(year, month, 1))
  // getUTCDay is 0=Sun; shift so Monday is 0.
  const lead = (first.getUTCDay() + 6) % 7
  const start = new Date(Date.UTC(year, month, 1 - lead))
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start.getTime() + i * 86400000)
    return {
      key: d.toISOString().slice(0, 10),
      inMonth: d.getUTCMonth() === month,
    }
  })
}

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December']

export default function ReminderCalendar({ onClose }: { onClose: () => void }) {
  const { timezone, fmtTime } = useLocale()
  const { items, add, setDone, remove } = useReminders()

  const today = todayKey(timezone)
  const [selected, setSelected] = useState(today)
  const [cursor, setCursor] = useState(() => {
    const [y, m] = today.split('-').map(Number)
    return { year: y, month: m - 1 }
  })

  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [time, setTime] = useState('09:00')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const titleRef = useRef<HTMLInputElement>(null)

  // Reminders bucketed by the calendar day they fall on *in the chosen
  // timezone* — not UTC, or an evening reminder would show on the wrong square.
  const byDay = useMemo(() => {
    const map: Record<string, Reminder[]> = {}
    for (const r of items) {
      const k = dateKeyInTz(r.remind_at, timezone)
      ;(map[k] ||= []).push(r)
    }
    return map
  }, [items, timezone])

  const grid = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor])
  const dayItems = byDay[selected] || []

  const upcoming = useMemo(
    () => items
      .filter(r => !r.done_at && new Date(r.remind_at).getTime() >= Date.now())
      .slice(0, 3),
    [items],
  )

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || busy) return
    const at = zonedToUtc(selected, time, timezone)
    if (isNaN(at.getTime())) { setErr('That date and time could not be read.'); return }
    setBusy(true); setErr(null)
    try {
      await add(title, note, at)
      setTitle(''); setNote('')
      titleRef.current?.focus()
    } catch (e: any) {
      setErr(e?.message || 'The reminder could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const moveMonth = (delta: number) => setCursor(c => {
    const d = new Date(Date.UTC(c.year, c.month + delta, 1))
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() }
  })

  // A reminder whose moment has passed but was never ticked off.
  const isOverdue = (r: Reminder) =>
    !r.done_at && new Date(r.remind_at).getTime() < Date.now()

  const prettyDay = (key: string) => {
    const [y, m, d] = key.split('-').map(Number)
    return `${MONTHS[m - 1]} ${d}, ${y}`
  }

  return (
    <div style={{
      position: 'absolute', top: 46, right: 0, zIndex: 9000,
      width: 'min(680px, calc(100vw - 24px))',
      maxHeight: 'min(560px, calc(100vh - var(--topbar-h) - 24px))',
      display: 'flex', flexDirection: 'column', borderRadius: 14, overflow: 'hidden',
      background: 'rgba(8,11,24,0.97)', backdropFilter: 'blur(22px)',
      border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 24px 70px rgba(0,0,0,0.65)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0,
      }}>
        <Bell size={14} color="#6C63FF" />
        <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Reminders</span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{timezone.replace('_', ' ')}</span>
        <button onClick={onClose} aria-label="Close"
          style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'rgba(255,255,255,0.45)', cursor: 'pointer', padding: 2, display: 'flex' }}>
          <X size={16} />
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0, flexWrap: 'wrap' }}>
        {/* ── Month grid ── */}
        <div style={{ flex: '1 1 300px', minWidth: 0, padding: 14, borderRight: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <button onClick={() => moveMonth(-1)} aria-label="Previous month"
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.55)', cursor: 'pointer', display: 'flex', padding: 4 }}>
              <ChevronLeft size={16} />
            </button>
            <span style={{ flex: 1, textAlign: 'center', fontSize: 12.5, fontWeight: 700, color: '#fff' }}>
              {MONTHS[cursor.month]} {cursor.year}
            </span>
            <button onClick={() => moveMonth(1)} aria-label="Next month"
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.55)', cursor: 'pointer', display: 'flex', padding: 4 }}>
              <ChevronRight size={16} />
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
            {DOW.map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: 9.5, color: 'rgba(255,255,255,0.3)', fontWeight: 700, letterSpacing: '0.04em' }}>{d}</div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {grid.map(({ key, inMonth }) => {
              const dayNum = Number(key.slice(8, 10))
              const marks = byDay[key] || []
              const open = marks.filter(r => !r.done_at).length
              const isToday = key === today
              const isSel = key === selected
              return (
                <button key={key} onClick={() => setSelected(key)}
                  style={{
                    position: 'relative', aspectRatio: '1', borderRadius: 8, cursor: 'pointer',
                    fontSize: 11.5, fontWeight: isToday ? 800 : 500,
                    background: isSel ? 'rgba(108,99,255,0.3)' : 'transparent',
                    border: `1px solid ${isSel ? 'rgba(108,99,255,0.6)' : isToday ? 'rgba(34,211,168,0.45)' : 'transparent'}`,
                    color: !inMonth ? 'rgba(255,255,255,0.2)' : isToday ? '#22d3a8' : '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
                  onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                >
                  {dayNum}
                  {marks.length > 0 && (
                    <span style={{
                      position: 'absolute', bottom: 3, left: '50%', transform: 'translateX(-50%)',
                      width: 4, height: 4, borderRadius: '50%',
                      background: open > 0 ? '#f59e0b' : 'rgba(34,211,168,0.7)',
                    }} />
                  )}
                </button>
              )
            })}
          </div>

          {upcoming.length > 0 && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
              <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.3)', fontWeight: 700, letterSpacing: '0.05em', marginBottom: 6 }}>COMING UP</div>
              {upcoming.map(r => (
                <button key={r.id}
                  onClick={() => {
                    const k = dateKeyInTz(r.remind_at, timezone)
                    setSelected(k)
                    const [y, m] = k.split('-').map(Number)
                    setCursor({ year: y, month: m - 1 })
                  }}
                  style={{
                    display: 'flex', gap: 7, alignItems: 'baseline', width: '100%', textAlign: 'left',
                    background: 'none', border: 'none', cursor: 'pointer', padding: '3px 0', color: 'inherit',
                  }}>
                  <span style={{ fontSize: 10, color: '#6C63FF', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {dateKeyInTz(r.remind_at, timezone).slice(5).replace('-', '/')}
                  </span>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.title}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Selected day ── */}
        <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '12px 14px 8px', fontSize: 12.5, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
            {prettyDay(selected)}
            {selected === today && <span style={{ fontSize: 10, color: '#22d3a8', marginLeft: 7 }}>Today</span>}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '0 14px', minHeight: 60 }}>
            {dayItems.length === 0 ? (
              <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.3)', padding: '12px 0' }}>
                Nothing for this day. Add one below.
              </div>
            ) : dayItems
              .slice()
              .sort((a, b) => a.remind_at.localeCompare(b.remind_at))
              .map(r => (
                <div key={r.id} style={{
                  display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 0',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                  opacity: r.done_at ? 0.45 : 1,
                }}>
                  <button onClick={() => setDone(r.id, !r.done_at)}
                    title={r.done_at ? 'Mark not done' : 'Mark done'}
                    style={{
                      flexShrink: 0, marginTop: 1, width: 16, height: 16, borderRadius: 5, cursor: 'pointer',
                      background: r.done_at ? 'rgba(34,211,168,0.25)' : 'transparent',
                      border: `1px solid ${r.done_at ? 'rgba(34,211,168,0.6)' : 'rgba(255,255,255,0.25)'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                    }}>
                    {r.done_at && <Check size={11} color="#22d3a8" />}
                  </button>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 12, fontWeight: 600, color: '#fff',
                      textDecoration: r.done_at ? 'line-through' : 'none',
                    }}>{r.title}</div>
                    {r.note && (
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2, lineHeight: 1.4 }}>{r.note}</div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
                      <ClockIcon size={9} color={isOverdue(r) ? '#f59e0b' : 'rgba(255,255,255,0.3)'} />
                      <span style={{ fontSize: 10, color: isOverdue(r) ? '#f59e0b' : 'rgba(255,255,255,0.35)' }}>
                        {fmtTime(r.remind_at)}
                        {r.notified_at ? ' · notified' : isOverdue(r) ? ' · overdue' : ''}
                      </span>
                    </div>
                  </div>

                  <button onClick={() => remove(r.id)} aria-label="Delete reminder"
                    style={{ flexShrink: 0, background: 'none', border: 'none', color: 'rgba(244,63,94,0.55)', cursor: 'pointer', padding: 2, display: 'flex' }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
          </div>

          <form onSubmit={submit} style={{
            flexShrink: 0, padding: 12, borderTop: '1px solid rgba(255,255,255,0.07)',
            display: 'flex', flexDirection: 'column', gap: 7,
          }}>
            <div style={{ display: 'flex', gap: 7 }}>
              <input
                ref={titleRef}
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="What should I remind you about?"
                className="glass-input"
                style={{ flex: 1, minWidth: 0, fontSize: 12, padding: '7px 10px' }}
              />
              <input
                type="time"
                value={time}
                onChange={e => setTime(e.target.value)}
                className="glass-input"
                style={{ width: 104, fontSize: 12, padding: '7px 8px' }}
              />
            </div>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Note (optional)"
              className="glass-input"
              style={{ fontSize: 12, padding: '7px 10px' }}
            />
            {err && <div style={{ fontSize: 11, color: '#f43f5e' }}>{err}</div>}
            <button type="submit" disabled={!title.trim() || busy}
              style={{
                padding: '8px', borderRadius: 9, fontSize: 12, fontWeight: 700,
                background: title.trim() ? 'rgba(108,99,255,0.22)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${title.trim() ? 'rgba(108,99,255,0.5)' : 'rgba(255,255,255,0.1)'}`,
                color: title.trim() ? '#a78bfa' : 'rgba(255,255,255,0.3)',
                cursor: title.trim() && !busy ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
              <Plus size={13} /> {busy ? 'Saving…' : `Remind me on ${prettyDay(selected)}`}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
