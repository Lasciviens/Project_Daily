import { useEffect, useState } from 'react'
import { type Session } from '@supabase/supabase-js'
import { supabase } from '../../security/supabaseClient'
import { clearAccountState } from '../../security/accountState'

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      // Signed out elsewhere (another tab, an expired or revoked session).
      if (event === 'SIGNED_OUT') void clearAccountState()
    })

    return () => subscription.unsubscribe()
  }, [])

  return { session, loading, user: session?.user ?? null }
}
