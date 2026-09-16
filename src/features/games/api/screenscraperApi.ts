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
  dryRun?: boolean
  media?: boolean
}): Promise<ScrapeBatch> {
  return invoke<ScrapeBatch>({
    action: 'scrape',
    limit: opts.limit,
    ...(opts.gameIds?.length ? { game_ids: opts.gameIds } : {}),
    dry_run: opts.dryRun === true,
    media: opts.media !== false,
  })
}
