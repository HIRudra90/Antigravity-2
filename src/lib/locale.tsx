import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'
import { supabase } from './supabaseClient'

/**
 * One place that decides how money and time are rendered.
 *
 * Every page used to hardcode a `$` and its own `fmt()` helper, so the
 * Settings > Currency dropdown changed nothing, and the ledger was pinned to
 * a single timezone constant. Both now come from here, so picking a currency
 * or timezone re-renders the whole app immediately — and, because the choice
 * is stored in app_settings and watched over realtime, other open tabs follow
 * within about a second.
 *
 * NOTE ON CONVERSION: this changes how amounts are *labelled*, not their
 * value. The database stores a single unfixed number per amount with no
 * currency column, so there is nothing to convert from. Applying hardcoded FX
 * rates would silently restate the books every time someone changed a
 * dropdown, which is worse than an honest relabel. Real conversion needs a
 * base-currency column plus a rate source.
 */

export interface CurrencyDef {
  code: string
  /** Shown in the dropdown. */
  label: string
  /** BCP-47 tag driving digit grouping, decimals and symbol placement. */
  locale: string
  /** The timezone this currency's market normally operates in. */
  timezone: string
}

// Ten currencies. Intl supplies each symbol, the decimal count (JPY and IDR
// have none) and the grouping style (INR groups 12,34,567 rather than
// 1,234,567), so none of that is hand-maintained here.
export const CURRENCIES: CurrencyDef[] = [
  { code: 'USD', label: 'US Dollar',          locale: 'en-US', timezone: 'America/New_York'  },
  { code: 'MYR', label: 'Malaysian Ringgit',  locale: 'ms-MY', timezone: 'Asia/Kuala_Lumpur' },
  { code: 'EUR', label: 'Euro',               locale: 'de-DE', timezone: 'Europe/Berlin'     },
  { code: 'GBP', label: 'British Pound',      locale: 'en-GB', timezone: 'Europe/London'     },
  { code: 'BDT', label: 'Bangladeshi Taka',   locale: 'bn-BD', timezone: 'Asia/Dhaka'        },
  { code: 'INR', label: 'Indian Rupee',       locale: 'en-IN', timezone: 'Asia/Kolkata'      },
  { code: 'IDR', label: 'Indonesian Rupiah',  locale: 'id-ID', timezone: 'Asia/Jakarta'      },
  { code: 'RUB', label: 'Russian Ruble',      locale: 'ru-RU', timezone: 'Europe/Moscow'     },
  { code: 'JPY', label: 'Japanese Yen',       locale: 'ja-JP', timezone: 'Asia/Tokyo'        },
  { code: 'CNY', label: 'Chinese Yuan',       locale: 'zh-CN', timezone: 'Asia/Shanghai'     },
]

export interface TimezoneDef { id: string; label: string }

// One per currency above, plus UTC for anyone who wants the raw database
// clock. `id` is an IANA name, so daylight saving is handled by the runtime.
export const TIMEZONES: TimezoneDef[] = [
  { id: 'America/New_York',  label: 'Eastern Time (US)' },
  { id: 'Europe/London',     label: 'London (GMT/BST)' },
  { id: 'Europe/Berlin',     label: 'Central European (CET)' },
  { id: 'Europe/Moscow',     label: 'Moscow (MSK)' },
  { id: 'Asia/Dhaka',        label: 'Bangladesh (BST)' },
  { id: 'Asia/Kolkata',      label: 'India (IST)' },
  { id: 'Asia/Jakarta',      label: 'Western Indonesia (WIB)' },
  { id: 'Asia/Kuala_Lumpur', label: 'Malaysia (MYT)' },
  { id: 'Asia/Shanghai',     label: 'China (CST)' },
  { id: 'Asia/Tokyo',        label: 'Japan (JST)' },
  { id: 'UTC',               label: 'Coordinated Universal (UTC)' },
]

// Values written before this existed. Without the mapping, an old row like
// 'MY' would fail Intl's timezone validation and throw on every render.
const LEGACY_TZ: Record<string, string> = {
  MY: 'Asia/Kuala_Lumpur',
  US: 'America/New_York',
  GMT: 'Europe/London',
  UTC: 'UTC',
}

const DEFAULT_CURRENCY = 'MYR'
const DEFAULT_TZ = 'Asia/Kuala_Lumpur'

export const currencyDef = (code: string): CurrencyDef =>
  CURRENCIES.find(c => c.code === code) ?? CURRENCIES[1]

const normaliseTz = (raw: string | null | undefined): string => {
  if (!raw) return DEFAULT_TZ
  if (LEGACY_TZ[raw]) return LEGACY_TZ[raw]
  return TIMEZONES.some(t => t.id === raw) ? raw : DEFAULT_TZ
}

interface LocaleValue {
  currency: string
  timezone: string
  def: CurrencyDef
  /** Symbol alone, for axis ticks and other places a full format won't fit. */
  symbol: string
  /** Full amount: RM 1,234.50 */
  money: (n: number | string | null | undefined) => string
  /** Compact amount for cards and charts: RM 1.2M */
  moneyShort: (n: number | string | null | undefined) => string
  /** Amount with no symbol, for when the label is elsewhere. */
  number: (n: number | string | null | undefined, decimals?: number) => string
  fmtDate: (value: any, opts?: Intl.DateTimeFormatOptions) => string
  fmtTime: (value: any) => string
  fmtDateTime: (value: any) => string
  setCurrency: (code: string, alsoTimezone?: boolean) => Promise<void>
  setTimezone: (tz: string) => Promise<void>
  ready: boolean
}

const LocaleCtx = createContext<LocaleValue | null>(null)

const toNum = (n: any): number => {
  const v = typeof n === 'number' ? n : parseFloat(n ?? '0')
  return Number.isFinite(v) ? v : 0
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState(DEFAULT_CURRENCY)
  const [timezone, setTimezoneState] = useState(DEFAULT_TZ)
  const [ready, setReady] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('app_settings')
      .select('setting_key, setting_value')
      .in('setting_key', ['system_currency', 'system_timezone'])
    const get = (k: string) => (data || []).find((r: any) => r.setting_key === k)?.setting_value
    const code = get('system_currency')
    setCurrencyState(CURRENCIES.some(c => c.code === code) ? (code as string) : DEFAULT_CURRENCY)
    setTimezoneState(normaliseTz(get('system_timezone')))
    setReady(true)
  }, [])

  useEffect(() => { load() }, [load])

  // Another tab (or another device) changing the setting should reach this
  // one without a reload.
  useEffect(() => {
    const ch = supabase
      .channel('locale-settings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, load)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  const def = currencyDef(currency)

  const persist = async (pairs: [string, string][]) => {
    await supabase.from('app_settings').upsert(
      pairs.map(([setting_key, setting_value]) => ({
        setting_key, setting_value, updated_at: new Date().toISOString(),
      })),
      { onConflict: 'setting_key' },
    )
  }

  // State first, database second: the UI must not wait on a round trip to
  // show the new currency.
  const setCurrency = async (code: string, alsoTimezone = true) => {
    const next = currencyDef(code)
    setCurrencyState(next.code)
    const pairs: [string, string][] = [['system_currency', next.code]]
    if (alsoTimezone) {
      setTimezoneState(next.timezone)
      pairs.push(['system_timezone', next.timezone])
    }
    await persist(pairs)
  }

  const setTimezone = async (tz: string) => {
    const next = normaliseTz(tz)
    setTimezoneState(next)
    await persist([['system_timezone', next]])
  }

  const money = (n: any) =>
    new Intl.NumberFormat(def.locale, { style: 'currency', currency: def.code }).format(toNum(n))

  const moneyShort = (n: any) => {
    const v = toNum(n)
    // Compact notation only below a million reads worse than the plain
    // number for small amounts, so only switch over at 10k.
    if (Math.abs(v) < 10_000) {
      return new Intl.NumberFormat(def.locale, {
        style: 'currency', currency: def.code, numberingSystem: 'latn', maximumFractionDigits: 0,
      }).format(v)
    }
    return new Intl.NumberFormat(def.locale, {
      style: 'currency', currency: def.code, numberingSystem: 'latn', notation: 'compact', maximumFractionDigits: 1,
    }).format(v)
  }

  // Latin digits throughout: bn-BD would otherwise render ১২,৩৪,৫৬৭ beside
  // Latin figures elsewhere in the UI. Locale grouping is kept, so INR still
  // reads 12,34,567 and EUR 1.234.567.
  const number = (n: any, decimals = 0) =>
    new Intl.NumberFormat(def.locale, {
      numberingSystem: 'latn',
      minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    }).format(toNum(n))

  const symbol =
    new Intl.NumberFormat(def.locale, { style: 'currency', currency: def.code, numberingSystem: 'latn' })
      .formatToParts(1)
      .find(p => p.type === 'currency')?.value ?? def.code

  const asDate = (value: any): Date | null => {
    if (value === null || value === undefined || value === '') return null
    // A bare DATE ('2026-09-19') parses as UTC midnight, which can slide to
    // the previous day in a western zone. Pin it to midday so the calendar
    // date survives the conversion.
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(`${value}T12:00:00Z`)
    }
    const d = value instanceof Date ? value : new Date(value)
    return isNaN(d.getTime()) ? null : d
  }

  const fmtDate = (value: any, opts?: Intl.DateTimeFormatOptions) => {
    const d = asDate(value)
    if (!d) return '—'
    return d.toLocaleDateString(def.locale, {
      month: 'short', day: 'numeric', ...opts, timeZone: timezone,
    })
  }

  const fmtTime = (value: any) => {
    const d = asDate(value)
    if (!d) return '—'
    return d.toLocaleTimeString(def.locale, {
      hour: 'numeric', minute: '2-digit', timeZone: timezone,
    })
  }

  const fmtDateTime = (value: any) => {
    const d = asDate(value)
    if (!d) return '—'
    return `${fmtDate(value)} · ${fmtTime(value)}`
  }

  return (
    <LocaleCtx.Provider value={{
      currency, timezone, def, symbol,
      money, moneyShort, number, fmtDate, fmtTime, fmtDateTime,
      setCurrency, setTimezone, ready,
    }}>
      {children}
    </LocaleCtx.Provider>
  )
}

export function useLocale(): LocaleValue {
  const ctx = useContext(LocaleCtx)
  if (!ctx) throw new Error('useLocale must be used inside <LocaleProvider>')
  return ctx
}
