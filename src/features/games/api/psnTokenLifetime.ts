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

export type NpssoState = 'unknown' | 'ok' | 'soon' | 'expired'

/** Inside this many days, the UI starts asking for a fresh token. Chosen to
 *  be comfortably longer than a trip away from a desktop browser, since
 *  minting a token needs one. */
export const NPSSO_RENEW_WINDOW_DAYS = 10

export interface NpssoLifetime {
  state: NpssoState
  /** Whole days left; negative once past. Null when the expiry is unknown. */
  days: number | null
}

export function npssoLifetime(expiresAt: string | null | undefined, now = Date.now()): NpssoLifetime {
  // NULL is "unknown", never "expired": a token pasted as a bare value
  // carries no expiry, and every row written before migration 101 has none.
  // Nothing may gate access on a missing date.
  if (!expiresAt) return { state: 'unknown', days: null }
  const ms = Date.parse(expiresAt)
  if (!Number.isFinite(ms)) return { state: 'unknown', days: null }

  const days = Math.floor((ms - now) / 86_400_000)
  if (ms <= now) return { state: 'expired', days }
  return { state: days <= NPSSO_RENEW_WINDOW_DAYS ? 'soon' : 'ok', days }
}

/** Short human phrase for the countdown, e.g. "42 days left". */
export function npssoLifetimeLabel(life: NpssoLifetime): string | null {
  if (life.state === 'unknown' || life.days == null) return null
  if (life.state === 'expired') return 'expired'
  if (life.days === 0) return 'expires today'
  if (life.days === 1) return '1 day left'
  return `${life.days} days left`
}
