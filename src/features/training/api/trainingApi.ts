import { supabase } from '../../../integrations/supabase/client'
import type {
  TrainingSession, CreateSessionInput, StravaStatus,
  SessionExerciseRow, Exercise,
  TrainingProgram, ProgramWorkout, ProgramWorkoutExercise,
} from '../types'

// ─── Sessions ────────────────────────────────────────────────────────────────

export async function fetchSessions(): Promise<TrainingSession[]> {
  const { data, error } = await supabase
    .from('train_sessions')
    .select('*')
    .order('planned_date', { ascending: false })
    .order('completed_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function createSession(input: CreateSessionInput): Promise<TrainingSession> {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('train_sessions')
    .insert({ ...input, user_id: user!.id })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateSession(id: string, patch: Partial<CreateSessionInput>): Promise<void> {
  const { error } = await supabase
    .from('train_sessions')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function deleteSession(id: string): Promise<{ linkedTaskId: string | null }> {
  // Capture linked task before deletion
  const { data: session } = await supabase
    .from('train_sessions')
    .select('linked_task_id')
    .eq('id', id)
    .single()

  // Remove companion time block (source_type/source_id link)
  await supabase.from('time_blocks')
    .delete()
    .eq('source_type', 'training_session')
    .eq('source_id', id)

  const { error } = await supabase.from('train_sessions').delete().eq('id', id)
  if (error) throw error
  return { linkedTaskId: session?.linked_task_id ?? null }
}

// ─── Session exercises ────────────────────────────────────────────────────────

function rowsToExercises(rows: SessionExerciseRow[]): Exercise[] {
  const map = new Map<string, Exercise>()
  for (const row of rows) {
    const key = `${row.sort_order}:${row.exercise_id}`
    if (!map.has(key)) map.set(key, { name: row.exercises.name, sets: [] })
    map.get(key)!.sets.push({ reps: row.reps ?? undefined, weight_kg: row.weight_kg ?? undefined })
  }
  return Array.from(map.values())
}

async function lookupOrCreateExercise(name: string): Promise<string> {
  const { data, error } = await supabase
    .from('train_exercises')
    .select('id')
    .ilike('name', name.trim())
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (data) return data.id
  const { data: created, error: cErr } = await supabase
    .from('train_exercises')
    .insert({ name: name.trim(), category: 'strength', is_system: false })
    .select('id')
    .single()
  if (cErr) throw cErr
  return created.id
}

export async function fetchSessionExercises(sessionId: string): Promise<Exercise[]> {
  const { data, error } = await supabase
    .from('train_session_exercises')
    .select('id, exercise_id, sort_order, set_number, reps, weight_kg, train_exercises(name)')
    .eq('session_id', sessionId)
    .order('sort_order')
    .order('set_number')
  if (error) throw error
  // Remap joined table name for rowsToExercises
  const rows = (data ?? []).map((r: any) => ({ ...r, exercises: r.train_exercises }))
  return rowsToExercises(rows as unknown as SessionExerciseRow[])
}

export async function fetchLastStrengthExercises(excludeSessionId?: string): Promise<Exercise[]> {
  let query = supabase
    .from('train_sessions')
    .select('id')
    .eq('type', 'strength')
    .order('planned_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (excludeSessionId) query = query.neq('id', excludeSessionId)
  const { data: sessions, error } = await query.limit(1)
  if (error) throw error
  if (!sessions?.length) return []
  return fetchSessionExercises(sessions[0].id)
}

export async function saveSessionExercises(sessionId: string, exercises: Exercise[]): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  const { error: delErr } = await supabase
    .from('train_session_exercises')
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
    const { error } = await supabase.from('train_session_exercises').insert(rows)
    if (error) throw error
  }
}

export async function searchExerciseNames(query: string): Promise<string[]> {
  if (!query.trim()) {
    const { data } = await supabase
      .from('train_exercises')
      .select('name')
      .order('name')
      .limit(20)
    return (data ?? []).map(r => r.name)
  }
  const { data } = await supabase
    .from('train_exercises')
    .select('name')
    .ilike('name', `%${query.trim()}%`)
    .order('name')
    .limit(10)
  return (data ?? []).map(r => r.name)
}

// ─── Programs ────────────────────────────────────────────────────────────────

export async function fetchPrograms(): Promise<TrainingProgram[]> {
  const { data, error } = await supabase
    .from('train_programs')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function createProgram(name: string, description?: string): Promise<TrainingProgram> {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('train_programs')
    .insert({ name: name.trim(), description: description?.trim() || null, user_id: user!.id })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateProgram(id: string, patch: { name?: string; description?: string }): Promise<void> {
  const { error } = await supabase
    .from('train_programs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function deleteProgram(id: string): Promise<void> {
  const { error } = await supabase.from('train_programs').delete().eq('id', id)
  if (error) throw error
}

// ─── Program Workouts ────────────────────────────────────────────────────────

export async function fetchProgramWorkouts(programId: string): Promise<ProgramWorkout[]> {
  const { data, error } = await supabase
    .from('train_program_workouts')
    .select('*')
    .eq('program_id', programId)
    .order('sort_order')
    .order('created_at')
  if (error) throw error
  return data ?? []
}

export async function createProgramWorkout(programId: string, name: string): Promise<ProgramWorkout> {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('train_program_workouts')
    .insert({ program_id: programId, name: name.trim(), user_id: user!.id })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateProgramWorkout(id: string, patch: { name?: string }): Promise<void> {
  const { error } = await supabase
    .from('train_program_workouts')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function deleteProgramWorkout(id: string): Promise<void> {
  const { error } = await supabase.from('train_program_workouts').delete().eq('id', id)
  if (error) throw error
}

// ─── Program Workout Exercises ────────────────────────────────────────────────

export async function fetchProgramExercises(workoutId: string): Promise<ProgramWorkoutExercise[]> {
  const { data, error } = await supabase
    .from('train_program_exercises')
    .select('*')
    .eq('workout_id', workoutId)
    .order('sort_order')
  if (error) throw error
  return data ?? []
}

export async function saveProgramExercises(
  workoutId: string,
  exercises: Omit<ProgramWorkoutExercise, 'id' | 'workout_id'>[]
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  const { error: delErr } = await supabase
    .from('train_program_exercises')
    .delete()
    .eq('workout_id', workoutId)
  if (delErr) throw delErr
  if (!exercises.length) return
  const rows = exercises.map((ex, idx) => ({
    workout_id:    workoutId,
    user_id:       user!.id,
    exercise_name: ex.exercise_name,
    sort_order:    idx,
    sets:          ex.sets,
    min_reps:      ex.min_reps ?? null,
    max_reps:      ex.max_reps ?? null,
    notes:         ex.notes ?? null,
  }))
  const { error } = await supabase.from('train_program_exercises').insert(rows)
  if (error) throw error
}

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
