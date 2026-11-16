import { supabaseSessionKey } from '../integrations/supabase/client'

// The sign-in this browser holds, read without waiting: supabase-js keeps the session in localStorage under
// `sb-<project>-auth-token` and reads it back asynchronously (auth.getSession). The app's start only needs to know
// "is someone signed in here, who, and is their access still running" to draw the shell and show that account's
// kept answers at once. It is a hint, never a check: every read and write still goes to the database with the
// real session (RLS, the owner lock), and useAuth corrects the screen the moment getSession answers.

interface Stored { userId: string; live: boolean }

function read(): Stored | null {
  try {
    // The exact key of this project — never "a key that looks like one" (the site's origin is shared).
    const raw = supabaseSessionKey ? localStorage.getItem(supabaseSessionKey) : null
    if (!raw) return null
    const session = JSON.parse(raw) as { user?: { id?: unknown }; refresh_token?: unknown; expires_at?: unknown } | null
    const id = session?.user?.id
    if (typeof id !== 'string' || !id || typeof session?.refresh_token !== 'string') return null
    const until = session.expires_at
    return { userId: id, live: typeof until === 'number' && until * 1000 > Date.now() }
  } catch {
    return null
  }
}

/** The id of the account whose session this browser holds, or null (signed out, or storage can't be read). */
export function storedSessionUserId(): string | null {
  return read()?.userId ?? null
}

/**
 * Whether the stored session's access is still running (its hour has not passed). Only then may the start draw
 * on the hint: a session ended elsewhere (a password change, "sign out everywhere") can show this device's kept
 * answers for that hour at most — what its access token could still read anyway — and never after it, because an
 * expired one waits for the server's answer (guardian review, 16.11.2026).
 */
export function storedSessionIsLive(): boolean {
  return read()?.live === true
}

/**
 * Removes the stored session. Sign-out calls it last: supabase-js leaves the session in place when it can't
 * reach the server with an expired token (offline), and the next start would be signed in again.
 */
export function removeStoredSession(): void {
  try { if (supabaseSessionKey) localStorage.removeItem(supabaseSessionKey) } catch { /* */ }
}
