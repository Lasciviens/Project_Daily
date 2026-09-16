import { supabase } from '../../../integrations/supabase/client'

// Client side of the `screenscraper-sync` edge function.
//
// The batch loop lives in the CALLER, not here and not in the function: one
// invocation handles a handful of games (a metadata call plus up to three image
// downloads each), so a full library is many invocations. That is the same
// shape steam-api's `app_details` already uses, and it is what lets the UI show
// real progress and stop halfway.

export type ScrapeOutcome = 'matched' | 'no_match' | 'unmatchable' | 'error'

export type ScrapeResult = {
  id: string
  title: string | null
  outcome: ScrapeOutcome
  reason?: string
  filled?: string[]
  media?: string[]
  would_fill?: string[]
  matched_title?: string | null
  /** Which ScreenScraper system was searched — surfaced so a wrong alias
   *  resolution is visible in the result rather than silently wrong. */
  system?: string
  dry_run?: boolean
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
  dryRun?: boolean
  media?: boolean
}): Promise<ScrapeBatch> {
  return invoke<ScrapeBatch>({
    action: 'scrape',
    limit: opts.limit,
    ...(opts.gameIds?.length ? { game_ids: opts.gameIds } : {}),
    ...(opts.systems?.length ? { systems: opts.systems } : {}),
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
  players: string | null
  has_cover: boolean
  description: string | null
}

export type SearchResponse = {
  status: 'ok' | 'not_configured'
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

export function searchScreenScraper(query: string, system?: string | null): Promise<SearchResponse> {
  return invoke<SearchResponse>({ action: 'search', query, ...(system ? { system } : {}) })
}

export function applyMatch(opts: {
  gameId: string
  jeuId: string
  /** The query the candidate came from — the match is re-fetched from that
   *  same search rather than by id (see the edge function's own note). */
  query: string
  system?: string | null
  dryRun?: boolean
}): Promise<ApplyMatchResponse> {
  return invoke<ApplyMatchResponse>({
    action: 'apply_match',
    game_id: opts.gameId,
    jeu_id: opts.jeuId,
    query: opts.query,
    ...(opts.system ? { system: opts.system } : {}),
    dry_run: opts.dryRun === true,
  })
}
