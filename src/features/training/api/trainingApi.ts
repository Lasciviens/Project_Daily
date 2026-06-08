import { supabase } from '../../../integrations/supabase/client'
import type { TrainingSession, CreateSessionInput, StravaStatus, SessionExerciseRow, Exercise } from '../types'

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

// ─── Session exercises (replaces dropped JSONB exercises column) ──────────────

function rowsToExercises(rows: SessionExerciseRow[]): Exercise[] {
  const map = new Map<string, Exercise>()
  for (const row of rows) {
    const key = `${row.sort_order}:${row.exercise_id}`
    if (!map.has(key)) {
      map.set(key, { name: row.exercises.name, sets: [] })
    }
    map.get(key)!.sets.push({ reps: row.reps ?? undefined, weight_kg: row.weight_kg ?? undefined })
  }
  return Array.from(map.values())
}

async function lookupOrCreateExercise(name: string): Promise<string> {
  const { data, error } = await supabase
    .from('exercises')
    .select('id')
    .ilike('name', name.trim())
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (data) return data.id
  const { data: created, error: cErr } = await supabase
    .from('exercises')
    .insert({ name: name.trim(), category: 'strength', is_system: false })
    .select('id')
    .single()
  if (cErr) throw cErr
  return created.id
}

export async function fetchSessionExercises(sessionId: string): Promise<Exercise[]> {
  const { data, error } = await supabase
    .from('session_exercises')
    .select('id, exercise_id, sort_order, set_number, reps, weight_kg, exercises(name)')
    .eq('session_id', sessionId)
    .order('sort_order')
    .order('set_number')
  if (error) throw error
  return rowsToExercises((data ?? []) as unknown as SessionExerciseRow[])
}

export async function fetchLastStrengthExercises(excludeSessionId?: string): Promise<Exercise[]> {
  let query = supabase
    .from('training_sessions')
    .select('id')
    .eq('type', 'strength')
    .order('planned_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (excludeSessionId) {
    query = query.neq('id', excludeSessionId)
  }
  const { data: sessions, error } = await query.limit(1)
  if (error) throw error
  if (!sessions?.length) return []
  return fetchSessionExercises(sessions[0].id)
}

export async function saveSessionExercises(sessionId: string, exercises: Exercise[]): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  const { error: delErr } = await supabase
    .from('session_exercises')
    .delete()
    .eq('session_id', sessionId)
  if (delErr) throw delErr

  const rows: object[] = []
  for (let exIdx = 0; exIdx < exercises.length; exIdx++) {
    const ex = exercises[exIdx]
    if (!ex.name.trim()) continue
    const exerciseId = await lookupOrCreateExercise(ex.name)
    for (let setIdx = 0; setIdx < ex.sets.length; setIdx++) {
      const s = ex.sets[setIdx]
      rows.push({
        session_id:  sessionId,
        user_id:     user!.id,
        exercise_id: exerciseId,
        sort_order:  exIdx,
        set_number:  setIdx + 1,
        reps:        s.reps ?? null,
        weight_kg:   s.weight_kg ?? null,
      })
    }
  }
  if (rows.length > 0) {
    const { error } = await supabase.from('session_exercises').insert(rows)
    if (error) throw error
  }
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
