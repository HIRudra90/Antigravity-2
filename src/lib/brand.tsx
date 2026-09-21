import {
  createContext, useCallback, useContext, useEffect, useState, ReactNode,
} from 'react'
import { supabase } from './supabaseClient'

/**
 * The company identity shown in the chrome: name, avatar, owner display name.
 *
 * Lives in a provider rather than being fetched per component because two
 * places render it at once — the sidebar profile card and the top bar
 * breadcrumb. Two independent fetches would let them disagree for a moment
 * after a rename, showing the old name in one and the new one in the other.
 *
 * Backed by app_settings, the same store Settings already used for these keys,
 * so nothing had to be migrated when the editor moved out of Settings.
 */
export interface Brand {
  company: string
  avatarUrl: string
  fullName: string
}

interface BrandState extends Brand {
  loading: boolean
  save: (next: Partial<Brand>) => Promise<void>
  reload: () => Promise<void>
}

const DEFAULTS: Brand = {
  company: 'Antigravity Inc.',
  avatarUrl: '',
  fullName: '',
}

const KEYS = {
  company: 'profile_company',
  avatarUrl: 'profile_avatar_url',
  fullName: 'profile_name',
} as const

const BrandContext = createContext<BrandState | undefined>(undefined)

export function BrandProvider({ children }: { children: ReactNode }) {
  const [brand, setBrand] = useState<Brand>(DEFAULTS)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    const { data } = await supabase
      .from('app_settings')
      .select('setting_key, setting_value')
      .in('setting_key', Object.values(KEYS))

    const map = Object.fromEntries(((data as any[]) || []).map(r => [r.setting_key, r.setting_value]))
    setBrand({
      // An empty string is a real stored value meaning "none", so only a
      // missing key falls back to the default name.
      company:   map[KEYS.company] ?? DEFAULTS.company,
      avatarUrl: map[KEYS.avatarUrl] ?? '',
      fullName:  map[KEYS.fullName] ?? '',
    })
    setLoading(false)
  }, [])

  useEffect(() => { reload() }, [reload])

  /**
   * Writes changed keys and updates local state immediately, so the sidebar
   * and breadcrumb both change on save rather than after a round trip.
   */
  const save = useCallback(async (next: Partial<Brand>) => {
    const rows = (Object.keys(next) as (keyof Brand)[])
      .filter(k => next[k] !== undefined)
      .map(k => ({
        setting_key: KEYS[k],
        setting_value: String(next[k] ?? ''),
        updated_at: new Date().toISOString(),
      }))
    if (rows.length === 0) return

    setBrand(prev => ({ ...prev, ...next }))
    const { error } = await supabase
      .from('app_settings')
      .upsert(rows, { onConflict: 'setting_key' })
    if (error) {
      // Put the stored values back, so the UI never claims a save that failed.
      await reload()
      throw error
    }
  }, [reload])

  return (
    <BrandContext.Provider value={{ ...brand, loading, save, reload }}>
      {children}
    </BrandContext.Provider>
  )
}

export function useBrand(): BrandState {
  const ctx = useContext(BrandContext)
  if (!ctx) throw new Error('useBrand must be used inside a BrandProvider')
  return ctx
}
