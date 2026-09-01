import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { Session } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'

export type Role = 'admin' | 'owner'

export interface Profile {
  id: string
  email: string | null
  full_name: string | null
  role: Role
  owner_id: string | null
}

interface AuthState {
  session: Session | null
  profile: Profile | null
  /** True until the initial session + profile lookup settles. */
  loading: boolean
  /** Set when the session is valid but the profile row could not be read. */
  profileError: string | null
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState<string | null>(null)

  // Load the profile row that carries the role. Without it we cannot decide
  // which app to render, so a failure here is surfaced rather than defaulted —
  // silently falling back to 'owner' would hand the wrong UI to an admin.
  async function loadProfile(userId: string) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, owner_id')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      setProfile(null)
      setProfileError(error.message)
      return
    }
    if (!data) {
      setProfile(null)
      setProfileError(
        'No profile row for this account. Run migration 002 and make sure a profiles row exists for this user.'
      )
      return
    }
    setProfileError(null)
    setProfile(data as Profile)
  }

  useEffect(() => {
    let active = true

    // getSession() resolves outside the auth lock, so awaiting here is safe.
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      if (data.session?.user) await loadProfile(data.session.user.id)
      if (active) setLoading(false)
    }).catch(() => { if (active) setLoading(false) })

    // This callback must stay synchronous and must NOT await any other
    // supabase call. It runs while the client holds its internal auth lock,
    // so a `supabase.from(...)` awaited in here waits on a lock its own caller
    // is holding — a deadlock that leaves `loading` true forever and renders a
    // permanently blank page. Only shows up when a stored session is being
    // restored (page reload), not on a fresh sign-in.
    // Defer the profile fetch out of the callback instead.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return
      setSession(next)

      if (!next?.user) {
        setProfile(null)
        setProfileError(null)
        setLoading(false)
        return
      }

      const userId = next.user.id
      setTimeout(() => {
        if (!active) return
        loadProfile(userId).finally(() => { if (active) setLoading(false) })
      }, 0)
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const signIn: AuthState['signIn'] = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    return { error: error ? error.message : null }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setProfile(null)
    setProfileError(null)
  }

  return (
    <AuthContext.Provider
      value={{ session, profile, loading, profileError, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
