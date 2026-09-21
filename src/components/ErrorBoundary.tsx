import { Component, ErrorInfo, ReactNode } from 'react'

/**
 * Catches render errors and shows them.
 *
 * React unmounts the entire tree when a render throws and nothing catches it.
 * With no boundary anywhere in this app that meant a single bad value on one
 * page blanked the whole screen — sidebar, top bar and all — leaving only the
 * fixed background canvas, with the actual error visible only in a console
 * nobody had open. "The page is not working" and "the app crashed on line N"
 * looked identical.
 *
 * This is deliberately not a friendly apology screen. It is the error, the
 * stack, and the component tree, because when something does break that is the
 * only thing worth putting on screen.
 */
interface State {
  error: Error | null
  info: ErrorInfo | null
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, info: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the console copy too: it is the only place the full stack survives
    // if the overlay itself cannot render.
    console.error('Unhandled render error:', error, info.componentStack)
    this.setState({ info })
  }

  render() {
    const { error, info } = this.state
    if (!error) return this.props.children

    const box: React.CSSProperties = {
      background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 10, padding: '12px 14px', marginTop: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 12, lineHeight: 1.55, color: 'rgba(255,255,255,0.75)',
      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      maxHeight: 260, overflowY: 'auto',
    }

    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 99999, overflowY: 'auto',
        padding: 24, display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        background: 'rgba(5,8,16,0.96)',
      }}>
        <div style={{
          width: 'min(820px, 100%)', marginTop: 40, padding: 24, borderRadius: 16,
          background: 'rgba(10,13,28,0.98)', border: '1px solid rgba(244,63,94,0.4)',
          boxShadow: '0 24px 70px rgba(0,0,0,0.7)',
        }}>
          <h1 style={{ fontSize: 18, color: '#f43f5e', margin: 0 }}>The page crashed while rendering</h1>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6, margin: '10px 0 0' }}>
            Everything below is the actual error. Reloading may clear it if the cause was transient;
            if it comes straight back, the message and the first few stack lines are what to report.
          </p>

          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 18, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Error</div>
          <div style={box}>{error.name}: {error.message}</div>

          {error.stack && (
            <>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 14, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Stack</div>
              <div style={box}>{error.stack}</div>
            </>
          )}

          {info?.componentStack && (
            <>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 14, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Component tree</div>
              <div style={box}>{info.componentStack}</div>
            </>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
            <button
              onClick={() => window.location.reload()}
              style={{ padding: '9px 16px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                background: 'rgba(108,99,255,0.22)', border: '1px solid rgba(108,99,255,0.5)', color: '#a78bfa' }}
            >Reload</button>
            <button
              onClick={() => this.setState({ error: null, info: null })}
              style={{ padding: '9px 16px', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: 'transparent', border: '1px solid rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.7)' }}
            >Try to continue</button>
            <button
              onClick={() => {
                const text = `${error.name}: ${error.message}\n\n${error.stack || ''}\n\n${info?.componentStack || ''}`
                navigator.clipboard?.writeText(text)
              }}
              style={{ padding: '9px 16px', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: 'transparent', border: '1px solid rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.7)' }}
            >Copy details</button>
          </div>
        </div>
      </div>
    )
  }
}
