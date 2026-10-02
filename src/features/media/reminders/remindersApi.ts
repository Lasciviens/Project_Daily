import { supabase } from '../../../integrations/supabase/client'
import type { MediaType } from '../types'

export interface ReleaseReminder {
  id: string
  media_type: MediaType
  tmdb_id: number
  title: string
  poster_path: string | null
  release_date: string
  offsets: number[]
  sent_offsets: number[]
}

const NOT_MIGRATED = 'Release reminders need migration 122 — apply it first.'
const missing = (e: { code?: string; message?: string } | null) =>
  e?.code === '42P01' || e?.code === 'PGRST205' || /Could not find the table/i.test(e?.message ?? '')

export async function fetchReminder(type: MediaType, tmdbId: number): Promise<ReleaseReminder | null> {
  const { data, error } = await supabase.from('media_release_reminders').select('*')
    .eq('media_type', type).eq('tmdb_id', tmdbId).maybeSingle()
  if (error) { if (missing(error)) return null; throw error }
  return data as ReleaseReminder | null
}

/** Saves the chosen offsets (none = delete). A changed release date clears what was sent. */
export async function saveReminder(input: { type: MediaType; tmdbId: number; title: string; posterPath: string | null; releaseDate: string; offsets: number[]; prev: ReleaseReminder | null }): Promise<void> {
  if (!input.offsets.length) {
    if (input.prev) {
      const { error } = await supabase.from('media_release_reminders').delete().eq('id', input.prev.id)
      if (error) throw missing(error) ? new Error(NOT_MIGRATED) : error
    }
    return
  }
  const moved = input.prev && input.prev.release_date !== input.releaseDate
  const { error } = await supabase.from('media_release_reminders').upsert({
    media_type: input.type, tmdb_id: input.tmdbId, title: input.title, poster_path: input.posterPath,
    release_date: input.releaseDate, offsets: [...input.offsets].sort((a, b) => b - a),
    sent_offsets: moved || !input.prev ? [] : input.prev.sent_offsets.filter(o => input.offsets.includes(o)),
  }, { onConflict: 'user_id,media_type,tmdb_id' })
  if (error) throw missing(error) ? new Error(NOT_MIGRATED) : error
}
