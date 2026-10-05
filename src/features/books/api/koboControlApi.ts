import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import type { BookAiNote, KoboDeviceConfig, KoboDeviceState, SleepImage } from '../types'

// kobo_device_config / kobo_device_state / kobo_sleep_images / book_ai_notes
// and the book-covers bucket come with migration 127. Reads degrade to empty
// before it is applied; a write names the migration.

const NOT_MIGRATED = 'Kobo control is not available yet — migration 127 (Kobo control) has not been applied.'
function isMissing(e: unknown): boolean {
  const x = e as { code?: string; message?: string }
  return x?.code === '42P01' || x?.code === 'PGRST205' || x?.code === '42703' || /Could not find the table|does not exist|Bucket not found/i.test(x?.message ?? '')
}
const fail = (e: unknown): never => { throw isMissing(e) ? new Error(NOT_MIGRATED) : e }

export async function fetchKoboConfig(): Promise<KoboDeviceConfig | null> {
  const { data, error } = await supabase.from('kobo_device_config').select('settings, menu_order, sleep_image_id, rev, updated_at').maybeSingle()
  if (error) { if (isMissing(error)) return null; throw error }
  return data as KoboDeviceConfig | null
}

export async function fetchKoboDeviceState(): Promise<KoboDeviceState | null> {
  const { data, error } = await supabase.from('kobo_device_state').select('applied_rev, applied_at, apply_result, report, reported_at').maybeSingle()
  if (error) { if (isMissing(error)) return null; throw error }
  return data as KoboDeviceState | null
}

/** Saves the whole config row (only the owner's changes live in it). */
export async function saveKoboConfig(patch: Partial<Pick<KoboDeviceConfig, 'settings' | 'menu_order' | 'sleep_image_id'>>): Promise<void> {
  const user = await requireUser()
  const { error } = await supabase.from('kobo_device_config').upsert({ user_id: user.id, ...patch }, { onConflict: 'user_id' })
  if (error) fail(error)
}

export async function fetchSleepImages(): Promise<SleepImage[]> {
  const { data, error } = await supabase.from('kobo_sleep_images').select('*').order('created_at')
  if (error) { if (isMissing(error)) return []; throw error }
  return data ?? []
}

/** Signed preview links for the images (the bucket is private). */
export async function sleepImageUrls(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {}
  const { data, error } = await supabase.storage.from('kobo-sleep').createSignedUrls(paths, 3600)
  if (error) return {}
  const out: Record<string, string> = {}
  for (const r of data ?? []) if (r.path && r.signedUrl) out[r.path] = r.signedUrl
  return out
}

/** Row first (its cap trigger refuses an over-budget image before it costs storage), then the file. */
export async function uploadSleepImage(img: { blob: Blob; filename: string; width: number; height: number }): Promise<void> {
  const user = await requireUser()
  const id = crypto.randomUUID()
  const mime = img.blob.type === 'image/png' ? 'image/png' : 'image/jpeg'
  const path = `${user.id}/${id}.${mime === 'image/png' ? 'png' : 'jpg'}`
  const { error } = await supabase.from('kobo_sleep_images').insert({
    id, user_id: user.id, storage_path: path, filename: img.filename.slice(0, 200), mime,
    size_bytes: img.blob.size, width: img.width, height: img.height,
  })
  if (error) fail(error)
  const { error: upError } = await supabase.storage.from('kobo-sleep').upload(path, img.blob, { contentType: mime })
  if (upError) {
    await supabase.from('kobo_sleep_images').delete().eq('id', id)
    fail(upError)
  }
  // The row raised the rev before the file existed; a sync in between would have
  // applied that rev without this image. One more rev makes the Kobo fetch it.
  await bumpConfigRev()
}

async function bumpConfigRev(): Promise<void> {
  const { data } = await supabase.from('kobo_device_config').select('rev').maybeSingle()
  if (data) await supabase.from('kobo_device_config').update({ rev: data.rev + 1 }).not('rev', 'is', null)
}

export async function deleteSleepImage(img: SleepImage): Promise<void> {
  const { error } = await supabase.from('kobo_sleep_images').delete().eq('id', img.id)
  if (error) fail(error)
  await supabase.storage.from('kobo-sleep').remove([img.storage_path])
}

const COVER_BUDGET = 20 * 1024 * 1024

/** A cover chosen in the app: stored in book-covers (20 MB in all, shared with the Kobo's covers), the old stored cover removed. */
export async function uploadBookCover(bookId: string, blob: Blob, previous: string | null): Promise<string> {
  const user = await requireUser()
  const { data: used } = await supabase.rpc('kobo_bucket_usage', { p_bucket: 'book-covers' })
  if (typeof used === 'number' && used + blob.size > COVER_BUDGET) throw new Error('Cover storage is full (20 MB). Use “Cover from a link” instead.')
  const path = `${user.id}/${bookId}-${crypto.randomUUID().slice(0, 8)}.jpg`
  const { error } = await supabase.storage.from('book-covers').upload(path, blob, { contentType: 'image/jpeg' })
  if (error) fail(error)
  const url = supabase.storage.from('book-covers').getPublicUrl(path).data.publicUrl
  const { error: e2 } = await supabase.from('books').update({ cover_url: url, cover_source: 'upload' }).eq('id', bookId)
  if (e2) { await supabase.storage.from('book-covers').remove([path]); fail(e2) }
  const old = previous?.split('/object/public/book-covers/')[1]
  if (old) await supabase.storage.from('book-covers').remove([decodeURIComponent(old)])
  return url
}

export async function fetchAiNotes(bookId?: string): Promise<BookAiNote[]> {
  let q = supabase.from('book_ai_notes').select('id, book_id, book_title, ask, question, selection, answer, created_at')
    .order('created_at', { ascending: false }).limit(bookId ? 50 : 20)
  if (bookId) q = q.eq('book_id', bookId)
  const { data, error } = await q
  if (error) { if (isMissing(error)) return []; throw error }
  return data ?? []
}

export async function deleteAiNote(id: string): Promise<void> {
  const { error } = await supabase.from('book_ai_notes').delete().eq('id', id)
  if (error) fail(error)
}
