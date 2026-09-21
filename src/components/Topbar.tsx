import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import NotificationBell from './NotificationBell'
import ReminderCalendar from './ReminderCalendar'
import { useLocale, TIMEZONES } from '../lib/locale'
import { useBrand } from '../lib/brand'

export interface TopbarSection { path: string; label: string }

/**
 * Longest-prefix match, so a detail route (/admin/owners/:id) still resolves to
 * the section it belongs to rather than falling back to the home label.
 */
function sectionFor(pathname: string, sections: TopbarSection[]): string {
  let best: TopbarSection | null = null
  for (const s of sections) {
    if (pathname === s.path || pathname.startsWith(s.path + '/')) {
      if (!best || s.path.length > best.path.length) best = s
    }
  }
  return best?.label ?? ''
}

/**
 * Time of day in the timezone chosen in Settings, refreshed on the minute.
 * Doubles as the entry point to the reminder calendar — the clock is where
 * you already look for the date, so it is where a calendar belongs.
 */
function Clock() {
  const { fmtTime, fmtDate, timezone } = useLocale()
  const [now, setNow] = useState(() => new Date())
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Align the first tick to the next minute boundary so the display never
    // sits up to 59s stale, then settle into a plain 60s interval.
    let interval: ReturnType<typeof setInterval>
    const timeout = setTimeout(() => {
      setNow(new Date())
      interval = setInterval(() => setNow(new Date()), 60_000)
    }, (60 - new Date().getSeconds()) * 1000)
    return () => { clearTimeout(timeout); clearInterval(interval) }
  }, [])

  // Close on outside click and Escape, matching the bell's behaviour.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const tzLabel = TIMEZONES.find(t => t.id === timezone)?.label ?? timezone

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <button
        className="topbar-clock topbar-clock-btn"
        onClick={() => setOpen(o => !o)}
        title={`${tzLabel} — open reminders`}
        aria-label="Open reminder calendar"
        aria-expanded={open}
        style={open ? { borderColor: 'rgba(108,99,255,0.45)', background: 'rgba(108,99,255,0.16)' } : undefined}
      >
        <span className="topbar-clock-time">{fmtTime(now)}</span>
        <span className="topbar-clock-date">{fmtDate(now, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
      </button>
      {open && <ReminderCalendar onClose={() => setOpen(false)} />}
    </div>
  )
}

/**
 * The frame's top edge: section trail on the left, utilities on the right.
 *
 * The bell used to be a fixed-position element pinned to the viewport corner,
 * which landed it on top of every page's own header actions — each page puts a
 * Refresh / Add button in exactly that spot. Giving it a bar of its own means
 * the layout reserves the space instead of two things fighting for it.
 */
export default function Topbar({
  onMenu, sections, home, showBell,
}: {
  onMenu: () => void
  sections: TopbarSection[]
  home: string
  showBell: boolean
}) {
  const { pathname } = useLocation()
  const { company } = useBrand()
  const section = sectionFor(pathname, sections)
  // The owner app is branded with the company name set in the sidebar profile
  // card. The admin console stays "Admin" — it spans every owner, so naming it
  // after one of them would be wrong.
  const root = home === '/admin' ? 'Admin' : company

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="topbar-menu-btn" onClick={onMenu} aria-label="Open menu">
          <Menu size={19} />
        </button>
        <nav className="topbar-trail" aria-label="Breadcrumb">
          <span className="topbar-trail-root">{root}</span>
          {section && (
            <>
              <span className="topbar-trail-sep">/</span>
              <span className="topbar-trail-current">{section}</span>
            </>
          )}
        </nav>
      </div>

      <div className="topbar-right">
        <Clock />
        {showBell && <NotificationBell />}
      </div>
    </header>
  )
}
