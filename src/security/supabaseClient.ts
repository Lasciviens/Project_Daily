import { supabase } from '../integrations/supabase/client'
import { clearAccountState, forgetThisDevicePush } from './accountState'

export { supabase }

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

export async function signIn(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password })
}

export async function signOut() {
  await forgetThisDevicePush()   // while the session still works
  const result = await supabase.auth.signOut()
  await clearAccountState()
  // A fresh page drops every answer cached in memory for the signed-out account.
  window.location.replace(`${window.location.pathname}#/login`)
  window.location.reload()
  return result
}

// redirectTo must be in Supabase Dashboard → Authentication → URL Configuration
// → Redirect URLs, or Supabase silently refuses to send the recovery token.
export async function requestPasswordReset(email: string) {
  const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}#/reset-password`
  return supabase.auth.resetPasswordForEmail(email, { redirectTo })
}

export async function updatePassword(password: string) {
  return supabase.auth.updateUser({ password })
}
