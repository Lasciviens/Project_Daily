// The day's diary (migration 170): the owner's own words, one row per day.
// Before 170 the read is empty and a save says which migration is missing
// (remove the fallback once 170 has been live for a while).
import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'

type PgError = { code?: string; message?: string } | null | undefined
const isMissingTable = (e: PgError) => e?.code === '42P01' || e?.code === 'PGRST205' || /could not find the table/i.test(e?.message ?? '')
const MISSING_170 = 'The diary needs migration 170 — it runs with the next deploy.'

export interface DiaryEntry {
  day:        string
  body:       string
  updated_at: string
}

export async function fetchDiaryEntry(day: string): Promise<DiaryEntry | null> {
  const { data, error } = await supabase.from('diary_entries').select('day, body, updated_at').eq('day', day).maybeSingle()
  if (error) {
    if (isMissingTable(error)) return null
    throw error
  }
  return (data as DiaryEntry | null) ?? null
}

/** Writes the day's words (the same day again edits it in place). */
export async function saveDiaryEntry(day: string, body: string): Promise<DiaryEntry> {
  const user = await requireUser()
  const { data, error } = await supabase.from('diary_entries')
    .upsert({ user_id: user.id, day, body }, { onConflict: 'user_id,day' })
    .select('day, body, updated_at').single()
  if (error) throw isMissingTable(error) ? new Error(MISSING_170) : error
  return data as DiaryEntry
}
