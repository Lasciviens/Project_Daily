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
 * What a LOOKUP will cost, BEFORE it starts.
 *
 * ScreenScraper's daily counter is account-wide and shared with the handheld's
 * own scraping, so a run that would overshoot has to be visible as a number
 * rather than discovered halfway through.
 *
 * This covers the LOOKUP only: one metadata call per game, plus one candidate
 * cover download per game missing one when artwork is on. Saving costs a
 * second metadata call per approved game — the apply re-fetches and checks that
 * the entry is still the one that was reviewed, which is the whole guarantee —
 * plus a download per approved image that was not already mirrored for the
 * review. `estimateSaveRequests` is that half; the UI shows both rather than
 * quoting one and spending the other.
 */
export function estimateRequests(games: StudioGame[], withMedia: boolean): number {
  // One metadata call each, plus the single candidate cover the review mirrors.
  if (!withMedia) return games.length
  return games.reduce((sum, g) => sum + 1 + (isEmpty(g.primary_cover_url) ? 1 : 0), 0)
}

/** The other half: what approving `n` of them will cost on save. */
export function estimateSaveRequests(games: StudioGame[], withMedia: boolean): number {
  if (!withMedia) return games.length
  return games.reduce((sum, g) => {
    // The cover was already fetched for the review and is promoted by a
    // Storage copy, so only the other two are new downloads.
    const media = (['screenshot_url', 'fanart_url'] as const).filter(f => isEmpty(g[f])).length
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

  // Word overlap, weighed against what the CANDIDATE adds.
  //
  // Two earlier versions were far too generous and the badge carried almost no
  // information as a result:
  //   · a plain `startsWith` made "Contra" vs "Contra III: The Alien Wars"
  //     close — which is the exact wrong match this library actually suffered;
  //   · a `min(words) - 1` threshold degenerated to 1 for a one-word title, so
  //     "Sonic" vs "Amy Rose In Sonic The Hedgehog" was close too.
  // A retro library is mostly one- and two-word titles, so between them the
  // red "titles differ" state was effectively unreachable.
  //
  // Note this deliberately does NOT try to spot a hack or a compilation from
  // words like "Hack" or "Collection". The entry's own `hack`/`notgame` flags
  // say that outright and are shown next to this badge; guessing it from the
  // title would be a second, worse signal disagreeing with the first.
  const aw = a.split(' ')
  const bw = b.split(' ')
  const awSet = new Set(aw)
  const shared = bw.filter(w => awSet.has(w)).length
  const extra = bw.length - shared
  if (shared === 0) return 'loose'
  // Every word of mine is in theirs and they add at most one — a numeral or a
  // single subtitle word.
  if (shared === aw.length && extra <= 1) return 'close'
  // Otherwise real mutual overlap: at least two shared words, and STRICTLY
  // outweighing what they carry that I do not. "Sonic The Hedgehog" inside
  // "Amy Rose In Sonic The Hedgehog" shares three and adds three — a romhack
  // that contains the whole title is still a different game, and the badge
  // must not soften that into "similar".
  return shared >= 2 && extra < shared ? 'close' : 'loose'
}

// ─── The review → apply contract ─────────────────────────────────────────────

export const MEDIA_COLUMNS: FillableField[] = ['primary_cover_url', 'screenshot_url', 'fanart_url']

/**
 * Splits an approved field list into the two things the server takes.
 *
 * Extracted from the component because it IS the contract between what was
 * reviewed and what gets written, and inline in a click handler it was the one
 * load-bearing piece of this feature nothing could test.
 *
 * `external_ref` deliberately never appears here: the provider's own id is
 * bookkeeping the server always writes, not a field the user chooses.
 */
export function splitAcceptedFields(accepted: FillableField[] | null | undefined): { fields: FillableField[]; mediaRoles: FillableField[] } {
  const list = accepted ?? []
  return {
    fields: list.filter(f => !MEDIA_COLUMNS.includes(f)),
    mediaRoles: list.filter(f => MEDIA_COLUMNS.includes(f)),
  }
}

// ─── Progress across sessions ────────────────────────────────────────────────

export type HandledState = 'saved' | 'skipped' | 'no_match'
export type DecisionRow = { game_id: string; decision: string; created_at?: string }

/**
 * What the journal says about each game, newest decision winning.
 *
 * `rows` arrive newest-first (the query orders by `created_at DESC`), so they
 * are walked in reverse and a later decision overwrites an earlier one. An
 * `undone` row REMOVES the game's state entirely rather than marking it — a
 * reverted game is genuinely unhandled again and belongs back in the queue.
 */
export function reduceHandled(rows: DecisionRow[]): Record<string, HandledState> {
  const map: Record<string, HandledState> = {}
  for (const d of [...rows].reverse()) {
    if (d.decision === 'applied') map[d.game_id] = 'saved'
    else if (d.decision === 'rejected') map[d.game_id] = 'skipped'
    else if (d.decision === 'no_match' || d.decision === 'unmatchable') map[d.game_id] = 'no_match'
    else if (d.decision === 'undone') delete map[d.game_id]
  }
  return map
}

// ─── Undo ────────────────────────────────────────────────────────────────────
//
// Undo is NOT implemented here. It is `undo_run` in the edge function, which
// needs the service role and the decision journal. An earlier draft kept a
// client-side `undoPatch`/`AppliedRecord` pair in this file; it had no callers,
// and its tests read as coverage of an undo path that was actually untested.
// Deleted rather than left to mislead.

// ─── Side-by-side comparison ─────────────────────────────────────────────────
//
// The review card used to print "Would fill: description, genres" and, later,
// the incoming values on their own. Neither answers the question a person
// actually asks, which is "is this the same game as mine?" — and that is
// answered by putting what I have next to what they sent and marking each
// line agree or disagree.

export type FieldVerdict = 'match' | 'differs' | 'only_theirs' | 'only_mine' | 'both_empty'

export type FieldComparison = {
  field: FillableField
  label: string
  mine: unknown
  theirs: unknown
  verdict: FieldVerdict
}

/** Display form for a value of any of the fillable shapes. */
export function displayValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—'
  return String(v)
}

/**
 * Loose equality for "do these say the same thing".
 *
 * Case- and order-insensitive for lists, whitespace-insensitive for text: a
 * genre list that reads `Action, Platform` against `platform, action` is a
 * MATCH, and calling it a difference would train the eye to ignore the marks.
 * Numbers compare numerically so `1994` and `"1994"` agree.
 */
export function valuesAgree(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const norm = (v: unknown) => (Array.isArray(v) ? v : v == null ? [] : [v])
      .map(x => String(x).trim().toLowerCase()).filter(Boolean).sort()
    const x = norm(a), y = norm(b)
    return x.length === y.length && x.every((v, i) => v === y[i])
  }
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b)
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()
}

const isBlank = (v: unknown) =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
  || (typeof v === 'string' && v.trim() === '')

/**
 * One row per fillable field, in the order the UI lists them.
 *
 * Every field appears, including ones neither side has: an empty row is how
 * you see that a gap is still a gap after the match, rather than wondering
 * whether it was simply not shown.
 */
export function compareFields(mine: Partial<Record<FillableField, unknown>>, theirs: Partial<Record<FillableField, unknown>>): FieldComparison[] {
  return FILLABLE_FIELDS.map(field => {
    const a = mine[field]
    const b = theirs[field]
    const verdict: FieldVerdict =
      isBlank(a) && isBlank(b) ? 'both_empty'
        : isBlank(a) ? 'only_theirs'
          : isBlank(b) ? 'only_mine'
            : valuesAgree(a, b) ? 'match' : 'differs'
    return { field, label: FIELD_LABEL[field], mine: a, theirs: b, verdict }
  })
}

/**
 * The headline: of the fields BOTH sides filled, how many agree.
 *
 * Deliberately ignores the fields only one side has — a game of mine with
 * nothing but a title would otherwise score a perfect zero-of-zero against
 * every candidate, including the wrong ones.
 */
export function comparableAgreement(rows: FieldComparison[]): { agree: number; comparable: number } {
  const comparable = rows.filter(r => r.verdict === 'match' || r.verdict === 'differs')
  return { agree: comparable.filter(r => r.verdict === 'match').length, comparable: comparable.length }
}
