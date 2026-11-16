// The sign-in this browser holds, read without waiting: supabase-js keeps the session in localStorage under
// `sb-<project>-auth-token` and reads it back asynchronously (auth.getSession). The app's start only needs to know
// "is someone signed in here, and who" to draw the shell and show that account's kept answers at once. It is a
// hint, never a check: every read and write still goes to the database with the real session (RLS, the owner
// lock), and useAuth corrects the screen the moment getSession answers.

/** supabase-js's own key: `sb-<project>-auth-token` (one project per site, so the one such key is it). */
const SESSION_KEY = /^sb-[a-z0-9-]+-auth-token$/i

function storageKey(): string | null {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && SESSION_KEY.test(key)) return key
  }
  return null
}

/** The id of the account whose session this browser holds, or null (signed out, or storage can't be read). */
export function storedSessionUserId(): string | null {
  try {
    const key = storageKey()
    const raw = key ? localStorage.getItem(key) : null
    if (!raw) return null
    const session = JSON.parse(raw) as { user?: { id?: unknown }; refresh_token?: unknown } | null
    const id = session?.user?.id
    return typeof id === 'string' && id && typeof session?.refresh_token === 'string' ? id : null
  } catch {
    return null
  }
}
