import { useEffect, useState } from 'react'
import { type Session } from '@supabase/supabase-js'
import { supabase } from '../../security/supabaseClient'
import { clearAccountState } from '../../security/accountState'
import { storedSessionIsLive } from '../../security/storedSession'
import { confirmAnswersOwner } from '../query/persist'

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  // While the session is being read: whether this browser holds a sign-in whose access is still running (a
  // hint, read at once — security/storedSession.ts). The shell draws on it instead of a spinner; `session`
  // then decides. An expired one waits for the server, as before.
  const [likelySignedIn] = useState(() => storedSessionIsLive())

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) confirmAnswersOwner(session.user.id)
      setSession(session)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) confirmAnswersOwner(session.user.id)
      setSession(session)
      // Signed out elsewhere (another tab, an expired or revoked session).
      if (event === 'SIGNED_OUT') void clearAccountState()
    })

    return () => subscription.unsubscribe()
  }, [])

  return { session, loading, likelySignedIn, user: session?.user ?? null }
}
