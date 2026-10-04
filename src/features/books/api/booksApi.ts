import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { safeFileName, storageFileName } from '../opdsFeed'
import type { BookDelivery } from '../types'

// book_deliveries / kobo_feed_state / the kobo-inbox bucket come with
// migration 125. Reads degrade to empty before it is applied; a write names
// the missing migration instead of failing silently (the wishesApi rule).

const BUCKET = 'kobo-inbox'
export const MAX_FILE_BYTES = 50 * 1024 * 1024
export const INBOX_CAP_BYTES = 150 * 1024 * 1024
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

/** Writes the row first (the database refuses it past the 150 MB inbox cap), then uploads the file. */
export async function sendToKobo(file: File): Promise<BookDelivery> {
  if (!isAcceptedFile(file.name)) throw new Error(`${file.name}: only EPUB, KEPUB and PDF files can be sent.`)
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is larger than 50 MB — send it over USB or Calibre instead.`)
  const user = await requireUser()
  const id = crypto.randomUUID()
  const filename = safeFileName(file.name)
  const storage_path = `${user.id}/${id}/${storageFileName(filename)}`
  const mime = /\.pdf$/i.test(filename) ? 'application/pdf' : 'application/epub+zip'
  const { data, error } = await supabase
    .from('book_deliveries')
    .insert({ id, user_id: user.id, storage_path, filename, mime, size_bytes: file.size })
    .select('id, storage_path, filename, mime, size_bytes, title, author, status, created_at, downloaded_at')
    .single()
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED) : error
  const { error: upError } = await supabase.storage.from(BUCKET).upload(storage_path, file, { contentType: mime, upsert: false })
  if (upError) {
    await supabase.from('book_deliveries').delete().eq('id', id)
    throw isMissingTable(upError) ? new Error(NOT_MIGRATED) : upError
  }
  return data
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
