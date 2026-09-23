// Supabase Edge Function: sim-demand-shape
//
// Fetches today's demand shape from the model server and caches it into
// sim_day_shape, where tick_realtime_sales() reads it.
//
// Why this exists as a function rather than a pg_cron HTTP call:
//
//   pg_net is asynchronous. net.http_post returns a request id and the
//   response lands later in net._http_response, so a pure-SQL job would need a
//   second scheduled job to pick the body up and transform it -- two jobs and
//   an ordering assumption between them. Fetching and writing in one place is
//   simpler and cannot half-complete.
//
// Why there is no supabase-js import:
//
//   This does one SELECT and one UPSERT, which is two fetch calls against
//   PostgREST. Importing the SDK for that added a hard dependency on esm.sh
//   being able to build it -- and esm.sh currently cannot, failing on
//   @supabase/storage-js and @supabase/functions-js sub-module resolution for
//   both the floating @2 tag and a pinned 2.39.3. A function that deploys only
//   when a third-party CDN is healthy is not worth the convenience.
//
// The model works at product-family granularity, so that is what it returns.
// Mapping family -> product happens here, against the products table.
//
// Failure is not an error worth retrying hard. The Space sleeps on free
// cpu-basic; if it cannot be reached, yesterday's shape is left in place and
// the tick falls back to a flat 1.0 weight on its own. A missing shape costs a
// little realism in the mix between families and nothing else.
//
// Deploy: supabase functions deploy sim-demand-shape

const BACKEND = Deno.env.get('BACKEND_URL') ?? 'https://hirudra90-antigravity-backend.hf.space'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SB_SERVICE_ROLE_KEY')!

const norm = (s: string | null | undefined) => (s || '').trim().toUpperCase()

const db = (path: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })

Deno.serve(async () => {
  const today = new Date().toISOString().slice(0, 10)

  // Families we actually stock, so the model is not asked about categories
  // this catalogue does not carry.
  const pRes = await db('products?select=id,family')
  if (!pRes.ok) {
    return new Response(
      JSON.stringify({ ok: false, error: `products read failed: ${await pRes.text()}` }),
      { status: 500 },
    )
  }
  const products: Array<{ id: number; family: string | null }> = await pRes.json()
  if (!products.length) {
    return new Response(JSON.stringify({ ok: false, error: 'no products' }), { status: 500 })
  }

  const families = [...new Set(products.map(p => p.family).filter(Boolean))] as string[]

  let payload: any
  try {
    // A deadline matters here: a sleeping Space leaves the request hanging
    // rather than refusing it, and a cron job that never returns is worse
    // than one that gives up.
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 55_000)
    // Pipe-separated, not comma: this catalogue contains "LIQUOR,WINE,BEER",
    // and a comma-joined list tears it into three families that do not exist,
    // so its products silently kept a flat 1.0 weight.
    const res = await fetch(
      `${BACKEND}/api/simulate/demand-shape?families=${encodeURIComponent(families.join('|'))}`,
      { signal: ctrl.signal },
    )
    clearTimeout(timer)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    payload = await res.json()
  } catch (err) {
    // Deliberately a 200. The tick copes on its own, and a red cron job would
    // imply something needs fixing when the Space is merely asleep.
    return new Response(
      JSON.stringify({ ok: true, skipped: `model server unreachable: ${err}`, date: today }),
      { status: 200 },
    )
  }

  const byFamily = new Map<string, number>()
  for (const w of payload.weights ?? []) {
    const v = Number(w.weight)
    if (Number.isFinite(v) && v > 0) byFamily.set(norm(w.family), v)
  }

  // Products in a family the model did not weigh keep 1.0 rather than being
  // dropped -- a missing weight must never mean "sells nothing today".
  const weights: Record<string, number> = {}
  let unweighted = 0
  for (const p of products) {
    const w = byFamily.get(norm(p.family))
    if (w === undefined) unweighted++
    weights[String(p.id)] = w ?? 1.0
  }

  const upRes = await db('sim_day_shape?on_conflict=shape_date', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({
      shape_date: today,
      weights,
      source: 'hf',
      fetched_at: new Date().toISOString(),
    }),
  })

  if (!upRes.ok) {
    return new Response(
      JSON.stringify({ ok: false, error: `upsert failed: ${await upRes.text()}` }),
      { status: 500 },
    )
  }

  return new Response(JSON.stringify({
    ok: true,
    date: today,
    products_weighted: Object.keys(weights).length,
    products_defaulted: unweighted,
    families_weighted: byFamily.size,
    families_in_catalogue: families.length,
    sentiment_multiplier: payload.sentiment_multiplier,
    oil_price: payload.oil_price,
  }), { status: 200 })
})
