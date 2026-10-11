import type { StravaActivity } from './types.hevy'

// Strava's brand orange is identity data, not theme chrome (THEME.md §2.5).
export const STRAVA_ORANGE = '#FC4C02'

export const STRAVA_TYPE_LABEL: Record<StravaActivity['type'], string> = {
  run: 'Run', walk: 'Walk', cycling: 'Cycling', swim: 'Swim', yoga: 'Yoga', other: 'Other',
}

// ─── OAuth callback ──────────────────────────────────────────────────────────
// Where Strava puts its answer depends on how it joins our hash-router
// redirect_uri: appended to the hash ("#/developer?tab=…&from=strava?state=&
// code=…" or "…&state=&code=…"), or as a real query before the hash
// ("/?state=&code=…#/developer…"). Read both; a second '?' inside the hash
// query is treated as '&'. Pure (scripts/verify-hevy-training.cjs).

export const STRAVA_CALLBACK_KEYS = ['code', 'scope', 'state', 'error', 'from'] as const

export interface StravaCallback {
  code:  string | null
  scope: string | null
  error: string | null
  state: string | null
}

// The OAuth `state` ties Strava's answer to the browser that pressed Connect
// (security audit 10.10.2026): without it, any code in the address — a link
// someone else sent — was exchanged and linked their athlete to this account.
const STATE_KEY = 'lasci.strava.state'
const STATE_PREFIX = 'strava-'

/** A fresh state for one Connect, kept in this tab to check the answer. */
export function newStravaState(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const state = STATE_PREFIX + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  try { sessionStorage.setItem(STATE_KEY, state) } catch { /* private mode: the check fails closed */ }
  return state
}

/** True once for the state this tab sent; anything else (or a second use) is false. */
export function takeStravaState(state: string | null, stored: () => string | null = () => {
  try { return sessionStorage.getItem(STATE_KEY) } catch { return null }
}): boolean {
  const expected = stored()
  try { sessionStorage.removeItem(STATE_KEY) } catch { /* ignore */ }
  return !!state && !!expected && state === expected
}

export function parseStravaCallback(search: string, hash: string): StravaCallback | null {
  const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1).replace(/\?/g, '&') : ''
  const read = (key: string) => {
    for (const q of [hashQuery, search.replace(/^\?/, '')]) {
      const v = new URLSearchParams(q).get(key)
      if (v) return v
    }
    return null
  }
  const code = read('code'), scope = read('scope'), error = read('error'), state = read('state')
  if (error) return { code: null, scope: null, error, state }
  if (code && scope) return { code, scope, error: null, state }
  return null
}
