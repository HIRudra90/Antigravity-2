/**
 * Client for the FastAPI model server.
 *
 * The backend runs on a free Hugging Face Space (cpu-basic), which sleeps after
 * a period of inactivity. Waking it takes tens of seconds, and during that
 * window a request either hangs or comes back 503.
 *
 * Every call site used to be a bare `fetch` with no timeout, which meant a cold
 * start left the UI pinned in a loading state forever: the promise never
 * settled, so no error path ever ran and the card sat on "Running holdout
 * backtest…" indefinitely — even after the Space had finished booting. Nothing
 * short of a page reload recovered.
 *
 * So: every request gets a deadline, a sleeping backend is retried rather than
 * treated as broken, and the caller is told which of the two is happening.
 */

export const BACKEND_URL =
  (import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000').replace(/\/+$/, '')

export type BackendFailure = 'timeout' | 'network' | 'http'

export class BackendError extends Error {
  kind: BackendFailure
  status?: number
  constructor(kind: BackendFailure, message: string, status?: number) {
    super(message)
    this.name = 'BackendError'
    this.kind = kind
    this.status = status
  }
}

export interface BackendCallOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  /** Deadline for a single attempt. */
  timeoutMs?: number
  /** Extra attempts after the first. Only cold-start-shaped failures retry. */
  retries?: number
  /**
   * Called before each retry, so the UI can say "waking the model server"
   * rather than showing a spinner that looks identical to a hang.
   */
  onRetry?: (attempt: number, total: number) => void
  signal?: AbortSignal
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** A sleeping Space times out, drops the connection, or answers 5xx while booting. */
const isColdStart = (err: BackendError) =>
  err.kind === 'timeout' || err.kind === 'network' || (err.status !== undefined && err.status >= 500)

async function attempt<T>(path: string, opts: BackendCallOptions): Promise<T> {
  const { method = 'GET', body, timeoutMs = 30_000, signal } = opts
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)

  // An outer signal (component unmount) has to cancel the inner request too.
  const onOuterAbort = () => ctrl.abort()
  signal?.addEventListener('abort', onOuterAbort)

  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      method,
      signal: ctrl.signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      // FastAPI puts the real reason in `detail` — a string for raised
      // HTTPExceptions, a list of field errors for 422 validation failures.
      // Surfacing "field required: days" beats "HTTP 422" at every call site.
      const payload = await res.json().catch(() => null as any)
      const detail = payload?.detail
      const reason = Array.isArray(detail)
        ? detail.map((d: any) => d?.msg ?? JSON.stringify(d)).join(', ')
        : typeof detail === 'string' ? detail : null
      throw new BackendError(
        'http',
        reason ? `${reason} (HTTP ${res.status})` : `${method} ${path} failed (HTTP ${res.status})`,
        res.status,
      )
    }
    return (await res.json()) as T
  } catch (err: any) {
    if (err instanceof BackendError) throw err
    // An abort is our own deadline firing unless the caller's signal tripped.
    if (err?.name === 'AbortError') {
      if (signal?.aborted) throw new BackendError('network', 'Request cancelled.')
      throw new BackendError('timeout', `${method} ${path} timed out after ${Math.round(timeoutMs / 1000)}s`)
    }
    throw new BackendError('network', 'Could not reach the model server.')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onOuterAbort)
  }
}

/**
 * One backend call, retried through a cold start.
 *
 * Backoff is deliberately slow-ish: hammering a booting Space does not speed it
 * up, and the first request is what triggers the wake in the first place.
 */
export async function backendFetch<T>(path: string, opts: BackendCallOptions = {}): Promise<T> {
  const retries = opts.retries ?? 2
  const backoff = [3_000, 8_000, 15_000]
  let last: BackendError = new BackendError('network', 'Could not reach the model server.')

  for (let i = 0; i <= retries; i++) {
    try {
      return await attempt<T>(path, opts)
    } catch (err: any) {
      last = err instanceof BackendError ? err : new BackendError('network', String(err?.message || err))
      // A 4xx is a real answer — the payload or route is wrong, and repeating
      // it just delays showing the user a true error.
      if (!isColdStart(last) || i === retries || opts.signal?.aborted) break
      opts.onRetry?.(i + 1, retries)
      await sleep(backoff[Math.min(i, backoff.length - 1)])
    }
  }
  throw last
}

/**
 * Bring the Space up before doing anything expensive.
 *
 * The health route is cheap, so it absorbs the cold start on its own instead of
 * a heavy backtest POST timing out mid-boot. Resolves false if the backend is
 * genuinely down, which callers report rather than retrying forever.
 */
export async function wakeBackend(opts: { onRetry?: BackendCallOptions['onRetry']; signal?: AbortSignal } = {}) {
  try {
    await backendFetch<{ status: string }>('/', {
      timeoutMs: 20_000,
      retries: 3,
      onRetry: opts.onRetry,
      signal: opts.signal,
    })
    return true
  } catch {
    return false
  }
}

/** Plain-English reason, for showing in a card instead of a raw stack. */
export function describeBackendError(err: unknown): string {
  if (err instanceof BackendError) {
    if (err.kind === 'timeout') return 'The model server did not respond in time (it may still be starting up).'
    if (err.kind === 'network') return 'The model server could not be reached.'
    if (err.status === 404) return 'The model server is running but this endpoint is missing — it may be an older deploy.'
    return `The model server returned an error (HTTP ${err.status}).`
  }
  return (err as any)?.message || 'The model server call failed.'
}

/** One scored input behind the multiplier. Contributions sum to the total. */
export interface SentimentComponent {
  label: string
  detail: string
  contribution: number
  score?: number | null
  engine?: string | null
}

export interface OilContext {
  price: number
  avg_90d: number
  pct_vs_avg: number
  pct_30d: number
  trend: 'RISING' | 'FALLING' | 'STABLE' | 'UNKNOWN'
  low_6mo: number
  high_6mo: number
  source: string
}

export interface MarketInsight {
  multiplier: number
  direction: 'UP' | 'DOWN' | 'NEUTRAL'
  analysis: string
  total_adjustment: number
  components: SentimentComponent[]
  oil: OilContext
  holidays: { name: string; country: string; date: string; days_until: number; scope?: string }[]
  headlines: { title: string; description: string; source: string; published_at: string; url: string }[]
  news_status: string
  news_engine: string
  family: string
  generated_at: string
}

export interface ModelStatus {
  models_dir: string
  models_dir_exists: boolean
  xgboost: { path: string; file_present: boolean; loaded: boolean; engine: string }
  encoders: { path: string; file_present: boolean; loaded: boolean }
  ppo: { path: string; file_present: boolean; loaded: boolean; engine: string }
}
