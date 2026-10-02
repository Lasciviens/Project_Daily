import { supabase } from '../../../integrations/supabase/client'
import { parseFunctionErrorBody } from '../../../shared/utils/functionError'
import type { IgdbCandidate } from './igdbMatch'

// Browser side of the `igdb-api` edge function (IGDB needs a Twitch app token
// and refuses browsers, so every call goes through it).

export class IgdbNotConfiguredError extends Error {
  constructor() { super('IGDB is not set up on the server yet — add IGDB_CLIENT_ID and IGDB_CLIENT_SECRET to the Edge Function secrets and deploy igdb-api.') }
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('igdb-api', { body })
  if (error) {
    const detail = (await parseFunctionErrorBody(error))?.error ?? (data as { error?: string } | null)?.error
    const msg = typeof detail === 'string' ? detail : error.message ?? 'igdb-api failed'
    if (/not found|404/i.test(msg) && !detail) throw new Error('The igdb-api function is not deployed yet.')
    throw new Error(msg)
  }
  const err = (data as { error?: string } | null)?.error
  if (err === 'not_configured') throw new IgdbNotConfiguredError()
  if (err === 'not_migrated') throw new Error('The IGDB columns are missing — apply migration 121.')
  if (err) throw new Error(/Unknown action/i.test(err) ? 'The igdb-api function on the server is out of date — redeploy it.' : err)
  return data as T
}

export const fetchIgdbStatus = async (): Promise<{ configured: boolean }> => {
  try { return await invoke<{ configured: boolean }>({ action: 'status' }) } catch (e) {
    if (e instanceof IgdbNotConfiguredError) return { configured: false }
    throw e
  }
}

export interface IgdbMatchItem { game_id: string; query: string; fallback?: string | null; steam_appid?: number | null }
export interface IgdbMatchResult { game_id: string; steam: IgdbCandidate | null; candidates: IgdbCandidate[] }

export const matchIgdb = (items: IgdbMatchItem[]) =>
  invoke<{ results: IgdbMatchResult[] }>({ action: 'match', items }).then(r => r.results ?? [])

export const searchIgdb = (query: string) =>
  invoke<{ candidates: IgdbCandidate[] }>({ action: 'search', query }).then(r => r.candidates ?? [])

export type IgdbMatchKind = 'steam' | 'exact' | 'picked'
export interface IgdbApplyItem { game_id: string; igdb_id: number; match: IgdbMatchKind }
export interface IgdbApplyResult {
  saved: { game_id: string; igdb_id: number; name: string | null; ttb_extra_seconds: number | null; igdb_total_rating: number | null }[]
  failed: { game_id: string; reason: string }[]
}

export const applyIgdb = (items: IgdbApplyItem[]) => invoke<IgdbApplyResult>({ action: 'apply', items })

export const refreshIgdb = (offset: number) =>
  invoke<{ updated: number; done: boolean; next: number }>({ action: 'refresh', offset })

export const unlinkIgdb = (gameId: string) => invoke<{ ok: true }>({ action: 'unlink', game_id: gameId })

/** What `igdb_data` (migration 121) holds — the detail reads it per game. */
export interface IgdbData {
  v: 1
  name: string | null
  year: number | null
  released: string | null
  type: string | null
  summary: string | null
  cover: string | null
  hypes: number | null
  genres: string[]; themes: string[]; modes: string[]; perspectives: string[]
  franchises: string[]; collections: string[]; engines: string[]; platforms: string[]
  developers: string[]; publishers: string[]
  similar: { id: number; name: string; slug: string | null; cover: string | null }[]
}

export async function fetchIgdbData(gameId: string): Promise<IgdbData | null> {
  const { data, error } = await supabase.from('games').select('igdb_data').eq('id', gameId).maybeSingle()
  if (error) {
    // Before migration 121 there is nothing to read.
    if (error.code === '42703' || error.code === 'PGRST204') return null
    throw error
  }
  const d = (data as { igdb_data?: IgdbData | null } | null)?.igdb_data
  return d && typeof d === 'object' ? d : null
}
