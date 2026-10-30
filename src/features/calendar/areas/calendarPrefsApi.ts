// Settings → Calendar (migration 172): the app's calendars per area. Before
// 172 the read gives the defaults and a save names the missing migration
// (remove the fallback once 172 has been live for a while).
import { supabase } from '../../../security/supabaseClient'
import { requireUser } from '../../../shared/utils/requireUser'
import { readCalendarPrefs, type CalendarPrefs } from './calendarAreas'

const missingTable = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /Could not find the table/i.test(e.message ?? ''))

export async function fetchCalendarPrefs(): Promise<CalendarPrefs> {
  const { data, error } = await supabase.from('calendar_prefs').select('prefs').maybeSingle()
  if (error) {
    if (missingTable(error)) return readCalendarPrefs(null)
    throw error
  }
  return readCalendarPrefs(data?.prefs)
}

/** Saves every area, so a later change of a default never moves a saved choice. */
export async function saveCalendarPrefs(prefs: CalendarPrefs): Promise<CalendarPrefs> {
  const { id: userId } = await requireUser()
  const doc = readCalendarPrefs(prefs)
  const { data, error } = await supabase.from('calendar_prefs')
    .upsert({ user_id: userId, prefs: doc }, { onConflict: 'user_id' })
    .select('prefs').single()
  if (error) {
    if (missingTable(error)) throw new Error('Calendar settings need migration 172 — it runs with the next deploy.')
    throw error
  }
  return readCalendarPrefs(data?.prefs)
}
