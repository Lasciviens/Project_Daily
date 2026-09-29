// How much life the stored npsso cookie has left.
//
// Deliberately its own import-free module (the `exerciseGifResolver.ts`
// precedent): `psnApi.ts` pulls in the live Supabase client at module scope,
// which makes it unrequirable from a sucrase verify script. The arithmetic
// below is the part worth testing.
//
// Sony's ssocookie response carries the cookie's own lifetime
// (`expires_in`, ~60 days). That is the ONE date a human can act on here:
// the access token's expiry is refreshed automatically and means nothing to
// them, while this is the deadline on the single manual step the integration
// has — and Sony's login reCAPTCHA means it can't be automated away.

import { formatPlaytime } from './playtimeFormat'

export type NpssoState = 'unknown' | 'ok' | 'soon' | 'expired'

/** Inside this many days, the UI starts asking for a fresh token. Chosen to
 *  be comfortably longer than a trip away from a desktop browser, since
 *  minting a token needs one. */
export const NPSSO_RENEW_WINDOW_DAYS = 10

export interface NpssoLifetime {
  state: NpssoState
  /** Whole days left; negative once past. Null when the expiry is unknown. */
  days: number | null
  /** Whole minutes left; negative once past. Null when the expiry is unknown. */
  minutes: number | null
}

export function npssoLifetime(expiresAt: string | null | undefined, now = Date.now()): NpssoLifetime {
  // NULL is "unknown", never "expired": a token pasted as a bare value
  // carries no expiry, and every row written before migration 101 has none.
  // Nothing may gate access on a missing date.
  if (!expiresAt) return { state: 'unknown', days: null, minutes: null }
  const ms = Date.parse(expiresAt)
  if (!Number.isFinite(ms)) return { state: 'unknown', days: null, minutes: null }

  const days = Math.floor((ms - now) / 86_400_000)
  const minutes = Math.floor((ms - now) / 60_000)
  if (ms <= now) return { state: 'expired', days, minutes }
  return { state: days <= NPSSO_RENEW_WINDOW_DAYS ? 'soon' : 'ok', days, minutes }
}

/**
 * The remaining time, in the same days/hours/minutes units the rest of the
 * Games page uses — "64d 5h 41m", not "64 days left". A bare day count hides
 * the last day entirely: "1 day left" reads the same at 25 hours and at 61
 * minutes, and this is a deadline with a manual, desktop-only fix.
 *
 * Returns null when the expiry is unknown (never a guess), and 'expired' once
 * it has passed — a negative countdown is not information.
 */
export function npssoLifetimeLabel(life: NpssoLifetime): string | null {
  if (life.state === 'unknown' || life.minutes == null) return null
  if (life.state === 'expired') return 'expired'
  return formatPlaytime(life.minutes)
}

/**
 * Read an npsso paste. Sony's ssocookie answer is `{"npsso":"…","expires_in":…}`,
 * but what reaches the textarea depends on the browser: Chrome shows the raw
 * JSON, Firefox's JSON viewer copies `npsso: "…"` / `expires_in: 5183980`
 * lines (or tab-separated ones), and some people copy just the token. Every
 * form that carries the key yields the expiry; only a bare token costs it.
 *
 * Mirrored by hand in supabase/functions/psn-api/index.ts (Deno can't import
 * this file) — change both together.
 */
export function parseNpssoPaste(raw: string): { npsso: string; expiresIn: number | null } {
  const text = String(raw ?? '').trim()
  if (!text) return { npsso: '', expiresIn: null }
  const key = /["']?npsso["']?\s*[:=\t ]\s*["']?([A-Za-z0-9_-]+)/i.exec(text)
  if (key) {
    const exp = /["']?expires_in["']?\s*[:=\t ]\s*["']?(\d+)/i.exec(text)
    const secs = exp ? Number(exp[1]) : NaN
    return { npsso: key[1], expiresIn: Number.isFinite(secs) && secs > 0 ? secs : null }
  }
  return { npsso: text.replace(/^["']+|["']+$/g, ''), expiresIn: null }
}
