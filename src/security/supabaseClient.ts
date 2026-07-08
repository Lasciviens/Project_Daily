import { supabase } from '../integrations/supabase/client'

export { supabase }

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

export async function signIn(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password })
}

export async function signOut() {
  return supabase.auth.signOut()
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
