import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCheck, Package, ShoppingCart, DollarSign, Zap, CalendarClock } from 'lucide-react'
import { useNotifications, timeAgo, AppNotification } from '../lib/notifications'

const ICON: Record<string, any> = {
  inventory: Package, procurement: ShoppingCart, payment: DollarSign, agent: Zap,
  reminder: CalendarClock,
}
const TONE: Record<string, string> = {
  critical: '#f43f5e', warning: '#f59e0b', info: '#6C63FF',
}

export default function NotificationBell() {
  // `open`, not `items`: an alert resolved on the Alerts page has been dealt
  // with, so it should leave the bell rather than linger as a read row the
  // user has to scroll past. The two surfaces read the same table.
  const { open: items, unread, markRead, markAllRead } = useNotifications()
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const wrap = useRef<HTMLDivElement>(null)

  // Close on outside click and on Escape — a dropdown that can only be closed
  // by its own button is a trap on touch.
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

  // Click = "I've seen this": mark it read, then go where it points.
  const openItem = (n: AppNotification) => {
    if (!n.read_at) markRead(n.id)
    setOpen(false)
    if (n.link) navigate(n.link)
  }

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-label={`Notifications${unread.length ? `, ${unread.length} unread` : ''}`}
        style={{
          position: 'relative', width: 36, height: 36, borderRadius: 10, cursor: 'pointer',
          background: open ? 'rgba(108,99,255,0.16)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${open ? 'rgba(108,99,255,0.45)' : 'rgba(255,255,255,0.09)'}`,
          color: unread.length ? '#fff' : 'rgba(255,255,255,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.18s',
        }}
      >
        <Bell size={17} />
        {unread.length > 0 && (
          <span style={{
            position: 'absolute', top: -6, right: -6, minWidth: 17, height: 17, padding: '0 4px',
            borderRadius: 9, background: '#f43f5e', color: '#fff', fontSize: 10, fontWeight: 800,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            // Ring matches the bar it sits on, so the badge reads as lifted
            // off the button rather than merged into it.
            border: '2px solid #080a14', boxShadow: '0 0 10px rgba(244,63,94,0.55)',
          }}>{unread.length > 99 ? '99+' : unread.length}</span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 46, right: 0, zIndex: 9000,
          // Never wider than the phone it opens on, never taller than the
          // space below the bar it hangs from.
          width: 'min(370px, calc(100vw - 24px))',
          maxHeight: 'min(460px, calc(100vh - var(--topbar-h) - 24px))',
          display: 'flex', flexDirection: 'column', borderRadius: 14, overflow: 'hidden',
          background: 'rgba(8,11,24,0.97)', backdropFilter: 'blur(22px)',
          border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 24px 70px rgba(0,0,0,0.65)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0,
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>
              Notifications
              {unread.length > 0 && (
                <span style={{ fontSize: 11, fontWeight: 600, color: '#f43f5e', marginLeft: 7 }}>
                  {unread.length} new
                </span>
              )}
            </span>
            {unread.length > 0 && (
              <button onClick={markAllRead} style={{
                display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none',
                cursor: 'pointer', fontSize: 11, fontWeight: 600, color: '#6C63FF', padding: 0,
              }}>
                <CheckCheck size={13} /> Mark all read
              </button>
            )}
          </div>

          <div style={{ overflowY: 'auto', flex: 1 }}>
            {items.length === 0 ? (
              <div style={{ padding: 34, textAlign: 'center', color: 'rgba(255,255,255,0.32)', fontSize: 12.5 }}>
                <Bell size={26} style={{ opacity: 0.3, display: 'block', margin: '0 auto 10px' }} />
                Nothing yet. Low stock, purchase orders, payments and agent activity land here.
              </div>
            ) : items.map(n => {
              const Icon = ICON[n.category] || Bell
              const tone = TONE[n.severity] || '#6C63FF'
              const isUnread = !n.read_at
              return (
                <button
                  key={n.id}
                  onClick={() => openItem(n)}
                  style={{
                    width: '100%', display: 'flex', gap: 11, padding: '11px 14px', textAlign: 'left',
                    cursor: 'pointer', border: 'none',
                    borderBottom: '1px solid rgba(255,255,255,0.045)',
                    // Unread rows carry a tinted ground and a left rule; read
                    // rows drop both and dim, so "seen" is obvious at a glance.
                    background: isUnread ? 'rgba(108,99,255,0.09)' : 'transparent',
                    borderLeft: `3px solid ${isUnread ? tone : 'transparent'}`,
                    opacity: isUnread ? 1 : 0.55, transition: 'background 0.15s, opacity 0.2s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.background = isUnread ? 'rgba(108,99,255,0.09)' : 'transparent'
                  }}
                >
                  <span style={{
                    width: 28, height: 28, borderRadius: 8, flexShrink: 0, marginTop: 1,
                    background: `${tone}1c`, border: `1px solid ${tone}3a`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Icon size={14} color={tone} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{
                      display: 'block', fontSize: 12.5, color: '#fff',
                      fontWeight: isUnread ? 700 : 500, lineHeight: 1.35,
                    }}>{n.title}</span>
                    {n.body && (
                      <span style={{
                        display: 'block', fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{n.body}</span>
                    )}
                    <span style={{ display: 'block', fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 3 }}>
                      {timeAgo(n.created_at)}{n.link ? ' · click to open' : ''}
                    </span>
                  </span>
                  {isUnread && (
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: tone, flexShrink: 0, marginTop: 8 }} />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
