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
  const code = read('code'), scope = read('scope'), error = read('error')
  if (error) return { code: null, scope: null, error }
  if (code && scope) return { code, scope, error: null }
  return null
}
