import { useEffect, useRef } from 'react'
import { supabase } from './supabaseClient'

/**
 * Keeps a page in step with the database.
 *
 * Every page used to fetch once on mount, so anything written elsewhere — an
 * admin placing an order, the restock agent topping up stock, a payroll run —
 * only appeared if you navigated away and back. The Dashboard had this logic
 * inline; the other pages had nothing at all.
 *
 * Three mechanisms, because none of them is reliable alone:
 *  - Postgres change events, for the sub-second case.
 *  - A slow poll, because realtime drops silently on a dead socket or a
 *    backgrounded tab and never tells you.
 *  - A refetch when the tab regains focus, for the "came back to it" case.
 *
 * Events arrive in bursts (one order writes a sale, an inventory row and a
 * restock order), so refetches are debounced instead of fired per event.
 *
 * @param channelName Unique per page — two pages sharing a name silently
 *                    clobber each other's subscription.
 * @param tables      Tables whose changes should trigger a refetch.
 * @param onChange    Refetch. Should be silent: it must not blank the page
 *                    out from under the user.
 */
export function useLiveData(channelName: string, tables: string[], onChange: () => void) {
  // Held in a ref so a caller passing an inline arrow doesn't tear down and
  // rebuild the subscription on every render.
  const cb = useRef(onChange)
  cb.current = onChange

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const key = tables.join(',')

  useEffect(() => {
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => cb.current(), 600)
    }

    let channel = supabase.channel(channelName)
    for (const table of key.split(',')) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        schedule,
      )
    }
    channel.subscribe()

    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') cb.current()
    }, 60_000)

    const onVisible = () => { if (document.visibilityState === 'visible') cb.current() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      if (timer.current) clearTimeout(timer.current)
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(channel)
    }
  }, [channelName, key])
}
