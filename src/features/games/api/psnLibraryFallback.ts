import type { Game } from '../types'
import type { PsnPlayedGame } from './psnApi'

// Rendering the PlayStation library from OUR OWN table while Sony is still
// being reached.
//
// The tab used to block on a connection check, then a profile call, then the
// played-games call before anything appeared — three round trips to a
// reverse-engineered API, on every visit, to show a list that had not changed.
// Every one of those games is already in `games` (imported by the same tab),
// so the saved copy paints immediately and the live data replaces it when it
// lands.
//
// Pure and type-only-importing on purpose, so the shaping is verifiable
// without a live Supabase client.

/**
 * Seconds back into the ISO-8601 duration Sony speaks ("PT228H56M").
 *
 * Round-tripping through Sony's own format rather than widening
 * `PsnPlayedGame` keeps every consumer — the sort comparators, the totals, the
 * cards, the modal — working on ONE shape, so the fallback can never drift
 * into being a second, subtly different library view.
 */
export function secondsToIsoDuration(seconds: number | null | undefined): string {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `PT${h}H${m}M${s}S`
}

/**
 * The saved library, shaped as Sony's played-games rows.
 *
 * Only the fields the grid actually reads are filled. `category` is left
 * undefined rather than guessed: it drives the is-this-a-game classification,
 * and inventing one here would hide or reveal rows on a fact we do not have.
 * An explicit `play_status = 'hidden'` still applies, because that is read
 * from the library row itself rather than from this projection.
 */
export function psnGamesFromLibrary(games: Game[]): PsnPlayedGame[] {
  return games
    .filter(g => !!g.external_ref)
    .map(g => ({
      titleId: g.external_ref as string,
      name: g.title,
      localizedName: g.title,
      imageUrl: g.primary_cover_url ?? undefined,
      playCount: g.play_count ?? undefined,
      playDuration: secondsToIsoDuration(g.play_seconds),
      lastPlayedDateTime: g.last_played_at ?? undefined,
    }))
}

/** Titles with a session inside the window — PSN's only "recent" signal. */
export function psnRecentlyPlayed(
  games: PsnPlayedGame[],
  days = 14,
  now = Date.now(),
): PsnPlayedGame[] {
  const cutoff = now - days * 86_400_000
  return games
    .filter(g => {
      const t = g.lastPlayedDateTime ? Date.parse(g.lastPlayedDateTime) : NaN
      return Number.isFinite(t) && t >= cutoff
    })
    .sort((a, b) =>
      Date.parse(b.lastPlayedDateTime as string) - Date.parse(a.lastPlayedDateTime as string))
}
