import { supabase } from '../../integrations/supabase/client'

// Shared auth guard for API functions that need the current user's id before
// writing — was independently duplicated as `getUser()` + `throw 'Not
// authenticated'` in ~25 places across the API layer.
//
// Reads the signed-in session the browser already holds (getSession refreshes
// an expired token by itself) instead of auth.getUser(), which asks the auth
// server on every call: one extra round trip before every save (owner,
// 13.10.2026: "the UI keeps me waiting while it saves"). The id is only
// stamped on the row; the database checks it (RLS: user_id = auth.uid(),
// plus the owner lock), so a stale local session can never write as
// someone else — the write is refused and the error is shown.
export async function requireUser() {
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user
  if (!user) throw new Error('Not authenticated')
  return user
}

/** The signed-in user's id from the local session, or null — for best-effort paths that skip quietly. */
export async function currentUserId(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.user?.id ?? null
}
