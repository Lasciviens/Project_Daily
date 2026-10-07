import { supabase } from '../../../security/supabaseClient'
import { defaultGamesPrefs, gamesPrefsDoc, normalizeGamesPrefs, type GamesPrefs } from './gamesPrefs'

const missingTable = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /Could not find the table/i.test(e.message ?? ''))

/** Saved Games settings; defaults before migration 133 (a read never fails the page). */
export async function fetchGamesPrefs(): Promise<GamesPrefs> {
  const { data, error } = await supabase.from('games_prefs').select('prefs').maybeSingle()
  if (error) {
    if (missingTable(error)) return defaultGamesPrefs()
    throw error
  }
  return normalizeGamesPrefs(data?.prefs)
}

export async function saveGamesPrefs(prefs: GamesPrefs): Promise<GamesPrefs> {
  const { data: auth } = await supabase.auth.getUser()
  const userId = auth.user?.id
  if (!userId) throw new Error('Not signed in')
  const doc = gamesPrefsDoc(prefs)
  const { error } = await supabase.from('games_prefs').upsert({ user_id: userId, prefs: doc }, { onConflict: 'user_id' })
  if (error) {
    if (missingTable(error)) throw new Error('Saving this needs migration 133 (games_prefs) — not applied yet.')
    throw error
  }
  return normalizeGamesPrefs(doc)
}
