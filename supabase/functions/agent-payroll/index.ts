// Supabase Edge Function: agent-payroll
//
// Autonomous payroll agent. Mirrors the manual "Pay All Due" logic in
// src/pages/Payment.tsx's payAll/payEmp functions, but runs server-side.
//
// Triggered by:
//   - pg_cron, daily sweep (see supabase/migrations/agent_setup.sql) —
//     this is a no-op except near the start of the month, since it only
//     acts on salary_payments rows not yet marked Paid.
//
// Deploy: supabase functions deploy agent-payroll
// Requires secret SB_SERVICE_ROLE_KEY (see agent-restock/index.ts for why
// it's not named SUPABASE_SERVICE_ROLE_KEY)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

  const { data: setting } = await supabase
    .from('app_settings')
    .select('setting_value')
    .eq('setting_key', 'agent_payroll_enabled')
    .single()

  if (setting?.setting_value !== 'true') {
    await supabase.from('agent_runs').insert({
      run_type: 'payroll', trigger_source: triggerSource,
      summary: { done: 0, skipped: 0, errors: [], note: 'agent disabled' },
    })
    return new Response(JSON.stringify({ ok: true, skipped: 'agent disabled' }), { status: 200 })
  }

  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()
  const nowIso = now.toISOString()

  const { data: employees } = await supabase.from('employees').select('*')
  const { data: existingPayments } = await supabase
    .from('salary_payments')
    .select('*')
    .eq('payment_month', currentMonth)
    .eq('payment_year', currentYear)

  const empArr = employees || []
  const payArr = existingPayments || []

  // Backfill salary_payments rows for any employee missing one this month
  const missing = empArr.filter((e: any) => !payArr.find((p: any) => p.employee_id === e.id))
  if (missing.length > 0) {
    await supabase.from('salary_payments').insert(
      missing.map((e: any) => ({
        employee_id: e.id, amount: e.monthly_salary || 0,
        payment_month: currentMonth, payment_year: currentYear, status: 'Due',
      }))
    )
  }

  const { data: allPayments } = await supabase
    .from('salary_payments')
    .select('id, status, amount')
    .eq('payment_month', currentMonth)
    .eq('payment_year', currentYear)

  const dueIds = (allPayments || []).filter((p: any) => p.status !== 'Paid').map((p: any) => p.id)
  const totalAmount = (allPayments || [])
    .filter((p: any) => dueIds.includes(p.id))
    .reduce((a: number, p: any) => a + Number(p.amount || 0), 0)

  if (dueIds.length > 0) {
    await supabase.from('salary_payments')
      .update({ status: 'Paid', paid_at: nowIso })
      .in('id', dueIds)
  }

  await supabase.from('agent_runs').insert({
    run_type: 'payroll',
    trigger_source: triggerSource,
    summary: { done: dueIds.length, skipped: 0, errors: [], total_amount: totalAmount },
  })

  return new Response(JSON.stringify({ ok: true, paid: dueIds.length, total_amount: totalAmount }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
