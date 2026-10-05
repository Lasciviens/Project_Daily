import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import type { Book, BookPatch, KoboSyncState, ReadingEvent, ReadingSettings } from '../types'

// books / reading_page_events / reading_settings come with migration 126.
// Reads degrade to empty before it is applied; a write names the migration
// (the wishesApi rule).

const NOT_MIGRATED = 'The books library is not available yet — migration 126 (books) has not been applied.'
export const READING_DEFAULTS: ReadingSettings = { daily_minutes_goal: 20, streak_min_minutes: 1 }

function isMissing(e: unknown): boolean {
  const x = e as { code?: string; message?: string }
  return x?.code === '42P01' || x?.code === 'PGRST205' || x?.code === '42703' || /Could not find the table|does not exist/i.test(x?.message ?? '')
}
const fail = (e: unknown): never => { throw isMissing(e) ? new Error(NOT_MIGRATED) : e }

export async function fetchBooks(): Promise<Book[]> {
  const out: Book[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('books').select('*').order('title').range(from, from + 999)
    if (error) { if (isMissing(error)) return []; throw error }
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

export async function updateBook(id: string, patch: BookPatch): Promise<void> {
  const { error } = await supabase.from('books').update(patch).eq('id', id)
  if (error) fail(error)
}

export async function createBook(row: { title: string; author?: string | null; read_status?: Book['read_status'] }): Promise<Book> {
  const { data, error } = await supabase.from('books').insert({ ...row, source: 'manual', on_device: false }).select('*').single()
  if (error) fail(error)
  return data as Book
}

export async function deleteBook(id: string): Promise<void> {
  const { error } = await supabase.from('books').delete().eq('id', id)
  if (error) fail(error)
}

/** Writes new queue positions (only the rows whose position changed). */
export async function saveQueueOrder(rows: { id: string; queue_order: number }[]): Promise<void> {
  for (const r of rows) {
    const { error } = await supabase.from('books').update({ queue_order: r.queue_order }).eq('id', r.id)
    if (error) fail(error)
  }
}

/**
 * "These two are the same book": repoints the loser's reading events to the
 * survivor (a duplicate page/time pair is dropped — the unique key makes that
 * safe), fills the survivor's empty fields from the loser, deletes the loser.
 */
export async function mergeBooks(survivor: Book, loser: Book): Promise<void> {
  const { data: events, error } = await supabase.from('reading_page_events')
    .select('id, page, started_at').eq('book_id', loser.id).limit(100000)
  if (error) fail(error)
  const { data: mine, error: e2 } = await supabase.from('reading_page_events')
    .select('page, started_at').eq('book_id', survivor.id).limit(100000)
  if (e2) fail(e2)
  const taken = new Set((mine ?? []).map(r => `${r.page}|${new Date(r.started_at).getTime()}`))
  const move = (events ?? []).filter(r => !taken.has(`${r.page}|${new Date(r.started_at).getTime()}`)).map(r => r.id)
  for (let i = 0; i < move.length; i += 500) {
    const { error: e3 } = await supabase.from('reading_page_events').update({ book_id: survivor.id }).in('id', move.slice(i, i + 500))
    if (e3) fail(e3)
  }
  const fill: BookPatch = {}
  for (const k of ['author', 'series', 'series_index', 'language', 'isbn', 'publisher', 'published_year', 'description', 'page_count', 'cover_url', 'review', 'notes', 'rating', 'started_at', 'finished_at'] as const) {
    if (survivor[k] == null && loser[k] != null) (fill as Record<string, unknown>)[k] = loser[k]
  }
  // The device keys move to the survivor, so the Kobo's next sync updates the survivor instead of re-creating
  // the deleted row.
  const keys: Record<string, unknown> = {}
  if (!survivor.koreader_md5 && loser.koreader_md5) {
    Object.assign(keys, { koreader_md5: loser.koreader_md5, source: loser.source, on_device: loser.on_device })
    if (!survivor.kobo_content_id) keys.kobo_content_id = loser.kobo_content_id
    if (!survivor.file_path) keys.file_path = loser.file_path
  }
  if (Object.keys(fill).length) await updateBook(survivor.id, fill)
  // Order matters: free the md5 on the loser, give it to the survivor, then
  // delete the loser — a failure part-way never leaves the Kobo's key unowned.
  if (Object.keys(keys).length) {
    const { error: e3 } = await supabase.from('books').update({ koreader_md5: null }).eq('id', loser.id)
    if (e3) fail(e3)
    const { error: e4 } = await supabase.from('books').update(keys).eq('id', survivor.id)
    if (e4) fail(e4)
  }
  await deleteBook(loser.id)
}

/** Page events since `fromIso` (paged past PostgREST's 1,000-row cap). */
export async function fetchReadingEvents(fromIso: string, bookId?: string): Promise<ReadingEvent[]> {
  const out: ReadingEvent[] = []
  for (let from = 0; from < 200000; from += 1000) {
    let q = supabase.from('reading_page_events').select('book_id, page, started_at, duration_seconds')
      .gte('started_at', fromIso).order('started_at').range(from, from + 999)
    if (bookId) q = q.eq('book_id', bookId)
    const { data, error } = await q
    if (error) { if (isMissing(error)) return []; throw error }
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

export async function fetchReadingSettings(): Promise<ReadingSettings> {
  const { data, error } = await supabase.from('reading_settings').select('daily_minutes_goal, streak_min_minutes').maybeSingle()
  if (error) { if (isMissing(error)) return READING_DEFAULTS; throw error }
  return data ?? READING_DEFAULTS
}

export async function saveReadingSettings(s: ReadingSettings): Promise<void> {
  const user = await requireUser()
  const { error } = await supabase.from('reading_settings').upsert({ user_id: user.id, ...s, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) fail(error)
}

/** kobo_feed_state incl. the plugin's sync columns; before 126 only the feed columns exist. */
export async function fetchKoboSyncState(): Promise<KoboSyncState | null> {
  const { data, error } = await supabase.from('kobo_feed_state')
    .select('last_feed_at, last_download_at, last_seen_at, last_sync_at, device_id, plugin_version, last_sync_result, battery, charging, koreader_version').maybeSingle()
  if (!error) return data
  if (error.code === '42703') {
    // Before 127: no device facts yet.
    const { data: d1, error: e1 } = await supabase.from('kobo_feed_state')
      .select('last_feed_at, last_download_at, last_seen_at, last_sync_at, device_id, plugin_version, last_sync_result').maybeSingle()
    if (!e1) return d1
  }
  if (isMissing(error)) {
    const { data: d2, error: e2 } = await supabase.from('kobo_feed_state').select('last_feed_at, last_download_at').maybeSingle()
    if (e2) return null
    return d2
  }
  throw error
}

/** Looks up cover, pages and publisher (Nasjonalbiblioteket → Open Library) via the book-meta function. */
export async function lookupBookMeta(id: string, mode: 'full' | 'cover' = 'full'): Promise<{ updated: string[]; source: string | null }> {
  const { data, error } = await supabase.functions.invoke('book-meta', { body: { book_id: id, mode } })
  if (error) throw new Error((data as { message?: string } | null)?.message ?? error.message ?? 'Lookup failed')
  return data as { updated: string[]; source: string | null }
}
