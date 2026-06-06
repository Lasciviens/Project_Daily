import { supabase } from '../../../integrations/supabase/client'
import type { TrainingSession, CreateSessionInput, StravaStatus } from '../types'

export async function fetchSessions(): Promise<TrainingSession[]> {
  const { data, error } = await supabase
    .from('training_sessions')
    .select('*')
    .order('planned_date', { ascending: false })
    .order('completed_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function createSession(input: CreateSessionInput): Promise<TrainingSession> {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('training_sessions')
    .insert({ ...input, user_id: user!.id })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateSession(
  id: string,
  patch: Partial<CreateSessionInput>
): Promise<void> {
  const { error } = await supabase
    .from('training_sessions')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function deleteSession(id: string): Promise<void> {
  const { error } = await supabase.from('training_sessions').delete().eq('id', id)
  if (error) throw error
}

export async function fetchStravaStatus(): Promise<StravaStatus> {
  const { data, error } = await supabase
    .from('strava_tokens')
    .select('athlete_id, athlete_name, athlete_avatar')
    .maybeSingle()
  if (error) throw error
  if (!data) return { connected: false, athlete_id: null, athlete_name: null, athlete_avatar: null }
  return { connected: true, athlete_id: data.athlete_id, athlete_name: data.athlete_name, athlete_avatar: data.athlete_avatar }
}
