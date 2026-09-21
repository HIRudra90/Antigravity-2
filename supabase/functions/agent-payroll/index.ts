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

  const { data: settingsRows } = await supabase
    .from('app_settings')
    .select('setting_key, setting_value')
    .in('setting_key', ['agent_payroll_enabled', 'auto_pay_enabled', 'auto_pay_day'])

  const settings = Object.fromEntries(
    (settingsRows || []).map((r: any) => [r.setting_key, r.setting_value]),
  )

  const logSkip = async (note: string, extra: Record<string, unknown> = {}) => {
    await supabase.from('agent_runs').insert({
      run_type: 'payroll', trigger_source: triggerSource,
      summary: { done: 0, skipped: 0, errors: [], note, ...extra },
    })
    return new Response(JSON.stringify({ ok: true, skipped: note, ...extra }), { status: 200 })
  }

  // Master switch for the agent itself.
  if (settings.agent_payroll_enabled !== 'true') {
    return await logSkip('agent disabled')
  }

  // The Settings > Salary / Auto-Pay toggle. This function used to read only
  // agent_payroll_enabled, so the switch the user actually sees controlled
  // nothing and payroll ran regardless of it.
  if (settings.auto_pay_enabled !== 'true') {
    return await logSkip('auto-pay disabled')
  }

  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()
  const nowIso = now.toISOString()

  // Pay only on the configured day. The cron sweeps daily, so without this the
  // agent paid the moment it found an unpaid row — always the 1st, whatever
  // the configured payment day said. A day past the end of a short month
  // (e.g. 31 in June) clamps to that month's last day so it never skips.
  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate()
  const configuredDay = parseInt(settings.auto_pay_day ?? '1', 10) || 1
  const payDay = Math.min(Math.max(configuredDay, 1), daysInMonth)

  if (now.getDate() !== payDay) {
    return await logSkip('not payday', { today: now.getDate(), pay_day: payDay })
  }

  // Active staff only. Inactive and On Leave employees must not be paid, and
  // must not even have a salary_payments row raised for the month.
  const { data: employees } = await supabase
    .from('employees')
    .select('*')
    .eq('status', 'Active')
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

  // Restrict to rows belonging to Active employees. A row raised for someone
  // who has since gone On Leave stays Due rather than being swept up here.
  const activeIds = new Set(empArr.map((e: any) => e.id))

  const { data: allPayments } = await supabase
    .from('salary_payments')
    .select('id, status, amount, employee_id')
    .eq('payment_month', currentMonth)
    .eq('payment_year', currentYear)

  const duePayments = (allPayments || []).filter(
    (p: any) => p.status !== 'Paid' && activeIds.has(p.employee_id),
  )
  const dueIds = duePayments.map((p: any) => p.id)
  const totalAmount = duePayments.reduce((a: number, p: any) => a + Number(p.amount || 0), 0)

  if (dueIds.length > 0) {
    await supabase.from('salary_payments')
      .update({ status: 'Paid', paid_at: nowIso })
      .in('id', dueIds)
  }

  await supabase.from('agent_runs').insert({
    run_type: 'payroll',
    trigger_source: triggerSource,
    summary: {
      done: dueIds.length, skipped: 0, errors: [],
      total_amount: totalAmount, pay_day: payDay, active_employees: empArr.length,
    },
  })

  return new Response(JSON.stringify({ ok: true, paid: dueIds.length, total_amount: totalAmount }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
