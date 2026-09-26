import { supabase, getSession } from '../../../security/supabaseClient'

/** Calls `onRecovery` when Supabase processes a password-recovery link. Returns an unsubscribe. */
export function onPasswordRecovery(onRecovery: () => void): () => void {
  const { data } = supabase.auth.onAuthStateChange(event => {
    if (event === 'PASSWORD_RECOVERY') onRecovery()
  })
  return () => data.subscription.unsubscribe()
}

export async function hasSession(): Promise<boolean> {
  return (await getSession()) != null
}
