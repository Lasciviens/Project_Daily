import { supabase } from '../../../integrations/supabase/client'
import { parseFunctionErrorBody } from '../../../shared/utils/functionError'
import type { FieldPolicy, MatchBasis, SsCandidate, SsField, SsMediaChoice, SsMediaEntry, SsPrefs, SsQueryOutcome, SsRomQuery } from './ssTypes'
import { defaultPrefs, normalizePrefs } from './ssPlan'
import { PROXY_PATH, proxyQuery, type ProxyRef } from './ssProxy'

// Browser side of `screenscraper-sync` (search, apply, undo, batch) and of the
// `screenscraper-media` proxy (URLs only — the proxy is fetched by <img>).

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, '') ?? ''

/** The deployed function predates this client (it answers an older action set). */
export class ScraperOutdatedError extends Error {
  constructor() { super('The ScreenScraper function on the server is out of date — redeploy screenscraper-sync (and deploy screenscraper-media).') }
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('screenscraper-sync', { body })
  if (error) {
    const detail = (await parseFunctionErrorBody(error))?.error ?? (data as { error?: string } | null)?.error
    const msg = typeof detail === 'string' ? detail : error.message ?? 'screenscraper-sync failed'
    if (/Unknown action/i.test(msg)) throw new ScraperOutdatedError()
    throw new Error(msg)
  }
  if ((data as { status?: string } | null)?.status === 'not_configured') {
    throw new Error('ScreenScraper is not configured on the server (the SCREENSCRAPER_* secrets are missing).')
  }
  return data as T
}

// ─── Status ──────────────────────────────────────────────────────────────────

export interface StorageGroup { category: 'esde_cover' | 'esde_original' | 'screenscraper' | 'pending' | string; files: number; bytes: number }
export interface StorageUsage { total: number; groups: StorageGroup[] }

export interface ScraperStatus {
  status: 'ok'
  account: { level: string; premium: boolean; threads: number; used: number; max: number } | null
  account_error?: string
  remaining_today: number | null
  /** null when migration 104 (game_media_usage) is not applied. */
  storage: StorageUsage | null
  library: { retro: number; scraped: number; missing_cover: number; missing_description: number }
  systems_known: number
}

export const fetchScraperStatus = () => invoke<ScraperStatus>({ action: 'status' })
export const fetchStorageUsage = () => invoke<{ status: 'ok'; storage: StorageUsage | null }>({ action: 'storage' }).then(r => r.storage)
export const refreshSystems = () => invoke<{ status: 'ok'; systems: number }>({ action: 'refresh_systems' })

// ─── Search ──────────────────────────────────────────────────────────────────

export interface SearchRequest {
  name?: string
  /** An ES-DE folder name ("snes") or their numeric id. */
  system?: string | number | null
  rom?: SsRomQuery | null
  jeu_id?: string
  use_name?: boolean
  use_rom?: boolean
}
export interface SearchResponse {
  status: 'ok'
  candidates: SsCandidate[]
  outcomes: SsQueryOutcome[]
  system: { id: number; name: string } | null
  requests: number
  remaining_today: number | null
}

export const searchScreenScraper = (req: SearchRequest) => invoke<SearchResponse>({ action: 'search', ...req })

export interface CandidateResponse {
  status: 'ok' | 'not_found' | 'error'
  candidate?: SsCandidate
  /** Their full answer, every URL removed. */
  record?: Record<string, unknown>
  error?: string
}
export const fetchCandidate = (jeuId: string, matchedBy: MatchBasis[]) =>
  invoke<CandidateResponse>({ action: 'candidate', jeu_id: jeuId, matched_by: matchedBy })

// ─── Apply / undo ────────────────────────────────────────────────────────────

export interface ApplyRequest {
  game_id: string
  jeu_id: string
  system?: string | number | null
  rom?: SsRomQuery | null
  fields: Partial<Record<SsField, FieldPolicy>>
  media: SsMediaChoice[]
  matched_by: MatchBasis[]
  /** A specific regional title / description language picked in the review. */
  overrides?: { title_region?: string | null; description_lang?: string | null }
  /** Settings for this save only (e.g. the full-record switch flipped in the review). */
  prefs?: SsPrefs
  run_id?: string
}
export interface MediaResult { type: string; mode: 'store' | 'on_demand'; ok: boolean; bytes?: number; reason?: string; token?: string }
export interface ApplyResult {
  game_id: string
  outcome: 'applied' | 'no_match' | 'stale' | 'error'
  reason?: string
  matched_title?: string | null
  written?: SsField[]
  skipped?: { field: SsField; reason: string }[]
  media?: MediaResult[]
  bytes_stored?: number
  remaining_today?: number | null
}

export const applyScrape = (req: ApplyRequest) =>
  invoke<{ status: 'ok'; run_id: string; result: ApplyResult }>({ action: 'apply', ...req })

export interface UndoResponse { status: 'ok' | 'no_journal'; reverted?: number; skipped?: { game_id: string; reason: string }[]; message?: string }
export const undoScrape = (runId: string) => invoke<UndoResponse>({ action: 'undo', run_id: runId })

// ─── Batch ───────────────────────────────────────────────────────────────────

export interface FindResult {
  game_id: string
  outcome: 'match' | 'no_match' | 'unmatchable' | 'error'
  basis?: MatchBasis
  reason?: string
  rom_filename?: string | null
  system?: { id: number; name: string } | null
  candidate?: SsCandidate
}
export const findBatch = (gameIds: string[]) =>
  invoke<{ status: 'ok' | 'quota_exhausted'; results?: FindResult[]; remaining_today?: number | null }>({ action: 'find_batch', game_ids: gameIds })

export interface BatchItem { game_id: string; jeu_id: string; system?: number | string | null; rom_filename?: string | null; matched_by: MatchBasis[] }
export const applyBatch = (items: BatchItem[], runId?: string) =>
  invoke<{ status: 'ok'; run_id: string; results: ApplyResult[]; remaining_today?: number | null }>({ action: 'apply_batch', items, run_id: runId })

// ─── Preferences (migration 104) ─────────────────────────────────────────────

const missingTable = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /Could not find the table/i.test(e.message ?? ''))

/** Saved defaults; built-in defaults before migration 104 (a read never fails the page). */
export async function fetchScrapePrefs(): Promise<SsPrefs> {
  const { data, error } = await supabase.from('screenscraper_prefs').select('prefs').maybeSingle()
  if (error) {
    if (missingTable(error)) return defaultPrefs()
    throw error
  }
  return normalizePrefs(data?.prefs)
}

export async function saveScrapePrefs(prefs: SsPrefs): Promise<SsPrefs> {
  const clean = normalizePrefs(prefs)
  const { data: auth } = await supabase.auth.getUser()
  const userId = auth.user?.id
  if (!userId) throw new Error('Not signed in')
  const { error } = await supabase.from('screenscraper_prefs').upsert({ user_id: userId, prefs: clean }, { onConflict: 'user_id' })
  if (error) {
    if (missingTable(error)) throw new Error('Saving scrape settings needs migration 104 (screenscraper_prefs) — not applied yet.')
    throw error
  }
  return clean
}

// ─── Saved ScreenScraper data for one game ───────────────────────────────────

export interface ProviderDataV2 {
  v: 2
  source: 'screenscraper'
  fetched_at: string
  jeu_id: string
  rom_id: string | null
  system_id: number | null
  system_name: string | null
  matched_by: MatchBasis[]
  media_sig: string | null
  saved: Record<string, string>
  linked: string[]
  summary: Omit<SsCandidate, 'media_sig'>
  jeu?: Record<string, unknown>
}

export interface GameScrapeData {
  provider: ProviderDataV2 | null
  /** A pre-rewrite blob (v1) — kept, but shown as "scraped with the old version". */
  legacy: Record<string, unknown> | null
}

/** The heavy per-game blob, only for the one game being looked at — the
 *  library list never loads it. */
export async function fetchGameScrapeData(gameId: string): Promise<GameScrapeData> {
  const { data, error } = await supabase.from('games').select('provider_data').eq('id', gameId).maybeSingle()
  if (error) throw error
  const pd = (data?.provider_data ?? null) as Record<string, unknown> | null
  if (!pd || !Object.keys(pd).length) return { provider: null, legacy: null }
  if (pd.v === 2 && pd.source === 'screenscraper') return { provider: pd as unknown as ProviderDataV2, legacy: null }
  return { provider: null, legacy: pd }
}

// ─── Systems ─────────────────────────────────────────────────────────────────

export interface SsSystem { id: number; name: string | null; retropie_names: string[] | null; company: string | null }
export async function fetchSsSystems(): Promise<SsSystem[]> {
  const { data, error } = await supabase.from('screenscraper_systems').select('id, name, retropie_names, company').order('name')
  if (error) throw error
  return (data ?? []) as SsSystem[]
}

// ─── Proxy URLs ──────────────────────────────────────────────────────────────

/** A proxied file of a signed entry. Null when the entry has no signature
 *  (the server could not tell its system) or the app has no Supabase URL. */
export function ssMediaUrl(
  ref: { jeuId: string; systemId: number | null; sig: string | null },
  entry: Pick<SsMediaEntry, 'ep' | 'token'>,
  opts: { width?: number | null; format?: 'png' | 'jpg' | null } = {},
): string | null {
  if (!SUPABASE_URL || !ref.sig || ref.systemId == null) return null
  return `${SUPABASE_URL}${PROXY_PATH}?${proxyQuery(ref as ProxyRef, entry, opts)}`
}

/** The public ScreenScraper page for an entry — no credentials involved. */
export const ssGamePage = (jeuId: string) => `https://www.screenscraper.fr/gameinfos.php?gameid=${encodeURIComponent(jeuId)}`
