import { supabase } from '../../../integrations/supabase/client'
import type {
  HevyWorkout,
  HevyWorkoutExercise,
  HevySet,
  HevyExerciseTemplate,
  HevyBodyMeasurement,
  HevyPR,
  HevyRoutine,
  HevyRoutineExercise,
  HevyRoutineSet,
  HevyRoutineFolder,
  StravaActivity,
  HevySyncState,
} from '../types.hevy'

// ─── Workouts ────────────────────────────────────────────────────────────────

export async function fetchHevyWorkouts(opts: {
  limit?: number
  offset?: number
  from?: string
  to?: string
} = {}): Promise<HevyWorkout[]> {
  const { limit = 20, offset = 0, from, to } = opts

  let query = supabase
    .from('hevy_workouts')
    .select('*')
    .order('hevy_created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (from) query = query.gte('hevy_created_at', from)
  if (to)   query = query.lte('hevy_created_at', to)

  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export interface WorkedTemplatesResult {
  templateIds:  string[]   // one entry per exercise-instance (for per-muscle counts)
  workoutCount: number      // distinct workouts in the range
}

// All exercise_template_ids performed in workouts within a date range, plus the
// workout count. Used by the Muscles body map. Matches on the workout's real
// date (start_time), falling back to hevy_created_at when start_time is null —
// the same effective-date rule the Workouts tab uses, so a workout without a
// start_time is never silently dropped.
export async function fetchWorkoutExerciseTemplateIds(fromISO: string, toISO: string): Promise<WorkedTemplatesResult> {
  const inRange = `and(start_time.gte.${fromISO},start_time.lte.${toISO})`
  const nullFallback = `and(start_time.is.null,hevy_created_at.gte.${fromISO},hevy_created_at.lte.${toISO})`

  const { data: workouts, error: wErr } = await supabase
    .from('hevy_workouts')
    .select('id')
    .or(`${inRange},${nullFallback}`)
  if (wErr) throw wErr
  const ids = (workouts ?? []).map(w => w.id)
  if (ids.length === 0) return { templateIds: [], workoutCount: 0 }

  const { data: exercises, error: eErr } = await supabase
    .from('hevy_workout_exercises')
    .select('exercise_template_id')
    .in('hevy_workout_id', ids)
  if (eErr) throw eErr
  return {
    templateIds:  (exercises ?? []).map(e => e.exercise_template_id).filter(Boolean),
    workoutCount: ids.length,
  }
}

export interface WorkoutWithTemplates {
  id:          string
  date:        string        // ISO — the workout's effective date (start_time ?? hevy_created_at)
  title:       string | null
  templateIds: string[]
}

// Per-workout exercise template ids over a date range (effective date = start_time
// with hevy_created_at fallback), for building per-muscle training history / the
// "last trained this muscle" line. Ordered newest-first.
export async function fetchWorkoutsWithTemplateIds(fromISO: string, toISO: string): Promise<WorkoutWithTemplates[]> {
  const inRange = `and(start_time.gte.${fromISO},start_time.lte.${toISO})`
  const nullFallback = `and(start_time.is.null,hevy_created_at.gte.${fromISO},hevy_created_at.lte.${toISO})`

  const { data: workouts, error: wErr } = await supabase
    .from('hevy_workouts')
    .select('id, title, start_time, hevy_created_at')
    .or(`${inRange},${nullFallback}`)
  if (wErr) throw wErr
  if (!workouts?.length) return []

  const { data: exercises, error: eErr } = await supabase
    .from('hevy_workout_exercises')
    .select('hevy_workout_id, exercise_template_id')
    .in('hevy_workout_id', workouts.map(w => w.id))
  if (eErr) throw eErr

  const byWorkout = new Map<string, string[]>()
  for (const e of (exercises ?? []) as { hevy_workout_id: string; exercise_template_id: string }[]) {
    if (!e.exercise_template_id) continue
    const bucket = byWorkout.get(e.hevy_workout_id) ?? []
    bucket.push(e.exercise_template_id)
    byWorkout.set(e.hevy_workout_id, bucket)
  }

  return (workouts as { id: string; title: string | null; start_time: string | null; hevy_created_at: string }[])
    .map(w => ({
      id:          w.id,
      date:        w.start_time ?? w.hevy_created_at,
      title:       w.title,
      templateIds: byWorkout.get(w.id) ?? [],
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
}

export interface ExerciseVolumeRow {
  templateId:  string
  workoutId:   string
  workoutDate: string   // ISO — effective date (start_time ?? hevy_created_at)
  workingSets: number   // sets with type !== 'warmup'
}

// Per-exercise WORKING-set counts over a date range, for the volume-based muscle
// map. Effective date = start_time (hevy_created_at fallback). Paginated on the
// sets read so a long window with many sets is never silently truncated at the
// 1000-row PostgREST cap.
export async function fetchMuscleVolume(fromISO: string, toISO: string): Promise<ExerciseVolumeRow[]> {
  const inRange = `and(start_time.gte.${fromISO},start_time.lte.${toISO})`
  const nullFallback = `and(start_time.is.null,hevy_created_at.gte.${fromISO},hevy_created_at.lte.${toISO})`

  const { data: workouts, error: wErr } = await supabase
    .from('hevy_workouts')
    .select('id, start_time, hevy_created_at')
    .or(`${inRange},${nullFallback}`)
  if (wErr) throw wErr
  if (!workouts?.length) return []
  const dateByWorkout = new Map<string, string>()
  for (const w of workouts as { id: string; start_time: string | null; hevy_created_at: string }[]) {
    dateByWorkout.set(w.id, w.start_time ?? w.hevy_created_at)
  }

  const { data: exercises, error: eErr } = await supabase
    .from('hevy_workout_exercises')
    .select('id, hevy_workout_id, exercise_template_id')
    .in('hevy_workout_id', [...dateByWorkout.keys()])
  if (eErr) throw eErr
  if (!exercises?.length) return []
  const exRows = exercises as { id: string; hevy_workout_id: string; exercise_template_id: string }[]
  const exIds = exRows.map(e => e.id)

  // Count working sets per exercise, paginated.
  const workingByExercise = new Map<string, number>()
  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    const { data: sets, error: sErr } = await supabase
      .from('hevy_sets')
      .select('hevy_exercise_id, type')
      .in('hevy_exercise_id', exIds)
      .range(offset, offset + PAGE - 1)
    if (sErr) throw sErr
    const page = (sets ?? []) as { hevy_exercise_id: string; type: string | null }[]
    for (const s of page) {
      if (s.type === 'warmup') continue
      workingByExercise.set(s.hevy_exercise_id, (workingByExercise.get(s.hevy_exercise_id) ?? 0) + 1)
    }
    if (page.length < PAGE) break
  }

  return exRows
    .map(e => ({
      templateId:  e.exercise_template_id,
      workoutId:   e.hevy_workout_id,
      workoutDate: dateByWorkout.get(e.hevy_workout_id) ?? '',
      workingSets: workingByExercise.get(e.id) ?? 0,
    }))
    .filter(r => r.templateId)
}

// ─── Progress (exercise progression / weekly volume / consistency) ───────────
// One bulk fetch feeding all of progressAggregate.ts's pure functions —
// mirrors fetchMuscleVolume's own "fetch once, derive many views client-side"
// shape rather than a separate round trip per chart.
import type { ProgressSetRow, ProgressTemplateRow } from '../progressAggregate'

// The aggregation functions only need `id`/`type`; the exercise-picker UI
// also needs a name and muscle group to render/filter/group by.
export interface TrainingExerciseTemplate extends ProgressTemplateRow {
  title: string
  primary_muscle_group: string | null
}

export interface TrainingHistory {
  sets:      ProgressSetRow[]
  templates: TrainingExerciseTemplate[]
}

export async function fetchTrainingHistory(fromISO: string, toISO: string): Promise<TrainingHistory> {
  const inRange = `and(start_time.gte.${fromISO},start_time.lte.${toISO})`
  const nullFallback = `and(start_time.is.null,hevy_created_at.gte.${fromISO},hevy_created_at.lte.${toISO})`

  const { data: workouts, error: wErr } = await supabase
    .from('hevy_workouts')
    .select('id, start_time, hevy_created_at')
    .or(`${inRange},${nullFallback}`)
  if (wErr) throw wErr
  if (!workouts?.length) return { sets: [], templates: [] }

  // Workout day is the raw ISO date's own leading 10 chars — matches
  // TrainingCalendar's own workoutDay() convention exactly, so a session
  // lands on the same calendar day here as it does on that calendar.
  const dateByWorkout = new Map<string, string>()
  for (const w of workouts as { id: string; start_time: string | null; hevy_created_at: string }[]) {
    dateByWorkout.set(w.id, (w.start_time ?? w.hevy_created_at).slice(0, 10))
  }

  const { data: exercises, error: eErr } = await supabase
    .from('hevy_workout_exercises')
    .select('id, hevy_workout_id, exercise_template_id')
    .in('hevy_workout_id', [...dateByWorkout.keys()])
  if (eErr) throw eErr
  if (!exercises?.length) return { sets: [], templates: [] }
  const exRows = exercises as { id: string; hevy_workout_id: string; exercise_template_id: string }[]
  const workoutIdByExercise = new Map(exRows.map(e => [e.id, e.hevy_workout_id]))
  const exIds = exRows.map(e => e.id)

  const sets: ProgressSetRow[] = []
  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    const { data: page, error: sErr } = await supabase
      .from('hevy_sets')
      .select('hevy_exercise_id, exercise_template_id, type, weight_kg, reps, duration_seconds, distance_meters')
      .in('hevy_exercise_id', exIds)
      .range(offset, offset + PAGE - 1)
    if (sErr) throw sErr
    const rows = (page ?? []) as {
      hevy_exercise_id: string; exercise_template_id: string
      type: 'normal' | 'warmup' | 'dropset' | 'failure'
      weight_kg: number | null; reps: number | null
      duration_seconds: number | null; distance_meters: number | null
    }[]
    for (const s of rows) {
      const workoutId = workoutIdByExercise.get(s.hevy_exercise_id)
      const date = workoutId ? dateByWorkout.get(workoutId) : undefined
      if (!workoutId || !date) continue
      sets.push({
        workout_id: workoutId, date, exercise_template_id: s.exercise_template_id,
        set_type: s.type, weight_kg: s.weight_kg, reps: s.reps,
        duration_seconds: s.duration_seconds, distance_meters: s.distance_meters,
      })
    }
    if (rows.length < PAGE) break
  }

  const templateIds = [...new Set(sets.map(s => s.exercise_template_id))]
  const { data: templates, error: tErr } = await supabase
    .from('hevy_exercise_templates')
    .select('id, title, type, primary_muscle_group')
    .in('id', templateIds)
  if (tErr) throw tErr

  return { sets, templates: (templates ?? []) as TrainingExerciseTemplate[] }
}

export async function fetchHevyWorkoutDetail(id: string): Promise<HevyWorkout | null> {
  const { data: workout, error: workoutErr } = await supabase
    .from('hevy_workouts')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (workoutErr) throw workoutErr
  if (!workout) return null

  const { data: exercises, error: exErr } = await supabase
    .from('hevy_workout_exercises')
    .select('*')
    .eq('hevy_workout_id', id)
    .order('index')
  if (exErr) throw exErr

  const exerciseList: HevyWorkoutExercise[] = exercises ?? []

  if (exerciseList.length > 0) {
    const exerciseIds = exerciseList.map(e => e.id)

    const { data: sets, error: setsErr } = await supabase
      .from('hevy_sets')
      .select('*')
      .in('hevy_exercise_id', exerciseIds)
      .order('index')
    if (setsErr) throw setsErr

    const setsByExercise = new Map<string, HevySet[]>()
    for (const s of (sets ?? []) as HevySet[]) {
      const bucket = setsByExercise.get(s.hevy_exercise_id) ?? []
      bucket.push(s)
      setsByExercise.set(s.hevy_exercise_id, bucket)
    }

    for (const ex of exerciseList) {
      ex.sets = setsByExercise.get(ex.id) ?? []
    }
  }

  return { ...workout, exercises: exerciseList }
}

// ─── Personal Records ─────────────────────────────────────────────────────────

export async function fetchHevyPRs(): Promise<HevyPR[]> {
  // Fetch all normal sets with weight — GROUP BY not available in supabase-js,
  // so aggregate on the client side after fetching the needed columns.
  const { data: sets, error: setsErr } = await supabase
    .from('hevy_sets')
    .select('exercise_template_id, weight_kg, reps, hevy_exercise_id')
    .eq('type', 'normal')
    .not('weight_kg', 'is', null)
  if (setsErr) throw setsErr

  if (!sets?.length) return []

  // We need the workout date — join via hevy_workout_exercises → hevy_workouts
  const exerciseIds = [...new Set((sets as any[]).map(s => s.hevy_exercise_id))]

  const { data: exercises, error: exErr } = await supabase
    .from('hevy_workout_exercises')
    .select('id, hevy_workout_id')
    .in('id', exerciseIds)
  if (exErr) throw exErr

  const workoutIds = [...new Set((exercises ?? []).map((e: any) => e.hevy_workout_id))]

  const { data: workouts, error: wErr } = await supabase
    .from('hevy_workouts')
    .select('id, hevy_created_at')
    .in('id', workoutIds)
  if (wErr) throw wErr

  // Build lookup maps
  const workoutDateById = new Map<string, string>(
    (workouts ?? []).map((w: any) => [w.id, w.hevy_created_at as string])
  )
  const workoutIdByExerciseId = new Map<string, string>(
    (exercises ?? []).map((e: any) => [e.id as string, e.hevy_workout_id as string])
  )

  // Fetch exercise templates for titles and muscle groups
  const templateIds = [...new Set((sets as any[]).map(s => s.exercise_template_id as string))]

  const { data: templates, error: tErr } = await supabase
    .from('hevy_exercise_templates')
    .select('id, title, primary_muscle_group')
    .in('id', templateIds)
  if (tErr) throw tErr

  const templateById = new Map<string, HevyExerciseTemplate>(
    (templates ?? []).map((t: any) => [t.id as string, t as HevyExerciseTemplate])
  )

  // Aggregate: per exercise_template_id find the set with max weight_kg
  type PRAccumulator = {
    weight_kg: number
    reps: number | null
    hevy_exercise_id: string
  }
  const prMap = new Map<string, PRAccumulator>()

  for (const s of sets as any[]) {
    const current = prMap.get(s.exercise_template_id)
    if (!current || s.weight_kg > current.weight_kg) {
      prMap.set(s.exercise_template_id, {
        weight_kg: s.weight_kg,
        reps: s.reps ?? null,
        hevy_exercise_id: s.hevy_exercise_id,
      })
    }
  }

  const prs: HevyPR[] = []
  for (const [templateId, best] of prMap) {
    const template = templateById.get(templateId)
    if (!template) continue
    const workoutId = workoutIdByExerciseId.get(best.hevy_exercise_id)
    const achievedAt = workoutId ? (workoutDateById.get(workoutId) ?? '') : ''
    prs.push({
      exercise_template_id: templateId,
      title: template.title,
      primary_muscle_group: template.primary_muscle_group,
      max_weight_kg: best.weight_kg,
      reps_at_max: best.reps,
      achieved_at: achievedAt,
    })
  }

  // Sort by title for a stable, predictable order
  return prs.sort((a, b) => a.title.localeCompare(b.title))
}

// ─── Body Measurements ────────────────────────────────────────────────────────

export async function fetchBodyMeasurements(limit = 50): Promise<HevyBodyMeasurement[]> {
  const { data, error } = await supabase
    .from('hevy_body_measurements')
    .select('*')
    .order('date', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
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

// ─── Edge Function Calls ──────────────────────────────────────────────────────

async function throwEdgeFunctionError(res: Response): Promise<never> {
  const text = await res.text()
  let message = text
  try {
    const json = JSON.parse(text)
    message = json.error ?? json.message ?? text
  } catch {
    // not JSON, use raw text
  }
  throw new Error(message)
}

export async function triggerInitialHevySync(): Promise<{
  exercise_templates: number
  routines: number
  workouts: number
  body_measurements: number
}> {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hevy-initial-sync`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session?.access_token}`,
        'Content-Type': 'application/json',
      },
    }
  )
  if (!res.ok) await throwEdgeFunctionError(res)
  return res.json()
}

export async function triggerIncrementalHevySync(): Promise<{
  updated: number
  deleted: number
}> {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hevy-incremental-sync`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session?.access_token}`,
        'Content-Type': 'application/json',
      },
    }
  )
  if (!res.ok) await throwEdgeFunctionError(res)
  return res.json()
}

// ─── Routines ─────────────────────────────────────────────────────────────────

export async function fetchHevyRoutines(): Promise<HevyRoutine[]> {
  const { data: routines, error: rErr } = await supabase
    .from('hevy_routines')
    .select('*')
    .order('hevy_updated_at', { ascending: false })
  if (rErr) throw rErr
  if (!routines?.length) return []

  const routineIds = routines.map(r => r.id)

  const { data: exercises, error: eErr } = await supabase
    .from('hevy_routine_exercises')
    .select('*')
    .in('hevy_routine_id', routineIds)
    .order('index')
  if (eErr) throw eErr

  const exerciseList: HevyRoutineExercise[] = exercises ?? []
  const exerciseIds = exerciseList.map(e => e.id)

  let setMap = new Map<string, HevyRoutineSet[]>()
  if (exerciseIds.length > 0) {
    const { data: sets, error: sErr } = await supabase
      .from('hevy_routine_sets')
      .select('*')
      .in('hevy_routine_exercise_id', exerciseIds)
      .order('index')
    if (sErr) throw sErr
    for (const s of (sets ?? []) as HevyRoutineSet[]) {
      const bucket = setMap.get(s.hevy_routine_exercise_id) ?? []
      bucket.push(s)
      setMap.set(s.hevy_routine_exercise_id, bucket)
    }
  }

  for (const ex of exerciseList) {
    ex.sets = setMap.get(ex.id) ?? []
  }

  const exercisesByRoutine = new Map<string, HevyRoutineExercise[]>()
  for (const ex of exerciseList) {
    const bucket = exercisesByRoutine.get(ex.hevy_routine_id) ?? []
    bucket.push(ex)
    exercisesByRoutine.set(ex.hevy_routine_id, bucket)
  }

  // Fetch folders
  const folderIds = [...new Set(routines.map(r => r.folder_id).filter(Boolean) as number[])]
  const folderMap = new Map<number, { id: number; title: string }>()
  if (folderIds.length > 0) {
    const { data: folders, error: fErr } = await supabase
      .from('hevy_routine_folders')
      .select('id, title')
      .in('id', folderIds)
    if (fErr) throw fErr
    for (const f of (folders ?? []) as { id: number; title: string }[]) {
      folderMap.set(f.id, f)
    }
  }

  return routines.map(r => ({
    ...r,
    exercises: exercisesByRoutine.get(r.id) ?? [],
    folder: r.folder_id ? (folderMap.get(r.folder_id) as HevyRoutine['folder']) : undefined,
  }))
}

// ─── Exercise Templates ───────────────────────────────────────────────────────

export async function fetchHevyExerciseTemplates(): Promise<HevyExerciseTemplate[]> {
  const { data: templates, error: tErr } = await supabase
    .from('hevy_exercise_templates')
    .select('*')
    .order('title')
  if (tErr) throw tErr
  if (!templates?.length) return []

  const templateIds = templates.map(t => t.id)

  const { data: muscles, error: mErr } = await supabase
    .from('hevy_exercise_template_muscles')
    .select('exercise_template_id, muscle_group')
    .in('exercise_template_id', templateIds)
  if (mErr) throw mErr

  const musclesByTemplate = new Map<string, string[]>()
  for (const m of (muscles ?? []) as { exercise_template_id: string; muscle_group: string }[]) {
    const bucket = musclesByTemplate.get(m.exercise_template_id) ?? []
    bucket.push(m.muscle_group)
    musclesByTemplate.set(m.exercise_template_id, bucket)
  }

  return templates.map(t => ({
    ...t,
    secondary_muscle_groups: musclesByTemplate.get(t.id) ?? [],
  }))
}

// ─── Sync Status ──────────────────────────────────────────────────────────────

export async function fetchHevySyncStatus(): Promise<{
  workouts: number
  routines: number
  exercise_templates: number
  body_measurements: number
  last_synced: string | null
}> {
  const [
    { count: workouts },
    { count: routines },
    { count: exercise_templates },
    { count: body_measurements },
  ] = await Promise.all([
    supabase.from('hevy_workouts').select('*', { count: 'exact', head: true }),
    supabase.from('hevy_routines').select('*', { count: 'exact', head: true }),
    supabase.from('hevy_exercise_templates').select('*', { count: 'exact', head: true }),
    supabase.from('hevy_body_measurements').select('*', { count: 'exact', head: true }),
  ])

  const { data: { user } } = await supabase.auth.getUser()
  let last_synced: string | null = null
  if (user) {
    const { data } = await supabase
      .from('hevy_workout_events_cursor')
      .select('last_events_since')
      .eq('user_id', user.id)
      .maybeSingle()
    last_synced = data?.last_events_since ?? null
  }

  return {
    workouts:           workouts ?? 0,
    routines:           routines ?? 0,
    exercise_templates: exercise_templates ?? 0,
    body_measurements:  body_measurements ?? 0,
    last_synced,
  }
}

// ─── Hevy API (write operations via Edge Function) ────────────────────────────

export async function callHevyApi(action: string, payload: unknown): Promise<unknown> {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hevy-api`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session?.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action, payload }),
    }
  )
  if (!res.ok) await throwEdgeFunctionError(res)
  return res.json()
}

// ─── Delete routine from local DB only (no Hevy API delete exists) ────────────

export async function deleteHevyRoutineLocal(id: string): Promise<void> {
  const { error } = await supabase
    .from('hevy_routines')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// ─── Routine Folders ──────────────────────────────────────────────────────────

export async function fetchHevyRoutineFolders(): Promise<HevyRoutineFolder[]> {
  const { data, error } = await supabase
    .from('hevy_routine_folders')
    .select('*')
    .order('title')
  if (error) throw error
  return data ?? []
}

// ─── Sync State ───────────────────────────────────────────────────────────────

export async function fetchHevySyncState(): Promise<HevySyncState | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase
    .from('hevy_workout_events_cursor')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) throw error
  return data ?? null
}
