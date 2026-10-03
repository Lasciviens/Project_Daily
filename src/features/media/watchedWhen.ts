// "When did you watch it?" — the Trakt app's four answers, as data.
// Pure and import-free (scripts/verify-watched-when.cjs).
//
//   now      → this moment
//   release  → the title's / episode's own release (air) date, midday local
//   other    → a date (and time) the user picked
//   unknown  → Trakt's "unknown date": movies store NULL, episodes the epoch
//              (on user_tv_episodes a NULL watched_at means "not watched").

export type WatchedWhen =
  | { kind: 'now' }
  | { kind: 'release' }
  | { kind: 'other'; iso: string }
  | { kind: 'unknown' }

export const UNKNOWN_EPISODE_WATCHED_AT = '1970-01-01T00:00:00.000Z'

/** A yyyy-MM-dd day as midday local time (so no time zone moves it to the day before). */
export function middayIso(day: string): string {
  return new Date(`${day.slice(0, 10)}T12:00:00`).toISOString()
}

/**
 * The timestamp to store. `release` without a known (past) release date falls
 * back to now. Returns null only for a movie with an unknown date.
 */
export function resolveWatchedAt(when: WatchedWhen, release: string | null | undefined, target: 'movie' | 'episode', nowIso: string): string | null {
  switch (when.kind) {
    case 'now': return nowIso
    case 'other': return when.iso
    case 'unknown': return target === 'movie' ? null : UNKNOWN_EPISODE_WATCHED_AT
    case 'release': {
      if (!release) return nowIso
      const at = middayIso(release)
      return at > nowIso ? nowIso : at
    }
  }
}

/**
 * A completed series' start and finish, from the same answer: Release date
 * = its first and last aired days (never today, the old bug), Other = that
 * day, Unknown = no dates. `now` keeps an existing start untouched.
 */
export function seriesWatchedDates(
  when: WatchedWhen, firstAir: string | null | undefined, lastAir: string | null | undefined, nowIso: string,
): { started_at: string | null; finished_at: string | null } {
  if (when.kind === 'unknown') return { started_at: null, finished_at: null }
  return {
    started_at: resolveWatchedAt(when, firstAir ?? lastAir, 'movie', nowIso),
    finished_at: resolveWatchedAt(when, lastAir ?? firstAir, 'movie', nowIso),
  }
}

/** One short line for a toast / label. */
export function watchedWhenLabel(when: WatchedWhen): string {
  switch (when.kind) {
    case 'now': return 'just now'
    case 'release': return 'on the release date'
    case 'other': return `on ${when.iso.slice(8, 10)}.${when.iso.slice(5, 7)}.${when.iso.slice(0, 4)}`
    case 'unknown': return 'date unknown'
  }
}
