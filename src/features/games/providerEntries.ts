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

// ─── "Should this row be in the grid?" ───────────────────────────────────────

/**
 * Whether a library row is hidden, for either of the two reasons there are.
 *
 * AUTOMATIC: the provider's own type says it is not a game (a launcher, a
 * streaming app). `unknown` is KEPT — the rule removes what is known not to be
 * a game, never what has simply not been classified yet, or a Steam library
 * whose store pages have not been fetched would empty itself and read as the
 * app losing the data.
 *
 * EXPLICIT: the user ticked "hide", which stores `play_status = 'hidden'` on
 * the library row (migration 102). This wins over everything: it is the only
 * way to hide a title the provider insists IS a game, and — being a real
 * status — it is the same on every device instead of a per-browser toggle.
 *
 * An explicit status can also UN-hide: a row whose provider type says
 * "not a game" but which carries any normal play status is one the user has
 * deliberately taken an interest in, so it stays.
 */
export function isHiddenEntry(kind: GameKind, playStatus: string | null | undefined): boolean {
  if (playStatus === 'hidden') return true
  if (playStatus) return false
  return kind === 'not_game'
}

/** The rows a grid should show, given the toggle's current state. */
export function visibleEntries<T>(
  items: T[],
  hiddenOf: (item: T) => boolean,
  showHidden: boolean,
): T[] {
  return showHidden ? items : items.filter(i => !hiddenOf(i))
}

/** How many rows the toggle is currently keeping out, for an honest label. */
export function countHidden<T>(items: T[], hiddenOf: (item: T) => boolean): number {
  return items.filter(hiddenOf).length
}
