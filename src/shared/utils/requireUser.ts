import { supabase } from '../../integrations/supabase/client'

// Shared auth guard for API functions that need the current user's id before
// writing — was independently duplicated as `getUser()` + `throw 'Not
// authenticated'` in ~25 places across the API layer.
export async function requireUser() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  return user
}
