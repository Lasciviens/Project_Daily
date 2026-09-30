// Trakt's OAuth round trip. Trakt sends the user back to the app's root with
// `?code=…&state=…` in the real query string (never in the hash — the Trakt
// app's Redirect URI is the bare root), so this runs in main.tsx before the
// router: it parks the code in sessionStorage and moves the address to
// Settings → Subscriptions, where the Trakt card finishes the connection.
// The `trakt-` state prefix keeps it from ever touching Strava's callback.

const STATE_KEY = 'lasci.trakt.state'
const PENDING_KEY = 'lasci.trakt.pending'
const PREFIX = 'trakt-'

function randomState(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return PREFIX + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/** The state to send to Trakt; kept so the answer can be checked. */
export function newTraktState(): string {
  const state = randomState()
  try { sessionStorage.setItem(STATE_KEY, state) } catch { /* private mode: the check below fails closed */ }
  return state
}

export function captureTraktCallback(): void {
  const params = new URLSearchParams(window.location.search)
  const state = params.get('state') ?? ''
  if (!state.startsWith(PREFIX)) return
  const pending = { code: params.get('code'), state, error: params.get('error') }
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending)) } catch { /* nothing to finish */ }
  window.history.replaceState(null, '', `${window.location.pathname}#/settings?tab=subscriptions`)
}

export type PendingTrakt = { code: string } | { error: string } | null

/** The parked answer, once; checked against the state this browser sent. */
export function takePendingTrakt(): PendingTrakt {
  let raw: string | null
  let expected: string | null
  try {
    raw = sessionStorage.getItem(PENDING_KEY)
    expected = sessionStorage.getItem(STATE_KEY)
    sessionStorage.removeItem(PENDING_KEY)
  } catch { return null }
  if (!raw) return null
  let p: { code?: string | null; state?: string; error?: string | null }
  try { p = JSON.parse(raw) } catch { return null }
  if (p.error) return { error: p.error === 'access_denied' ? 'You declined access on Trakt.' : p.error }
  if (!p.code || !expected || p.state !== expected) return { error: 'The Trakt sign-in could not be verified. Try Connect again.' }
  try { sessionStorage.removeItem(STATE_KEY) } catch { /* ignore */ }
  return { code: p.code }
}
