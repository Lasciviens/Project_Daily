// Trakt keeps a play logged with "unknown date" as the Unix epoch
// (01.01.1970). Pure and import-free (shared into trakt-api).
//
// Movies store an unknown date as NULL (status 'completed' is what says
// "watched"). Episodes keep the epoch: on user_tv_episodes a row with a
// watched_at IS what "watched" means, and NULL there means "not watched" to
// every reader (progress trigger, tallies, next episode, the AI).

export const UNKNOWN_WATCHED_AT = '1970-01-01T00:00:00.000Z'

export function isUnknownWatchedAt(iso: string | null | undefined): boolean {
  if (!iso) return false
  const t = Date.parse(iso)
  return Number.isFinite(t) && t < Date.UTC(1971, 0, 1)
}

/** A movie's watched date as stored here: NULL when Trakt doesn't know it. */
export function movieWatchedAt(iso: string | null | undefined): string | null {
  return iso && !isUnknownWatchedAt(iso) ? iso : null
}
