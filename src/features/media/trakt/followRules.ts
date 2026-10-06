// What's new in a follow (media_follows → media_follow_events): the one rule
// for what counts as a NEW FILM. Pure and import-free: trakt-api uses it when
// it writes events (copied in by scripts/sync-trakt-shared.mjs) and the app
// uses it when it shows them, so rows written under older rules stop showing
// at once. Verified by scripts/verify-media-follows.cjs.
//
// Root cause it fixes: "new" used to mean "not seen in TMDB's list before".
// TMDB lists change for old films all the time — a person gets a late credit
// (an uncredited cameo in Avengers: Endgame), a keyword or studio is tagged
// onto an old film, a studio's "newest 100" window shifts — so long-released
// films were reported as new. Now a title is new only by its OWN date, and
// only feature films count (no documentaries, TV movies, direct-to-video
// compilations, shorts, adult titles, cameos as oneself or archive footage).

/** TMDB movie genres that are not feature films for this feed: Documentary, TV Movie. */
export const FOLLOW_NON_FEATURE_GENRES = [99, 10770]
/** A film released at most this many days before the check (or before the event was written) is still "new". */
export const FOLLOW_NEW_WINDOW_DAYS = 30
/** TMDB runtimes below this are shorts. */
export const FOLLOW_SHORT_MINUTES = 40

/** The fields TMDB returns on a movie in collection parts, /discover/movie and /person/{id}/movie_credits. */
export interface FollowCandidate {
  id?: number
  adult?: boolean | null
  video?: boolean | null
  media_type?: string | null
  genre_ids?: number[] | null
  release_date?: string | null
  poster_path?: string | null
  character?: string | null
  job?: string | null
}

// A cast credit that isn't a role in the film: playing oneself, archive
// footage, an uncredited cameo, or narrating.
const FOLLOW_NOT_A_ROLE = [
  /^\s*(self|himself|herself|themselves|themself)\b/i,
  /\barchive(d)?\s+footage\b/i,
  /\(uncredited\)/i,
  /^\s*narrator\b/i,
]

/** Why a candidate is not a feature film for this follow kind, or null when it is one. */
export function followRejectReason(r: FollowCandidate, kind: string): string | null {
  if (r.media_type && r.media_type !== 'movie') return 'not_movie'
  if (r.adult) return 'adult'
  if (r.video) return 'video'
  if ((r.genre_ids ?? []).some(g => FOLLOW_NON_FEATURE_GENRES.includes(g))) return 'non_feature_genre'
  if (!r.release_date && !r.poster_path) return 'stub'
  if (kind === 'director' && r.job !== 'Director') return 'not_director'
  if (kind === 'actor' && FOLLOW_NOT_A_ROLE.some(re => re.test(String(r.character ?? '')))) return 'not_a_role'
  return null
}

export const isFollowFeature = (r: FollowCandidate, kind: string) => followRejectReason(r, kind) === null

const FOLLOW_DAY_MS = 864e5
const followDayOf = (iso: string) => iso.slice(0, 10)
function followMinusDays(isoDay: string, days: number): string {
  return new Date(Date.parse(`${isoDay.slice(0, 10)}T00:00:00Z`) - days * FOLLOW_DAY_MS).toISOString().slice(0, 10)
}

/**
 * True when a film with this release date is new as of `asOf` (an ISO date or
 * timestamp): not out yet, out within the last FOLLOW_NEW_WINDOW_DAYS days, or
 * announced without a date. A film released earlier is never new, however late
 * TMDB lists it.
 */
export function isNewByDate(release: string | null | undefined, asOf: string): boolean {
  if (!release) return true
  return release.slice(0, 10) >= followMinusDays(followDayOf(asOf), FOLLOW_NEW_WINDOW_DAYS)
}

/** Details (/movie/{id}) say it isn't a coming feature film: a short, or cancelled. Missing values never reject. */
export function followDetailsReject(d: { runtime?: number | null; status?: string | null } | null | undefined): string | null {
  if (!d) return null
  if (typeof d.runtime === 'number' && d.runtime > 0 && d.runtime < FOLLOW_SHORT_MINUTES) return 'short'
  if (String(d.status ?? '').toLowerCase() === 'canceled') return 'canceled'
  return null
}

/** Only real trailers: TMDB's 'Trailer' type on YouTube, not marked unofficial (teasers, clips, featurettes, bloopers… are left out). */
export function isFollowTrailer(v: { site?: string | null; type?: string | null; official?: boolean | null; key?: string | null }): boolean {
  return v.site === 'YouTube' && v.type === 'Trailer' && v.official !== false && !!v.key
}

/** A stored event the app still shows: its title was new (or upcoming) on the day the event was written. */
export function isShowableFollowEvent(e: { release_date: string | null; created_at: string }): boolean {
  return isNewByDate(e.release_date, e.created_at)
}
