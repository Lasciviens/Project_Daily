// Pure logic for the ScreenScraper workbench.
//
// Import-free on purpose (the progressAggregate.ts convention) so
// `scripts/verify-screenscraper-studio.cjs` can require it through sucrase —
// this repo has no unit-test framework, and every judgement in here (what a
// game is missing, what a run will cost against a shared quota, which fields a
// match may write, what an undo must clear) is one that is wrong silently if
// nobody checks it.

export type StudioGame = {
  id: string
  title: string
  description: string | null
  primary_cover_url: string | null
  screenshot_url: string | null
  fanart_url: string | null
  genres: string[] | null
  release_year: number | null
  publisher: string | null
  developer: string | null
  players: string | null
  age_rating: string | null
  series_name: string | null
  modes: string[] | null
  external_ref: string | null
  external_source: string | null
  synced_at: string | null
  needs_review: boolean
  platforms: { system: string; esde_system?: string | null; esde_path?: string | null; is_primary_variant?: boolean }[]
}

// ─── What a game is missing ──────────────────────────────────────────────────

/** Fields ScreenScraper can actually supply, in the order the UI lists them. */
export const FILLABLE_FIELDS = [
  'primary_cover_url', 'description', 'genres', 'release_year', 'publisher',
  'developer', 'players', 'age_rating', 'series_name', 'modes',
  'screenshot_url', 'fanart_url',
] as const
export type FillableField = typeof FILLABLE_FIELDS[number]

export const FIELD_LABEL: Record<FillableField, string> = {
  primary_cover_url: 'Cover art',
  description: 'Description',
  genres: 'Genres',
  release_year: 'Release year',
  publisher: 'Publisher',
  developer: 'Developer',
  players: 'Players',
  age_rating: 'Age rating',
  series_name: 'Series',
  modes: 'Modes',
  screenshot_url: 'Screenshot',
  fanart_url: 'Fanart',
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'string') return v.trim() === ''
  return false
}

/** Which of the fillable fields this game has nothing in. */
export function missingFields(g: StudioGame): FillableField[] {
  return FILLABLE_FIELDS.filter(f => isEmpty((g as unknown as Record<string, unknown>)[f]))
}

/** A game is worth querying when ScreenScraper could fill something. */
export function hasGaps(g: StudioGame): boolean {
  return missingFields(g).length > 0
}

// ─── Selecting what to work on ───────────────────────────────────────────────

export type StudioFilters = {
  search: string
  /** ES-DE system folder names; empty means every system. */
  systems: string[]
  /** Only games missing ALL of these; empty means "missing anything". */
  missing: FillableField[]
  /** Restrict to rows explicitly flagged for review. */
  needsReviewOnly: boolean
  /** Restrict to rows never scraped (no provider id recorded). */
  neverScrapedOnly: boolean
  /** Hide rows already dealt with in this session. */
  hideHandled: boolean
}

export const EMPTY_FILTERS: StudioFilters = {
  search: '', systems: [], missing: [], needsReviewOnly: false,
  neverScrapedOnly: false, hideHandled: false,
}

export function systemOf(g: StudioGame): string | null {
  const p = g.platforms.find(x => x.is_primary_variant) ?? g.platforms[0]
  return p?.esde_system ?? p?.system ?? null
}

/**
 * The work queue. Deliberately does NOT drop a game that has everything —
 * seeing "nothing missing" is how you know a system is finished, and a user
 * may still want to re-pick a wrong match on a complete row. Ordering puts the
 * emptiest rows first: that is where a batch buys the most.
 */
export function selectCandidates(games: StudioGame[], f: StudioFilters, handled: Set<string> = new Set()): StudioGame[] {
  const q = f.search.trim().toLowerCase()
  return games
    .filter(g => {
      if (f.hideHandled && handled.has(g.id)) return false
      if (q && !g.title.toLowerCase().includes(q)) return false
      if (f.systems.length) {
        const sys = systemOf(g)
        if (!sys || !f.systems.includes(sys)) return false
      }
      if (f.needsReviewOnly && !g.needs_review) return false
      if (f.neverScrapedOnly && g.external_ref) return false
      if (f.missing.length) {
        const miss = new Set(missingFields(g))
        if (!f.missing.every(m => miss.has(m))) return false
      }
      return true
    })
    .sort((a, b) => missingFields(b).length - missingFields(a).length || a.title.localeCompare(b.title))
}

// ─── Quota budgeting ─────────────────────────────────────────────────────────

/**
 * What a run will cost, BEFORE it starts.
 *
 * ScreenScraper's daily counter is account-wide and shared with the handheld's
 * own scraping, so a run that would overshoot has to be visible as a number
 * rather than discovered halfway through. One metadata call per game; media
 * downloads are separate requests, up to three per game (cover, screenshot,
 * fanart) and only for the ones actually missing.
 */
export function estimateRequests(games: StudioGame[], withMedia: boolean): number {
  if (!withMedia) return games.length
  return games.reduce((sum, g) => {
    const media = (['primary_cover_url', 'screenshot_url', 'fanart_url'] as const)
      .filter(f => isEmpty(g[f])).length
    return sum + 1 + media
  }, 0)
}

export type QuotaVerdict = { ok: boolean; cost: number; remaining: number; reason?: string }

/** `floor` mirrors the edge function's own refuse-below threshold. */
export function checkQuota(cost: number, remaining: number | null | undefined, floor = 500): QuotaVerdict {
  if (remaining == null) return { ok: true, cost, remaining: 0, reason: 'Remaining requests unknown — the run will check before starting.' }
  if (remaining < floor) return { ok: false, cost, remaining, reason: `Only ${remaining} requests left today, below the ${floor} floor this account keeps in reserve.` }
  if (cost > remaining - floor) {
    return { ok: false, cost, remaining, reason: `This run needs about ${cost} requests but only ${remaining - floor} are spendable today. Select fewer games, or turn artwork off.` }
  }
  return { ok: true, cost, remaining }
}

// ─── Reviewing a result ──────────────────────────────────────────────────────

export type MatchPreview = {
  gameId: string
  matchedTitle: string | null
  system: string | null
  /** Fields this match would write, as the server reported them. */
  wouldFill: string[]
}

/**
 * Field-level acceptance. A match is rarely all-or-nothing: the cover is right
 * and the description is for the sequel, or vice versa. The default is
 * everything the server offered, because rejecting a field is the exception.
 */
export function defaultAcceptedFields(p: MatchPreview): FillableField[] {
  return p.wouldFill.filter((f): f is FillableField => (FILLABLE_FIELDS as readonly string[]).includes(f))
}

/**
 * How confident this match looks, from the title alone — the only signal
 * available without opening the game. Deliberately not a score out of 100:
 * three named states a person can act on, and an exact-match claim is never
 * made on a normalised comparison alone.
 */
export type MatchConfidence = 'exact' | 'close' | 'loose'

export function normaliseTitle(s: string): string {
  return s.toLowerCase()
    // Drop the parenthesised region/revision tags ROM filenames carry.
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function matchConfidence(mine: string, theirs: string | null | undefined): MatchConfidence {
  if (!theirs) return 'loose'
  const a = normaliseTitle(mine)
  const b = normaliseTitle(theirs)
  if (!a || !b) return 'loose'
  if (a === b) return 'exact'
  if (a.startsWith(b) || b.startsWith(a)) return 'close'
  // Word overlap: "Super Mario World" vs "Super Mario World 2" is close;
  // "Contra" vs "Amy Rose In Sonic The Hedgehog" is not.
  const aw = new Set(a.split(' '))
  const bw = b.split(' ')
  const shared = bw.filter(w => aw.has(w)).length
  return shared >= Math.max(1, Math.min(aw.size, bw.length) - 1) ? 'close' : 'loose'
}

// ─── Undo ────────────────────────────────────────────────────────────────────

/**
 * What a scrape wrote, recorded so it can be taken back.
 *
 * This is possible at all ONLY because a scrape never overwrites: it fills
 * fields that were empty. So undoing is setting exactly those fields back to
 * NULL — no prior values have to be stored, and nothing the user typed can be
 * destroyed by an undo. (A mirrored image file stays in Storage; only the
 * column pointing at it is cleared. Orphaned bytes are cheap; a wrong cover on
 * a card is not.)
 */
export type AppliedRecord = {
  gameId: string
  title: string
  fields: FillableField[]
  at: string
}

export function undoPatch(rec: AppliedRecord): Record<string, null> {
  const patch: Record<string, null> = {}
  for (const f of rec.fields) patch[f] = null
  return patch
}
