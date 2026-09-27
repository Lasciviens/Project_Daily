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
  /** ISO instants on start_date (Strava's own UTC start). */
  from?: string
  to?: string
} = {}): Promise<StravaActivity[]> {
  const { limit = 20, type, from, to } = opts

  let query = supabase
    .from('strava_activities')
    .select('*')
    .order('start_date', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true })
    .limit(limit)

  if (type) query = query.eq('type', type)
  if (from) query = query.gte('start_date', from)
  if (to)   query = query.lte('start_date', to)

  const { data, error } = await query
  if (error) throw error
  return data ?? []
}
