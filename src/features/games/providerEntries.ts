// Pure helpers for the Steam and PlayStation library lists.
//
// Import-free (the progressAggregate.ts convention) so
// `scripts/verify-provider-entries.cjs` can require it through sucrase.

// ─── PlayStation ownership ───────────────────────────────────────────────────

/**
 * How a PlayStation title came to be yours.
 *
 * Sony's purchased list is not one row per game: the same `titleId` appears
 * once as `NONE` (bought outright) and again as `PS_PLUS` when it is ALSO in
 * the catalogue. Keeping only the last row seen — or only the PS_PLUS one, as
 * an earlier version did — throws away half of that, and a game you paid for
 * reads as a rental.
 */
export type Ownership = 'owned' | 'plus' | 'both'

export const OWNERSHIP_LABEL: Record<Ownership, string> = {
  owned: 'Own',
  plus: 'PS+',
  both: 'PS+ & Own',
}

export type PurchasedRow = { titleId?: string | null; membership?: string | null }

/** One entry per title, merging every row Sony returned for it. */
export function mergeOwnership(rows: PurchasedRow[]): Map<string, Ownership> {
  const out = new Map<string, Ownership>()
  for (const r of rows) {
    const id = r?.titleId
    if (!id) continue
    const isPlus = String(r.membership ?? '').toUpperCase() === 'PS_PLUS'
    const now: Ownership = isPlus ? 'plus' : 'owned'
    const prev = out.get(id)
    // Seen both ways round: the merged state is the same either way.
    out.set(id, !prev ? now : prev === now ? prev : 'both')
  }
  return out
}

// ─── "Is this actually a game?" ──────────────────────────────────────────────

export type GameKind = 'game' | 'not_game' | 'unknown'

/**
 * Sony's own category on a played title.
 *
 * `ps4_game`, `ps5_native_game` and `pspc_game` are games; anything else on
 * this list is a media app or a launcher. An absent or unrecognised category
 * is UNKNOWN, never "not a game" — these shapes are reverse-engineered, and
 * hiding a real game because Sony sent a value nobody has seen before is the
 * worse mistake.
 */
export function psnKind(category: string | null | undefined): GameKind {
  const c = String(category ?? '').trim().toLowerCase()
  if (!c) return 'unknown'
  if (c.endsWith('_game') || c === 'game') return 'game'
  if (c === 'unknown') return 'unknown'
  return 'not_game'
}

/**
 * Steam's own `type` from the store, as cached in `steam_apps` (migration 092).
 *
 * `game` is a game. `dlc`, `demo`, `music`, `video`, `hardware`, `tool`,
 * `application`, `mod`, `series`, `episode` and `advertising` are not. An app
 * whose store page has never been fetched has NO type, and that is `unknown`
 * — the library holds hundreds and the store is rate-limited, so most rows are
 * unknown until someone opens them.
 */
export function steamKind(type: string | null | undefined): GameKind {
  const t = String(type ?? '').trim().toLowerCase()
  if (!t) return 'unknown'
  if (t === 'game') return 'game'
  return 'not_game'
}

/**
 * Filter for the "hide things that are not games" toggle.
 *
 * `unknown` is KEPT. The toggle removes what is known not to be a game, never
 * what has simply not been classified — otherwise turning it on would empty a
 * Steam library whose store pages have not been fetched yet, which reads as
 * the app losing the data.
 */
export function hideNonGames<T>(items: T[], kindOf: (item: T) => GameKind): T[] {
  return items.filter(i => kindOf(i) !== 'not_game')
}

/** How many rows a toggle would remove, for an honest label. */
export function countNonGames<T>(items: T[], kindOf: (item: T) => GameKind): number {
  return items.filter(i => kindOf(i) === 'not_game').length
}
