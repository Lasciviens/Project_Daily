import { supabase } from '../../../integrations/supabase/client'
import type { StravaStatus } from '../types'
import type { StravaActivity } from '../types.hevy'

// ─── Strava ───────────────────────────────────────────────────────────────────

export async function fetchStravaStatus(): Promise<StravaStatus> {
  const { data, error } = await supabase
    .from('strava_tokens')
    .select('athlete_id, athlete_name, athlete_avatar')
    .maybeSingle()
  if (error) throw error
  if (!data) return { connected: false, athlete_id: null, athlete_name: null, athlete_avatar: null }
  return { connected: true, athlete_id: data.athlete_id, athlete_name: data.athlete_name, athlete_avatar: data.athlete_avatar }
}

// ─── Strava Activities ────────────────────────────────────────────────────────

export async function fetchStravaActivities(opts: {
  limit?: number
  type?: string
} = {}): Promise<StravaActivity[]> {
  const { limit = 20, type } = opts

  let query = supabase
    .from('strava_activities')
    .select('*')
    .order('start_date', { ascending: false })
    .limit(limit)

  if (type) query = query.eq('type', type)

  const { data, error } = await query
  if (error) throw error
  return data ?? []
}
