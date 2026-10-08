import { supabase } from '../../../integrations/supabase/client'
import { parseFunctionErrorBody } from '../../../shared/utils/functionError'

export type FollowKind = 'collection' | 'company' | 'director' | 'actor' | 'keyword'
export const FOLLOW_KIND_LABEL: Record<FollowKind, string> = { collection: 'Franchise', company: 'Studio', keyword: 'Keyword', director: 'Director', actor: 'Actor' }

export interface MediaFollow {
  id: string; kind: FollowKind; tmdb_id: number; name: string; trakt_list_id: number | null; last_checked_at: string | null; created_at: string
  /** New films its Trakt list has not taken yet, and why (migration 136; absent before it). Sent again at the next check. */
  pending_list_ids?: number[]
  list_error?: string | null
}
export interface MediaFollowEvent { id: string; follow_id: string; kind: 'new_title' | 'trailer'; tmdb_id: number; title: string; poster_path: string | null; release_date: string | null; video_key: string | null; created_at: string; seen_at: string | null }

const missingTable = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /Could not find the table/.test(e.message ?? ''))
const missingColumn = (e: { code?: string } | null) => !!e && (e.code === '42703' || e.code === 'PGRST204')
const NOT_APPLIED = 'Following needs migration 119 (media_follows)'
const FOLLOW_COLS = 'id, kind, tmdb_id, name, trakt_list_id, last_checked_at, created_at'

export async function fetchFollows(): Promise<MediaFollow[]> {
  const read = (cols: string) => supabase.from('media_follows').select(cols).order('created_at')
  let res = await read(`${FOLLOW_COLS}, pending_list_ids, list_error`)
  // Before migration 136 there is no list queue to read.
  if (missingColumn(res.error)) res = await read(FOLLOW_COLS)
  if (missingTable(res.error)) return []
  if (res.error) throw res.error
  return (res.data ?? []) as unknown as MediaFollow[]
}

export async function addFollow(f: { kind: FollowKind; tmdb_id: number; name: string; trakt_list_id?: number | null }) {
  const { error } = await supabase.from('media_follows').upsert(f, { onConflict: 'user_id,kind,tmdb_id' })
  if (missingTable(error)) throw new Error(NOT_APPLIED)
  if (error) throw error
}

export async function updateFollow(id: string, patch: { trakt_list_id: number | null }) {
  const { error } = await supabase.from('media_follows').update(patch).eq('id', id)
  if (error) throw error
}

export async function removeFollow(id: string) {
  const { error } = await supabase.from('media_follows').delete().eq('id', id)
  if (missingTable(error)) throw new Error(NOT_APPLIED)
  if (error) throw error
}

export async function fetchFollowEvents(): Promise<MediaFollowEvent[]> {
  const since = new Date(Date.now() - 90 * 864e5).toISOString()
  const { data, error } = await supabase.from('media_follow_events').select('*').gte('created_at', since).order('created_at', { ascending: false }).limit(100)
  if (missingTable(error)) return []
  if (error) throw error
  return (data ?? []) as MediaFollowEvent[]
}

export async function markEventsSeen(ids: string[]) {
  if (!ids.length) return
  const { error } = await supabase.from('media_follow_events').update({ seen_at: new Date().toISOString() }).in('id', ids)
  if (error) throw error
}

/** Runs the follow check now (trakt-api `follows_check`). `listWaiting`: films a linked Trakt list has not taken yet. */
export async function checkFollowsNow(): Promise<{ checked: number; newTitles: number; trailers: number; listWaiting?: number }> {
  const res = await supabase.functions.invoke('trakt-api', { body: { action: 'follows_check' } })
  let data = res.data
  if (res.error) { const b = await parseFunctionErrorBody(res.error); if (!b?.error) throw res.error; data = b }
  if (data?.error) throw new Error(data.error)
  if (data?.result?.skipped === 'no_tmdb_key') throw new Error('TMDB_API_KEY is not set on the trakt-api function')
  return data.result
}
