// Supabase Edge Function: agent-restock
//
// Autonomous restock agent. Mirrors the manual logic already used in
// src/pages/Restock.tsx (queue building) and the "Fix All" handler in
// src/pages/SalesForecast.tsx (vendor matching + order placement), but
// runs server-side so it works without anyone having the app open.
//
// Triggered by:
//   - pg_cron, daily sweep (see supabase/migrations/agent_setup.sql)
//   - a Postgres trigger the instant a product crosses into low stock
//
// Deploy: supabase functions deploy agent-restock
// Requires secret SB_SERVICE_ROLE_KEY (SUPABASE_URL is injected automatically;
// "SUPABASE_" is a reserved secret-name prefix, hence the SB_ prefix here).
// Set with: supabase secrets set SB_SERVICE_ROLE_KEY=...

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const norm = (s: string | null | undefined) => (s || '').trim().toUpperCase()

Deno.serve(async (req) => {
  let triggerSource = 'manual'
  try {
    const body = await req.json().catch(() => ({}))
    triggerSource = body.trigger_source || 'manual'
  } catch { /* no body is fine */ }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SB_SERVICE_ROLE_KEY')!,
  )

  // 1. Activation switch — no-op if this specific agent is turned off
  const { data: setting } = await supabase
    .from('app_settings')
    .select('setting_value')
    .eq('setting_key', 'agent_restock_enabled')
    .single()

  if (setting?.setting_value !== 'true') {
    await supabase.from('agent_runs').insert({
      run_type: 'restock', trigger_source: triggerSource,
      summary: { done: 0, skipped: 0, errors: [], note: 'agent disabled' },
    })
    return new Response(JSON.stringify({ ok: true, skipped: 'agent disabled' }), { status: 200 })
  }

  // 2. Low-stock candidates (same threshold Restock.tsx queue uses)
  const { data: invRows } = await supabase
    .from('inventory')
    .select('id, product_id, current_stock, reorder_level, products(id, name, family, unit_price)')

  const lowStock = (invRows || []).filter((i: any) => i.current_stock <= i.reorder_level)

  // 3. Active vendors
  const { data: vendorRows } = await supabase.from('vendors').select('*').eq('status', 'Active')
  const vendors = vendorRows || []

  let done = 0
  let skipped = 0
  let totalAmount = 0
  const errors: string[] = []

  for (const item of lowStock) {
    const product = Array.isArray(item.products) ? item.products[0] : item.products
    if (!product) { skipped++; continue }

    const matching = vendors.filter((v: any) => norm(v.category) === norm(product.family))
    if (matching.length === 0) {
      errors.push(`${product.name}: no vendor for "${product.family}"`)
      skipped++
      continue
    }

    const vendor = [...matching].sort((a: any, b: any) => a.lead_time_days - b.lead_time_days)[0]

    const suggestQty = Math.round((item.reorder_level || 0) * 3)
    const unitCost = parseFloat(product.unit_price || '0') * 0.6
    const total = Math.round(suggestQty * unitCost)

    const now = new Date().toISOString()
    const delivDate = new Date()
    delivDate.setDate(delivDate.getDate() + (vendor.lead_time_days || 7))

    await supabase.from('restock_orders').insert({
      vendor_id: vendor.id,
      vendor_name: vendor.company,
      vendor_email: vendor.email,
      items: [{ product_name: product.name, sku: '', quantity: suggestQty, unit_cost: unitCost }],
      total_cost: total,
      status: 'Pending',
      notes: `Autonomous agent restock (${triggerSource})`,
      expected_delivery: delivDate.toISOString().split('T')[0],
      ordered_at: now,
      // paid_at intentionally left null — payment happens on delivery confirmation
    })

    // Credit inventory immediately so this item leaves the low-stock queue,
    // same as the manual order flow in Restock.tsx.
    await supabase.from('inventory')
      .update({ current_stock: item.current_stock + suggestQty, last_updated: now })
      .eq('id', item.id)

    totalAmount += total
    done++
  }

  await supabase.from('agent_runs').insert({
    run_type: 'restock',
    trigger_source: triggerSource,
    summary: { done, skipped, errors, total_amount: totalAmount },
  })

  return new Response(JSON.stringify({ ok: true, done, skipped, errors, total_amount: totalAmount }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
