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
/** `budget_mb` is the saved budget capped at `hard_cap_mb` — what the server enforces. */
export interface StorageUsage { total: number; groups: StorageGroup[]; budget_mb?: number; hard_cap_mb?: number }

export interface ScraperStatus {
  status: 'ok'
  account: { level: string; premium: boolean; threads: number; used: number; max: number; ko_used?: number; ko_max?: number } | null
  account_error?: string
  remaining_today: number | null
  /** null when migration 104 (game_media_usage) is not applied. */
  storage: StorageUsage | null
  library: { retro: number; scraped: number | null; missing_cover: number; missing_description: number }
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
  /** The id came from the game's previous match (labelled so, not "exact"). */
  previous_id?: boolean
  use_name?: boolean
  use_rom?: boolean
}
export interface SearchResponse {
  status: 'ok' | 'quota_exhausted'
  message?: string
  candidates: SsCandidate[]
  outcomes: SsQueryOutcome[]
  system: { id: number; name: string } | null
  requests: number
  remaining_today: number | null
}

export async function searchScreenScraper(req: SearchRequest): Promise<SearchResponse> {
  const r = await invoke<SearchResponse>({ action: 'search', ...req })
  if (r.status === 'quota_exhausted') throw new Error(r.message ?? "Today's ScreenScraper allowance is nearly used up.")
  return r
}

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
export interface MediaResult { type: string; mode?: 'store' | 'on_demand'; ok: boolean; bytes?: number; reason?: string; token?: string }
export interface ApplyResult {
  game_id: string
  outcome: 'applied' | 'no_match' | 'stale' | 'error'
  reason?: string
  matched_title?: string | null
  verified_rom?: boolean
  written?: SsField[]
  skipped?: { field: SsField; reason: string }[]
  media?: MediaResult[]
  bytes_stored?: number
  remaining_today?: number | null
}

export async function applyScrape(req: ApplyRequest): Promise<{ status: 'ok'; run_id: string; result: ApplyResult }> {
  const r = await invoke<{ status: 'ok' | 'quota_exhausted'; run_id: string; result: ApplyResult; message?: string }>({ action: 'apply', ...req })
  if (r.status === 'quota_exhausted') throw new Error(r.message ?? "Today's ScreenScraper allowance is nearly used up.")
  return r as { status: 'ok'; run_id: string; result: ApplyResult }
}

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
  invoke<{ status: 'ok' | 'quota_exhausted'; results?: FindResult[]; remaining_today?: number | null; message?: string }>({ action: 'find_batch', game_ids: gameIds })

export interface BatchItem { game_id: string; jeu_id: string; system?: number | string | null; rom_filename?: string | null; matched_by: MatchBasis[] }
export async function applyBatch(items: BatchItem[], runId?: string) {
  const r = await invoke<{ status: 'ok' | 'quota_exhausted'; run_id: string; results: ApplyResult[]; not_started?: string[]; remaining_today?: number | null; message?: string }>({ action: 'apply_batch', items, run_id: runId })
  if (r.status === 'quota_exhausted') throw new Error(r.message ?? "Today's ScreenScraper allowance is nearly used up.")
  return r
}

/** Deletes ScreenScraper copies nothing points at (dry run first: count only). */
export const cleanupStorage = (dryRun: boolean) =>
  invoke<{ status: 'ok' | 'error'; files: number; bytes: number; dry_run?: boolean; error?: string }>({ action: 'cleanup', dry_run: dryRun })

/** Fresh proxy signatures for saved games (signatures are never stored). */
export async function signMediaRefs(items: { jeu_id: string; system_id: number }[]): Promise<Map<string, { sig: string; exp: number }>> {
  const r = await invoke<{ status: 'ok'; signatures: { jeu_id: string; system_id: number; sig: string; exp: number }[] }>({ action: 'sign', items })
  return new Map((r.signatures ?? []).map(x => [`${x.jeu_id}|${x.system_id}`, { sig: x.sig, exp: x.exp }]))
}

/** The last saves (one per run), for "Recent saves" with Undo — read from the
 *  journal, which the browser may read but never write. */
export interface RecentRun { run_id: string; created_at: string; games: { game_id: string; title: string | null }[]; undone: boolean }
export async function fetchRecentRuns(limit = 12): Promise<RecentRun[]> {
  const { data, error } = await supabase.from('scrape_decisions')
    .select('run_id, game_id, decision, matched_title, created_at')
    .in('decision', ['applied', 'undone']).order('created_at', { ascending: false }).limit(400)
  if (error) {
    if (missingTable(error)) return []
    throw error
  }
  const runs = new Map<string, RecentRun>()
  const undone = new Set((data ?? []).filter(r => r.decision === 'undone').map(r => `${r.run_id}|${r.game_id}`))
  for (const r of data ?? []) {
    if (r.decision !== 'applied') continue
    const run: RecentRun = runs.get(r.run_id) ?? { run_id: r.run_id, created_at: r.created_at, games: [], undone: true }
    run.games.push({ game_id: r.game_id, title: r.matched_title })
    if (!undone.has(`${r.run_id}|${r.game_id}`)) run.undone = false
    runs.set(r.run_id, run)
  }
  return [...runs.values()].slice(0, limit)
}

/** Game ids whose last automatic lookup found nothing (so a batch can set them apart). */
export async function fetchKnownNoMatches(): Promise<Set<string>> {
  const { data, error } = await supabase.from('scrape_decisions').select('game_id, decision, created_at')
    .in('decision', ['no_match', 'applied']).order('created_at', { ascending: false }).limit(3000)
  if (error) return new Set()
  const seen = new Set<string>()
  const none = new Set<string>()
  for (const r of data ?? []) {
    if (seen.has(r.game_id)) continue
    seen.add(r.game_id)
    if (r.decision === 'no_match') none.add(r.game_id)
  }
  return none
}

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

/** The small pointer on games.provider_data (the heavy record is its own row). */
export interface ProviderDataV2 {
  v: 2
  source: 'screenscraper'
  fetched_at: string
  run_id?: string
  jeu_id: string
  rom_id: string | null
  system_id: number | null
  system_name: string | null
  matched_by: MatchBasis[]
  verified_rom?: boolean
  saved: Record<string, string>
  /** type → the exact version (token) chosen to show online. */
  linked: Record<string, string> | string[]
  media_count?: number
  /** Before migration 104 the record rode here. */
  summary?: Omit<SsCandidate, 'media_sig' | 'media_exp'>
  jeu?: Record<string, unknown>
}

export interface GameScrapeData {
  provider: ProviderDataV2 | null
  /** The full record: normalized summary (+ their raw answer when kept). */
  summary: Omit<SsCandidate, 'media_sig' | 'media_exp'> | null
  raw: Record<string, unknown> | null
  /** A fresh proxy signature for this game's media (never stored). */
  sig: { sig: string; exp: number } | null
  /** A pre-rewrite blob (v1) — kept, but shown as "matched with the old version". */
  legacy: Record<string, unknown> | null
}

/** The heavy per-game data, only for the one game being looked at — the
 *  library list never loads it. */
export async function fetchGameScrapeData(gameId: string): Promise<GameScrapeData> {
  const { data, error } = await supabase.from('games').select('provider_data').eq('id', gameId).maybeSingle()
  if (error) throw error
  const pd = (data?.provider_data ?? null) as Record<string, unknown> | null
  const empty: GameScrapeData = { provider: null, summary: null, raw: null, sig: null, legacy: null }
  if (!pd || !Object.keys(pd).length) return empty
  if (!(pd.v === 2 && pd.source === 'screenscraper')) return { ...empty, legacy: pd }
  const provider = pd as unknown as ProviderDataV2
  let summary = provider.summary ?? null
  let raw = (provider.jeu ?? null) as Record<string, unknown> | null
  const rec = await supabase.from('game_scrape_records').select('summary, raw').eq('game_id', gameId).maybeSingle()
  if (!rec.error && rec.data) {
    summary = rec.data.summary as GameScrapeData['summary']
    raw = rec.data.raw as Record<string, unknown> | null
  }
  let sig: GameScrapeData['sig'] = null
  if (provider.system_id != null) {
    try {
      sig = (await signMediaRefs([{ jeu_id: provider.jeu_id, system_id: provider.system_id }])).get(`${provider.jeu_id}|${provider.system_id}`) ?? null
    } catch { sig = null } // previews then fall back to stored copies only
  }
  return { provider, summary, raw, sig, legacy: null }
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
  ref: { jeuId: string; systemId: number | null; sig: string | null; exp: number | null },
  entry: Pick<SsMediaEntry, 'ep' | 'token'>,
  opts: { width?: number | null; format?: 'png' | 'jpg' | null } = {},
): string | null {
  if (!SUPABASE_URL || !ref.sig || ref.systemId == null || ref.exp == null) return null
  return `${SUPABASE_URL}${PROXY_PATH}?${proxyQuery(ref as ProxyRef, entry, opts)}`
}
/** The proxy reference of a candidate (search result or saved record). */
export const refOf = (c: Pick<SsCandidate, 'jeu_id' | 'system' | 'media_sig' | 'media_exp'>) =>
  ({ jeuId: c.jeu_id, systemId: c.system.id, sig: c.media_sig, exp: c.media_exp })

/** The public ScreenScraper page for an entry — no credentials involved. */
export const ssGamePage = (jeuId: string) => `https://www.screenscraper.fr/gameinfos.php?gameid=${encodeURIComponent(jeuId)}`
