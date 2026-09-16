import { supabase } from '../../../integrations/supabase/client'

// Client side of the `screenscraper-sync` edge function.
//
// The batch loop lives in the CALLER, not here and not in the function: one
// invocation handles a handful of games (a metadata call plus up to three image
// downloads each), so a full library is many invocations. That is the same
// shape steam-api's `app_details` already uses, and it is what lets the UI show
// real progress and stop halfway.

export type ScrapeOutcome = 'matched' | 'no_match' | 'unmatchable' | 'error'

export type ScrapeOutcomeExt = ScrapeOutcome | 'stale_proposal'

export type ScrapeResult = {
  id: string
  title: string | null
  outcome: ScrapeOutcomeExt
  reason?: string
  filled?: string[]
  media?: string[]
  would_fill?: string[]
  /** The actual VALUES a match offers, not just their names. Approving
   *  "description" means nothing until you can read the description. */
  proposed?: Record<string, unknown>
  matched_title?: string | null
  /** The entry's id, carried back on apply so the write is provably the one
   *  that was reviewed rather than a second, independent lookup. */
  jeu_id?: string | null
  /** The ROM filename the match was made on — the actual match key, and the
   *  string a wrong match is usually explained by. */
  rom_name?: string | null
  /** The entry's own markers: hack, beta, proto, "not a game", its region. */
  flags?: string[]
  /** A candidate cover mirrored into a quarantine prefix for review. Always a
   *  Supabase Storage URL — a ScreenScraper media URL can never reach the
   *  browser, since they carry the developer credentials. */
  pending_cover_url?: string | null
  /** Which ScreenScraper system was searched — surfaced so a wrong alias
   *  resolution is visible in the result rather than silently wrong. */
  system?: string
  dry_run?: boolean
}

export type ReviewedItem = {
  game_id: string
  /** The entry that was reviewed. A mismatch on apply is refused, not written. */
  jeu_id?: string | null
  /** Columns approved for writing. */
  fields: string[]
  /** Image columns approved: primary_cover_url / screenshot_url / fanart_url. */
  media_roles: string[]
}

export type ApplyReviewedResponse = {
  status: 'ok' | 'not_configured'
  run_id?: string
  applied?: number
  results?: ScrapeResult[]
  message?: string
}

export type UndoRunResponse = {
  status: 'ok' | 'no_journal'
  reverted?: number
  skipped?: { game_id: string; reason: string }[]
  message?: string
}

export type ScrapeBatch = {
  status: 'ok' | 'quota_exhausted' | 'needs_systems' | 'not_configured'
  dry_run?: boolean
  processed?: number
  matched?: number
  no_match?: number
  unmatchable?: number
  errors?: number
  remaining_today?: number
  results?: ScrapeResult[]
  done?: boolean
  message?: string
}

export type ScreenScraperStatus = {
  status: 'ok' | 'not_configured' | 'error'
  premium?: boolean
  account?: { level: string; threads: number; requests_today: number; requests_max: number }
  remaining_today?: number
  systems_known?: number
  games_missing_metadata?: number
  games_missing_cover?: number
  error?: string
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('screenscraper-sync', { body })
  if (error) {
    // The function scrubs its own credentials before answering; this only
    // surfaces whatever came back.
    const detail = (data as { error?: string } | null)?.error
    throw new Error(detail ?? error.message ?? 'screenscraper-sync failed')
  }
  return data as T
}

export const fetchScreenScraperStatus = () => invoke<ScreenScraperStatus>({ action: 'status' })

export const refreshScreenScraperSystems = () =>
  invoke<{ status: string; systems: number; with_retropie_name: number }>({ action: 'refresh_systems' })

export function scrapeBatch(opts: {
  limit: number
  gameIds?: string[]
  /** ES-DE system folder names to scope the automatic candidate pick to.
   *  Ignored when `gameIds` is given — that is already an exact list. */
  systems?: string[]
  /** Per-game field acceptance: `{ [gameId]: ['description', 'genres'] }`.
   *  A game absent from the map gets everything the match offered; a game
   *  mapped to [] gets nothing written, which is a real answer. */
  fieldsByGame?: Record<string, string[]>
  dryRun?: boolean
  media?: boolean
}): Promise<ScrapeBatch> {
  return invoke<ScrapeBatch>({
    action: 'scrape',
    limit: opts.limit,
    ...(opts.gameIds?.length ? { game_ids: opts.gameIds } : {}),
    ...(opts.systems?.length ? { systems: opts.systems } : {}),
    ...(opts.fieldsByGame ? { fields_by_game: opts.fieldsByGame } : {}),
    dry_run: opts.dryRun === true,
    media: opts.media !== false,
  })
}

// ─── Search + hand-picked match ──────────────────────────────────────────────
// No image URL ever crosses this boundary: every ScreenScraper media URL
// carries the developer credentials in its query string, so a candidate can
// only report WHETHER it has a cover. The chosen one's artwork is downloaded
// server-side and re-hosted in Supabase Storage by `applyMatch`.

export type SearchCandidate = {
  jeu_id: string | null
  title: string | null
  system: string | null
  release_year: number | null
  publisher: string | null
  developer: string | null
  genres: string[] | null
  modes: string[] | null
  players: string | null
  age_rating: string | null
  series_name: string | null
  has_cover: boolean
  description: string | null
  /** The entry's own markers: hack, beta, proto, "not a game", its region. */
  flags?: string[]
}

/**
 * How to ask for a game.
 *
 * `name` is the weakest of these and was the only one offered. ScreenScraper's
 * jeuInfos.php documents `crc`, `md5`, `sha1`, `romnom`, `romtaille`,
 * `serialnum` and `gameid` as well — a hash is an exact identity, a filename
 * is a guess, and a name is a guess with competition. jeuRecherche really does
 * take only `recherche` + `systemeid`, so the other modes go through jeuInfos
 * and answer with ONE definite game instead of a list.
 */
export type LookupMode = 'name' | 'gameid' | 'rom' | 'hash' | 'serial'

export type LookupInput = {
  mode: LookupMode
  system?: string | null
  /** mode 'name' */
  query?: string
  /** mode 'gameid' — the numeric id from a screenscraper.fr game page. */
  gameRef?: string
  /** mode 'rom' */
  romnom?: string
  romtaille?: number | null
  /** mode 'hash' */
  hashKind?: 'crc' | 'md5' | 'sha1'
  hash?: string
  /** mode 'serial' — the disc serial, e.g. SLUS-00001. */
  serial?: string
}

export type SearchResponse = {
  status: 'ok' | 'not_configured'
  mode?: LookupMode
  query?: string
  results?: SearchCandidate[]
  message?: string
}

export type ApplyMatchResponse = {
  status: 'ok' | 'not_configured'
  outcome?: 'matched' | 'no_match'
  dry_run?: boolean
  matched_title?: string | null
  would_fill?: string[]
  filled?: string[]
  media?: string[]
  message?: string
}

export function lookupScreenScraper(input: LookupInput): Promise<SearchResponse> {
  return invoke<SearchResponse>({
    action: 'lookup',
    mode: input.mode,
    ...(input.system ? { system: input.system } : {}),
    ...(input.query ? { query: input.query } : {}),
    ...(input.gameRef ? { game_ref: input.gameRef } : {}),
    ...(input.romnom ? { romnom: input.romnom } : {}),
    ...(input.romtaille ? { romtaille: input.romtaille } : {}),
    ...(input.hashKind ? { hash_kind: input.hashKind } : {}),
    ...(input.hash ? { hash: input.hash } : {}),
    ...(input.serial ? { serial: input.serial } : {}),
  })
}

export function applyMatch(opts: {
  gameId: string
  jeuId: string
  /** Only needed as a FALLBACK: the entry is fetched by its id first, and the
   *  search is re-run only if that comes back empty. A candidate from a hash,
   *  serial or id lookup has no query at all. */
  query?: string
  system?: string | null
  /** Restrict the write to these columns; omitted means everything found. */
  fields?: string[]
  dryRun?: boolean
}): Promise<ApplyMatchResponse> {
  return invoke<ApplyMatchResponse>({
    action: 'apply_match',
    game_id: opts.gameId,
    jeu_id: opts.jeuId,
    ...(opts.query ? { query: opts.query } : {}),
    ...(opts.system ? { system: opts.system } : {}),
    ...(opts.fields ? { fields: opts.fields } : {}),
    dry_run: opts.dryRun === true,
  })
}

/** Write exactly what was reviewed — see the edge function's own note on why
 *  this exists instead of a second `scrape` pass. */
export function applyReviewed(items: ReviewedItem[], runId?: string): Promise<ApplyReviewedResponse> {
  return invoke<ApplyReviewedResponse>({ action: 'apply_reviewed', items, ...(runId ? { run_id: runId } : {}) })
}

/** Take a whole run back. Costs nothing against the quota — a local revert. */
export function undoRun(runId: string): Promise<UndoRunResponse> {
  return invoke<UndoRunResponse>({ action: 'undo_run', run_id: runId })
}

/** Delete candidate covers nobody approved. */
export function sweepPendingArt(): Promise<{ status: string; removed?: number }> {
  return invoke({ action: 'sweep_pending' })
}

// ─── The decision journal (migration 097) ────────────────────────────────────
// Read directly under RLS rather than through the function: it is the user's
// own rows and no provider call is involved.

export type ScrapeDecision = {
  id: string
  game_id: string
  run_id: string
  decision: 'applied' | 'rejected' | 'no_match' | 'unmatchable' | 'undone'
  jeu_id: string | null
  matched_title: string | null
  system_used: string | null
  fields_written: string[]
  created_at: string
}

/**
 * Every decision, in the two narrow columns the "already handled" map needs.
 *
 * Deliberately NOT the same query as the run list. An earlier version read one
 * 400-row page of `select('*')` and built both from it — so once roughly a
 * third of a 1150-game library had been decided, the oldest rows fell off the
 * page and those games silently re-entered the queue as unhandled. Which is
 * precisely the bug this table was added to fix, just deferred.
 *
 * Pre-migration-safe: no journal degrades to no history, never a crash.
 */
export async function fetchDecisionStates(): Promise<{ game_id: string; decision: string }[]> {
  const page = 1000
  const out: { game_id: string; decision: string }[] = []
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from('scrape_decisions').select('game_id, decision')
      .order('created_at', { ascending: false }).range(from, from + page - 1)
    if (error) return from === 0 ? [] : out
    out.push(...(data ?? []))
    if (!data || data.length < page) break
  }
  return out
}

/** The recent-runs panel only ever shows a handful. */
export async function fetchRecentDecisions(limit = 200): Promise<ScrapeDecision[]> {
  const { data, error } = await supabase
    .from('scrape_decisions').select('*')
    .order('created_at', { ascending: false }).limit(limit)
  if (error) return []
  return (data ?? []) as ScrapeDecision[]
}

/** A rejection is a real decision and worth remembering — it is what stops a
 *  game being offered again in three weeks. Best-effort for the same reason
 *  the server's own writer is. */
export async function recordRejections(
  runId: string,
  rows: { gameId: string; decision: ScrapeDecision['decision']; jeuId?: string | null; matchedTitle?: string | null; systemUsed?: string | null }[],
): Promise<void> {
  if (!rows.length) return
  await supabase.from('scrape_decisions').insert(rows.map(r => ({
    game_id: r.gameId, run_id: runId, decision: r.decision,
    jeu_id: r.jeuId ?? null, matched_title: r.matchedTitle ?? null, system_used: r.systemUsed ?? null,
  })))
}
