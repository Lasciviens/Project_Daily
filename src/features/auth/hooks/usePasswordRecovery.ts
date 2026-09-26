import { useEffect, useState } from 'react'
import { onPasswordRecovery, hasSession } from '../api/recoveryApi'

export type RecoveryStatus = 'checking' | 'ready' | 'invalid'

// Supabase's client processes the recovery token on load and fires a
// PASSWORD_RECOVERY auth event. The session check is a fallback in case the
// event fired before this listener attached (a real-world flakiness other
// apps hit): the page is unreachable without a recovery/sign-in token, so any
// session found shortly after load counts as valid.
export function usePasswordRecovery(): RecoveryStatus {
  const [status, setStatus] = useState<RecoveryStatus>('checking')

  useEffect(() => {
    const unsubscribe = onPasswordRecovery(() => setStatus('ready'))
    const timeout = setTimeout(async () => {
      const ok = await hasSession()
      setStatus(current => (current === 'checking' ? (ok ? 'ready' : 'invalid') : current))
    }, 2500)
    return () => { unsubscribe(); clearTimeout(timeout) }
  }, [])

  return status
}
