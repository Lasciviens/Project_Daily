import type { TraktItem, TraktSnapshot } from './traktTypes'

// The owner's picks for Trakt items that have no TMDB id (migration 200). A row is INPUT — the browser can write the table —
// so every value is checked here, and a pick only ever fills an id that Trakt did not give. Pure: the sync loads the rows,
// these functions decide what to use (verify-trakt-manual-match).

/** The biggest id the table's integer columns hold. */
const MAX_ID = 2_147_483_647

/** 'movie:123' — the kind and the TRAKT id. */
export const matchKey = (kind: string, traktId: number) => `${kind}:${traktId}`

const goodId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= MAX_ID

/** The rows of trakt_manual_matches as a map (matchKey → TMDB id). A row that is not exactly a movie/show, a Trakt id and a TMDB id is dropped. */
export function parseManualMatches(rows: unknown): Map<string, number> {
  const out = new Map<string, number>()
  if (!Array.isArray(rows)) return out
  for (const r of rows) {
    if (typeof r !== 'object' || r === null) continue
    const { kind, trakt_id, tmdb_id } = r as Record<string, unknown>
    if ((kind !== 'movie' && kind !== 'show') || !goodId(trakt_id) || !goodId(tmdb_id)) continue
    out.set(matchKey(kind, trakt_id), tmdb_id)
  }
  return out
}

function everyItem(snap: TraktSnapshot): TraktItem[] {
  return [
    ...snap.watchedMovies.map(x => x.item), ...snap.watchedShows.map(x => x.item), ...snap.watchlist.map(x => x.item),
    ...snap.ratings.map(x => x.item), ...snap.favorites.map(x => x.item), ...snap.dropped.map(x => x.item), ...snap.playback.map(x => x.item),
  ].filter((i): i is TraktItem => !!i)
}

export interface ManualMatchResult {
  /** The picks used (matchKey → TMDB id) — what a per-title history read fills in. */
  used: Map<string, number>
  /** Picks left alone: Trakt gives that TMDB id to another item, or two picks name one title. */
  clashes: number
  /** Which picks (matchKey) were left alone — the unmatched list says why. */
  clashKeys: Set<string>
}

/** Why a pick was not used, as `trakt_unmatched` and the screen say it. */
export const PICK_NOT_USED = 'Your pick was not used: that TMDB title is already linked to another Trakt item'

/**
 * A short fingerprint of the picks (the count and a hash of the sorted kind, Trakt id, TMDB id rows), kept in
 * trakt_sync_state: a sync that finds it changed reads Trakt even when Trakt itself has nothing new, so a save, a change or a
 * removal is linked at the next 30-minute run. Counts the rows, not only the used picks, so a delete changes it.
 */
export function matchesFingerprint(matches: Map<string, number>): string {
  const lines = [...matches].map(([k, v]) => `${k}:${v}`).sort()
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (const ch of lines.join('\n')) {
    const c = ch.codePointAt(0)!
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return `${lines.length}:${(h2 >>> 0).toString(16)}${(h1 >>> 0).toString(16)}`
}

/**
 * Fills `ids.tmdb` of the snapshot's items that have none. Never overrides an id Trakt gave; a pick whose TMDB id Trakt
 * already gives to another item of the same kind (or that another pick also names) is not used — one library title never
 * stands for two Trakt items.
 */
export function applyManualMatches(snap: TraktSnapshot, matches: Map<string, number>): ManualMatchResult {
  const used = new Map<string, number>()
  const clashKeys = new Set<string>()
  if (!matches.size) return { used, clashes: 0, clashKeys }
  const items = everyItem(snap)
  const taken = new Set<string>()
  for (const i of items) if (i.ids.tmdb) taken.add(`${i.type}:${i.ids.tmdb}`)
  let clashes = 0
  const claimed = new Map<string, string>()
  for (const i of items) {
    if (i.ids.tmdb || !(i.ids.trakt > 0)) continue
    const key = matchKey(i.type, i.ids.trakt)
    const tmdb = matches.get(key)
    if (tmdb === undefined) continue
    const title = `${i.type}:${tmdb}`
    const owner = claimed.get(title)
    if (taken.has(title) || (owner !== undefined && owner !== key)) { if (!clashKeys.has(key)) { clashes++; clashKeys.add(key) } continue }
    claimed.set(title, key)
    used.set(key, tmdb)
    i.ids.tmdb = tmdb
  }
  return { used, clashes, clashKeys }
}

/**
 * A history read's rows with the TMDB id filled from the used picks where Trakt's row has none (a per-title read returns
 * rows whose movie/show has the Trakt id only). The rows are copied, not changed.
 */
export function fillHistoryIds(rows: unknown, used: Map<string, number>): unknown {
  if (!used.size || !Array.isArray(rows)) return rows
  return rows.map(r => {
    if (typeof r !== 'object' || r === null) return r
    const row = r as Record<string, unknown>
    const kind = row.type === 'movie' ? 'movie' : row.type === 'episode' ? 'show' : null
    const holder = kind === 'movie' ? row.movie : kind === 'show' ? row.show : null
    if (!kind || typeof holder !== 'object' || holder === null) return r
    const ids = (holder as Record<string, unknown>).ids
    if (typeof ids !== 'object' || ids === null) return r
    const have = (ids as Record<string, unknown>).tmdb
    const trakt = (ids as Record<string, unknown>).trakt
    if (have || typeof trakt !== 'number') return r
    const tmdb = used.get(matchKey(kind, trakt))
    if (tmdb === undefined) return r
    return { ...row, [kind === 'movie' ? 'movie' : 'show']: { ...(holder as object), ids: { ...(ids as object), tmdb } } }
  })
}
