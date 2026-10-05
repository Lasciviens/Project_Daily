import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { safeFileName, storageFileName } from '../opdsFeed'
import type { BookDelivery } from '../types'

// book_deliveries / kobo_feed_state / the kobo-inbox bucket come with
// migration 125. Reads degrade to empty before it is applied; a write names
// the missing migration instead of failing silently (the wishesApi rule).

const BUCKET = 'kobo-inbox'
export const MAX_FILE_BYTES = 50 * 1024 * 1024
export const INBOX_CAP_BYTES = 100 * 1024 * 1024
export const ACCEPTED = ['.epub', '.kepub.epub', '.pdf']
const NOT_MIGRATED = 'Send to Kobo is not available yet — migration 125 (Kobo inbox) has not been applied.'

function isMissingTable(e: unknown): boolean {
  const x = e as { code?: string; message?: string }
  return x?.code === '42P01' || x?.code === 'PGRST205' || /Could not find the table|Bucket not found/i.test(x?.message ?? '')
}

export function isAcceptedFile(name: string): boolean {
  const n = name.toLowerCase()
  return ACCEPTED.some(ext => n.endsWith(ext))
}

export async function fetchDeliveries(): Promise<BookDelivery[]> {
  const { data, error } = await supabase
    .from('book_deliveries')
    .select('id, storage_path, filename, mime, size_bytes, title, author, status, created_at, downloaded_at')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) {
    if (isMissingTable(error)) return []
    throw error
  }
  return data ?? []
}

/** Writes the row first (the database refuses it past the 100 MB inbox cap (migration 127)), then uploads the file. */
export async function sendToKobo(file: File, extra: { title?: string | null; author?: string | null; book_id?: string | null } = {}): Promise<BookDelivery> {
  if (!isAcceptedFile(file.name)) throw new Error(`${file.name}: only EPUB, KEPUB and PDF files can be sent.`)
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is larger than 50 MB — send it over USB or Calibre instead.`)
  const user = await requireUser()
  const id = crypto.randomUUID()
  const filename = safeFileName(file.name)
  const storage_path = `${user.id}/${id}/${storageFileName(filename)}`
  const mime = /\.pdf$/i.test(filename) ? 'application/pdf' : 'application/epub+zip'
  const insert = (fields: Record<string, unknown>) => supabase
    .from('book_deliveries')
    .insert({ id, user_id: user.id, storage_path, filename, mime, size_bytes: file.size, ...withoutEmpty(fields) })
    .select('id, storage_path, filename, mime, size_bytes, title, author, status, created_at, downloaded_at')
    .single()
  let { data, error } = await insert(extra)
  // Before migration 128 there is no book_id column: send without the link.
  if (error && /book_id/.test(error.message ?? '')) ({ data, error } = await insert({ ...extra, book_id: null }))
  if (error || !data) throw isMissingTable(error) ? new Error(NOT_MIGRATED) : error ?? new Error('Could not add the file to the inbox.')
  const { error: upError } = await supabase.storage.from(BUCKET).upload(storage_path, file, { contentType: mime, upsert: false })
  if (upError) {
    await supabase.from('book_deliveries').delete().eq('id', id)
    throw isMissingTable(upError) ? new Error(NOT_MIGRATED) : upError
  }
  return data
}

const withoutEmpty = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== ''))

export interface PreparedBook {
  bytes: Uint8Array
  fileName: string
  /** KOReader's partial md5 of exactly these bytes. */
  md5: string
  row: Record<string, unknown> & { title: string; author: string | null; read_status: string }
}

/**
 * Sends a reviewed file: the library row first (found by the Kobo's book id,
 * or made — the Kobo's next sync then matches it and only fills what is still
 * empty), then the file into the inbox. A row made here is removed again if
 * the upload fails. An existing book keeps its status; its details take what
 * was typed.
 */
export async function sendPrepared(p: PreparedBook): Promise<BookDelivery> {
  const user = await requireUser()
  const { data: found, error: e1 } = await supabase.from('books').select('id').eq('koreader_md5', p.md5).maybeSingle()
  if (e1) throw e1
  let bookId: string
  let made = false
  // Before migration 128 there are no categories/subjects columns: save the rest.
  const before128 = (e: { message?: string } | null) => !!e && /categories|subjects/.test(e.message ?? '')
  const { categories: _c, subjects: _s, ...older } = p.row
  void _c; void _s
  if (found) {
    bookId = found.id
    const { read_status: _status, ...details } = p.row
    void _status
    let { error } = await supabase.from('books').update(withoutEmpty(details)).eq('id', bookId)
    if (before128(error)) ({ error } = await supabase.from('books').update(withoutEmpty({ ...details, categories: null, subjects: null })).eq('id', bookId))
    if (error) throw error
  } else {
    const row = { user_id: user.id, koreader_md5: p.md5, source: 'manual', on_device: false }
    let { data, error } = await supabase.from('books').insert({ ...p.row, ...row }).select('id').single()
    if (before128(error)) ({ data, error } = await supabase.from('books').insert({ ...older, ...row }).select('id').single())
    if (error || !data) throw error ?? new Error('Could not add the book to the library.')
    bookId = data.id
    made = true
  }
  try {
    const file = new File([p.bytes as BlobPart], p.fileName, { type: /\.pdf$/i.test(p.fileName) ? 'application/pdf' : 'application/epub+zip' })
    return await sendToKobo(file, { title: p.row.title, author: p.row.author, book_id: bookId })
  } catch (e) {
    if (made) await supabase.from('books').delete().eq('id', bookId)
    throw e
  }
}

/** Removes the file and keeps the row as cancelled, so the list says what happened. */
export async function cancelDelivery(d: Pick<BookDelivery, 'id' | 'storage_path'>): Promise<void> {
  const { error: rmError } = await supabase.storage.from(BUCKET).remove([d.storage_path])
  if (rmError && !isMissingTable(rmError)) throw rmError
  const { error } = await supabase.from('book_deliveries').update({ status: 'cancelled' }).eq('id', d.id)
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED) : error
}

/** Deletes a finished row (expired / cancelled) from the list. */
export async function deleteDeliveryRow(id: string): Promise<void> {
  const { error } = await supabase.from('book_deliveries').delete().eq('id', id)
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED) : error
}

/** The catalogue address to paste into KOReader, with the token as a placeholder. */
export function opdsAddress(token = '<your KOBO_OPDS_TOKEN>'): string {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '') ?? 'https://<project>.supabase.co'
  return `${base}/functions/v1/kobo-sync/opds/${token}/`
}
