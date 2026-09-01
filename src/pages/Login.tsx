import { useState, FormEvent } from 'react'
import { LogIn, Mail, Lock, AlertCircle, Loader2 } from 'lucide-react'
import { useAuth } from '../lib/auth'

export default function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!email || !password) return
    setBusy(true)
    setError(null)
    const { error } = await signIn(email, password)
    if (error) {
      setError(error)
      setBusy(false)
    }
    // On success the auth listener swaps the tree; leave `busy` set so the
    // button stays disabled through the transition.
  }

  const field: React.CSSProperties = {
    width: '100%',
    padding: '12px 14px 12px 40px',
    borderRadius: 12,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.12)',
    color: '#fff',
    fontSize: 14,
    outline: 'none',
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        position: 'relative',
        zIndex: 1,
      }}
    >
      <div
        className="glass-card"
        style={{ width: '100%', maxWidth: 420, padding: 32 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <div
            style={{
              width: 40, height: 40, borderRadius: 12,
              background: 'linear-gradient(135deg,#6C63FF,#00D4FF)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>Inventiq</div>
            <div style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>
              Sign in to continue
            </div>
          </div>
        </div>

        <p style={{ fontSize: 13, color: 'var(--clr-text-muted)', margin: '16px 0 24px', lineHeight: 1.6 }}>
          Your role decides what loads next — owners get their business dashboard,
          admins get the owner management console.
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>
              Email
            </label>
            <div style={{ position: 'relative' }}>
              <Mail
                size={15}
                style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--clr-text-muted)' }}
              />
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com"
                style={field}
                required
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <Lock
                size={15}
                style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--clr-text-muted)' }}
              />
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                style={field}
                required
              />
            </div>
          </div>

          {error && (
            <div
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                padding: 12, borderRadius: 10,
                background: 'rgba(244,63,94,0.08)',
                border: '1px solid rgba(244,63,94,0.3)',
                fontSize: 13, color: '#f43f5e', lineHeight: 1.5,
              }}
            >
              <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || !email || !password}
            style={{
              justifyContent: 'center',
              padding: '12px',
              marginTop: 4,
              opacity: busy || !email || !password ? 0.55 : 1,
              cursor: busy || !email || !password ? 'not-allowed' : 'pointer',
            }}
          >
            {busy
              ? <><Loader2 size={16} className="spin" /> Signing in…</>
              : <><LogIn size={16} /> Sign In</>}
          </button>
        </form>
      </div>
    </div>
  )
}
