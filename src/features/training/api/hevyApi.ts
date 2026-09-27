import { supabase } from '../../../integrations/supabase/client'
import { workoutWindowFilter, localDayBoundsIso, workoutLocalDay } from '../workoutDates'
import type { ProgressSetRow, ProgressTemplateRow } from '../progressAggregate'
import type {
  HevyWorkout,
  HevyWorkoutExercise,
  HevySet,
  HevyExerciseTemplate,
  HevyBodyMeasurement,
  HevyRoutine,
  HevyRoutineExercise,
  HevyRoutineSet,
  HevyRoutineFolder,
  HevySyncState,
} from '../types.hevy'

// ─── Paged reads ─────────────────────────────────────────────────────────────
// PostgREST caps every response at 1,000 rows (no max_rows override in
// config.toml), so every read that can grow past that pages — and pages are
// ORDERED by a unique column, because Postgres doesn't keep LIMIT/OFFSET
// pages stable without one (rows could repeat or vanish between pages).
// Long id lists go through `.in()` in chunks: a few hundred uuids in one GET
// query string is 20+ KB.

const PAGE = 1000
const IN_CHUNK = 150

type PageResult<T> = PromiseLike<{ data: T[] | null; error: unknown }>

/** Every page of an ordered query. `parallel` > 1 fetches that many pages
 *  per round trip (for the big all-time reads); the first short page ends it. */
async function fetchAllPages<T>(page: (from: number, to: number) => PageResult<T>, parallel = 1): Promise<T[]> {
  const out: T[] = []
  for (let offset = 0; ; offset += PAGE * parallel) {
    const batch = await Promise.all(Array.from({ length: parallel }, (_, i) => page(offset + i * PAGE, offset + (i + 1) * PAGE - 1)))
    for (const { data, error } of batch) {
      if (error) throw error
      const rows = data ?? []
      out.push(...rows)
      if (rows.length < PAGE) return out
    }
  }
}

function chunks<T>(xs: readonly T[], size = IN_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size))
  return out
}

/** Every row whose `ids` column matches, paged and chunked. */
async function fetchByIds<T>(ids: readonly string[], page: (part: string[], from: number, to: number) => PageResult<T>): Promise<T[]> {
  if (ids.length === 0) return []
  const parts = await Promise.all(chunks(ids).map(part => fetchAllPages<T>((f, t) => page(part, f, t))))
  return parts.flat()
}

// ─── Workout dates ───────────────────────────────────────────────────────────
// Effective date = start_time, else hevy_created_at (workoutDates.ts).
export { workoutWindowFilter, localDayBoundsIso, workoutLocalDay }

// ─── Workouts ────────────────────────────────────────────────────────────────

/** A workout row plus, when asked for, what the list card shows. */
export interface HevyWorkoutListItem extends HevyWorkout {
  exercise_count?: number
  /** Up to three distinct primary muscles, in exercise order. */
  muscle_groups?:  string[]
}

type WorkoutRowWithExercises = HevyWorkout & { hevy_workout_exercises?: { exercise_template_id: string | null; index: number }[] }

export async function fetchHevyWorkouts(opts: {
  limit?: number
  offset?: number
  /** ISO instants on the workout's effective date. */
  from?: string
  to?: string
  /** Adds exercise_count + muscle_groups (the Workouts list cards). */
  includeExercises?: boolean
} = {}): Promise<HevyWorkoutListItem[]> {
  const { limit = 20, offset = 0, from, to, includeExercises = false } = opts

  let query = supabase
    .from('hevy_workouts')
    .select(includeExercises ? '*, hevy_workout_exercises(exercise_template_id, index)' : '*')
    .order('start_time', { ascending: false, nullsFirst: false })
    .order('hevy_created_at', { ascending: false })
    .order('id', { ascending: true })
  if (from || to) query = query.or(workoutWindowFilter(from, to))

  const { data, error } = await query.range(offset, offset + limit - 1)
  if (error) throw error
  const rows = (data ?? []) as unknown as WorkoutRowWithExercises[]
  if (!includeExercises) return rows

  const templateIds = [...new Set(rows.flatMap(w => (w.hevy_workout_exercises ?? []).map(e => e.exercise_template_id).filter((id): id is string => !!id)))]
  const templates = await fetchByIds<{ id: string; primary_muscle_group: string | null }>(templateIds, (part, f, t) =>
    supabase.from('hevy_exercise_templates').select('id, primary_muscle_group').in('id', part).order('id').range(f, t))
  const muscleById = new Map(templates.map(t => [t.id, t.primary_muscle_group]))

  return rows.map(({ hevy_workout_exercises: exercises = [], ...w }) => {
    const groups: string[] = []
    for (const ex of [...exercises].sort((a, b) => a.index - b.index)) {
      const mg = ex.exercise_template_id ? muscleById.get(ex.exercise_template_id) : null
      if (mg && !groups.includes(mg)) groups.push(mg)
      if (groups.length >= 3) break
    }
    return { ...w, exercise_count: exercises.length, muscle_groups: groups }
  })
}

/** Every workout performed on the LOCAL days [fromDate, toDate] — the
 *  calendar and week counts read this instead of "the latest N". */
export async function fetchHevyWorkoutsInRange(fromDate: string, toDate: string): Promise<HevyWorkout[]> {
  const { fromISO, toISO } = localDayBoundsIso(fromDate, toDate)
  return fetchAllPages<HevyWorkout>((f, t) =>
    supabase
      .from('hevy_workouts')
      .select('*')
      .or(workoutWindowFilter(fromISO, toISO))
      .order('start_time', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true })
      .range(f, t))
}

export interface ExerciseVolumeRow {
  templateId:  string
  workoutId:   string
  workoutDate: string   // ISO — effective date (start_time ?? hevy_created_at)
  workingSets: number   // sets with type !== 'warmup'
  /** The Hevy routine the session was started from (null = freeform). */
  routineId:   string | null
}

type WorkoutDateRow = { id: string; start_time: string | null; hevy_created_at: string }
type ExerciseRow = { id: string; hevy_workout_id: string; exercise_template_id: string }

async function fetchWorkoutsInWindow<T extends WorkoutDateRow>(cols: string, fromISO: string, toISO: string): Promise<T[]> {
  return fetchAllPages<T>((f, t) =>
    supabase.from('hevy_workouts').select(cols).or(workoutWindowFilter(fromISO, toISO)).order('id').range(f, t) as unknown as PageResult<T>)
}

async function fetchExercisesForWorkouts(workoutIds: string[]): Promise<ExerciseRow[]> {
  return fetchByIds<ExerciseRow>(workoutIds, (part, f, t) =>
    supabase.from('hevy_workout_exercises').select('id, hevy_workout_id, exercise_template_id').in('hevy_workout_id', part).order('id').range(f, t))
}

// Per-exercise WORKING-set counts over a date range, for the volume-based
// muscle map. Effective date = start_time (hevy_created_at fallback).
export async function fetchMuscleVolume(fromISO: string, toISO: string): Promise<ExerciseVolumeRow[]> {
  const workouts = await fetchWorkoutsInWindow<WorkoutDateRow & { routine_id: string | null }>('id, start_time, hevy_created_at, routine_id', fromISO, toISO)
  if (!workouts.length) return []
  const dateByWorkout = new Map(workouts.map(w => [w.id, w.start_time ?? w.hevy_created_at]))
  const routineByWorkout = new Map(workouts.map(w => [w.id, w.routine_id ?? null]))

  const exRows = await fetchExercisesForWorkouts([...dateByWorkout.keys()])
  if (!exRows.length) return []

  const sets = await fetchByIds<{ id: string; hevy_exercise_id: string; type: string | null }>(exRows.map(e => e.id), (part, f, t) =>
    supabase.from('hevy_sets').select('id, hevy_exercise_id, type').in('hevy_exercise_id', part).order('id').range(f, t))
  const workingByExercise = new Map<string, number>()
  for (const s of sets) {
    if (s.type === 'warmup') continue
    workingByExercise.set(s.hevy_exercise_id, (workingByExercise.get(s.hevy_exercise_id) ?? 0) + 1)
  }

  return exRows
    .map(e => ({
      templateId:  e.exercise_template_id,
      workoutId:   e.hevy_workout_id,
      workoutDate: dateByWorkout.get(e.hevy_workout_id) ?? '',
      workingSets: workingByExercise.get(e.id) ?? 0,
      routineId:   routineByWorkout.get(e.hevy_workout_id) ?? null,
    }))
    .filter(r => r.templateId)
}

// ─── Progress (exercise progression / weekly volume / consistency) ───────────
// One bulk fetch feeding all of progressAggregate.ts's pure functions.

// The aggregation functions only need `id`/`type`; the exercise-picker UI
// also needs a name and muscle group, and the weekly-sets-per-muscle trend
// credits secondary muscles from hevy_exercise_template_muscles.
export interface TrainingExerciseTemplate extends ProgressTemplateRow {
  title: string
  primary_muscle_group: string | null
  secondary_muscle_groups: string[]
}

export interface TrainingHistory {
  sets:      ProgressSetRow[]
  templates: TrainingExerciseTemplate[]
}

type HistorySetRow = {
  id: string; hevy_exercise_id: string; exercise_template_id: string; index: number
  type: ProgressSetRow['set_type']
  weight_kg: number | null; reps: number | null
  duration_seconds: number | null; distance_meters: number | null
  rpe: number | null
}

export async function fetchTrainingHistory(fromISO: string, toISO: string): Promise<TrainingHistory> {
  type W = WorkoutDateRow & { title: string | null; routine_id: string | null }
  const workouts = await fetchWorkoutsInWindow<W>('id, title, start_time, hevy_created_at, routine_id', fromISO, toISO)
  if (!workouts.length) return { sets: [], templates: [] }

  // A session is filed under the LOCAL day it started (the same day the
  // calendar, Workouts and Daily show). The UTC date put a 00:30 Oslo session
  // on the previous day — and a Monday 00:30 one in the previous week.
  const workoutById = new Map(workouts.map(w => [w.id, w]))

  const exRows = await fetchExercisesForWorkouts([...workoutById.keys()])
  if (!exRows.length) return { sets: [], templates: [] }
  const workoutIdByExercise = new Map(exRows.map(e => [e.id, e.hevy_workout_id]))

  const rows = await fetchByIds<HistorySetRow>(exRows.map(e => e.id), (part, f, t) =>
    supabase
      .from('hevy_sets')
      .select('id, hevy_exercise_id, exercise_template_id, index, type, weight_kg, reps, duration_seconds, distance_meters, rpe')
      .in('hevy_exercise_id', part)
      .order('id')
      .range(f, t))

  const sets: ProgressSetRow[] = []
  for (const s of rows) {
    const workoutId = workoutIdByExercise.get(s.hevy_exercise_id)
    const w = workoutId ? workoutById.get(workoutId) : undefined
    const date = w ? workoutLocalDay(w) : ''
    if (!workoutId || !w || !date) continue
    sets.push({
      workout_id: workoutId, date, exercise_template_id: s.exercise_template_id,
      set_type: s.type, weight_kg: s.weight_kg, reps: s.reps,
      duration_seconds: s.duration_seconds, distance_meters: s.distance_meters,
      routine_id: w.routine_id ?? null, rpe: s.rpe,
      set_index: s.index, workout_title: w.title ?? null,
    })
  }

  const templateIds = [...new Set(sets.map(s => s.exercise_template_id))]
  const [templates, muscleRows] = await Promise.all([
    fetchByIds<{ id: string; title: string; type: string; primary_muscle_group: string | null }>(templateIds, (part, f, t) =>
      supabase.from('hevy_exercise_templates').select('id, title, type, primary_muscle_group').in('id', part).order('id').range(f, t)),
    fetchByIds<{ id: string; exercise_template_id: string; muscle_group: string }>(templateIds, (part, f, t) =>
      supabase.from('hevy_exercise_template_muscles').select('id, exercise_template_id, muscle_group').in('exercise_template_id', part).order('id').range(f, t)),
  ])
  const secondariesByTemplate = new Map<string, string[]>()
  for (const m of muscleRows) {
    const bucket = secondariesByTemplate.get(m.exercise_template_id) ?? []
    bucket.push(m.muscle_group)
    secondariesByTemplate.set(m.exercise_template_id, bucket)
  }

  return {
    sets,
    templates: templates.map(t => ({ ...t, secondary_muscle_groups: secondariesByTemplate.get(t.id) ?? [] })),
  }
}

// ─── Workout detail ──────────────────────────────────────────────────────────

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
    const [sets, templates] = await Promise.all([
      fetchByIds<HevySet>(exerciseList.map(e => e.id), (part, f, t) =>
        supabase.from('hevy_sets').select('*').in('hevy_exercise_id', part).order('index').order('id').range(f, t)),
      // The template's type decides how each set is written (kg × reps,
      // seconds, metres, assistance).
      fetchByIds<HevyExerciseTemplate>([...new Set(exerciseList.map(e => e.exercise_template_id))], (part, f, t) =>
        supabase.from('hevy_exercise_templates').select('*').in('id', part).order('id').range(f, t)),
    ])
    const setsByExercise = new Map<string, HevySet[]>()
    for (const s of sets) {
      const bucket = setsByExercise.get(s.hevy_exercise_id) ?? []
      bucket.push(s)
      setsByExercise.set(s.hevy_exercise_id, bucket)
    }
    const templateById = new Map(templates.map(t => [t.id, t]))
    for (const ex of exerciseList) {
      ex.sets = setsByExercise.get(ex.id) ?? []
      ex.template = templateById.get(ex.exercise_template_id)
    }
  }

  return { ...workout, exercises: exerciseList }
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

/** What is stored for one date right now (null when nothing is) — the
 *  measurement form loads it fresh whenever its date changes. */
export async function fetchBodyMeasurementForDate(date: string): Promise<HevyBodyMeasurement | null> {
  const { data, error } = await supabase
    .from('hevy_body_measurements')
    .select('*')
    .eq('date', date)
    .maybeSingle()
  if (error) throw error
  return data ?? null
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

async function postEdge(fn: string, body?: unknown): Promise<unknown> {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fn}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session?.access_token}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) await throwEdgeFunctionError(res)
  return res.json()
}

export async function triggerInitialHevySync(): Promise<{
  exercise_templates: number
  routines: number
  workouts: number
  body_measurements: number
}> {
  return postEdge('hevy-initial-sync') as Promise<{ exercise_templates: number; routines: number; workouts: number; body_measurements: number }>
}

export async function triggerIncrementalHevySync(): Promise<{
  updated: number
  deleted: number
  routines?: number
}> {
  return postEdge('hevy-incremental-sync') as Promise<{ updated: number; deleted: number; routines?: number }>
}

// Writes go through hevy-api (Hevy stays the source of truth; the function
// upserts the local mirror from Hevy's own response).
export async function callHevyApi(action: string, payload: unknown): Promise<unknown> {
  return postEdge('hevy-api', { action, payload })
}

// ─── Routines ─────────────────────────────────────────────────────────────────
// Hevy's public API has no routine DELETE endpoint (checked against its
// published OpenAPI, 2026-09-27: /v1/routines has GET/POST, /{id} GET/PUT).
// A routine is deleted in the Hevy app and disappears here on the next Sync,
// which prunes local routines Hevy no longer returns.

export async function fetchHevyRoutines(): Promise<HevyRoutine[]> {
  const routines = await fetchAllPages<HevyRoutine>((f, t) =>
    supabase.from('hevy_routines').select('*').order('hevy_updated_at', { ascending: false }).order('id').range(f, t))
  if (!routines.length) return []

  const exerciseList = await fetchByIds<HevyRoutineExercise>(routines.map(r => r.id), (part, f, t) =>
    supabase.from('hevy_routine_exercises').select('*').in('hevy_routine_id', part).order('index').order('id').range(f, t))

  const sets = await fetchByIds<HevyRoutineSet>(exerciseList.map(e => e.id), (part, f, t) =>
    supabase.from('hevy_routine_sets').select('*').in('hevy_routine_exercise_id', part).order('index').order('id').range(f, t))
  const setMap = new Map<string, HevyRoutineSet[]>()
  for (const s of sets) {
    const bucket = setMap.get(s.hevy_routine_exercise_id) ?? []
    bucket.push(s)
    setMap.set(s.hevy_routine_exercise_id, bucket)
  }

  const exercisesByRoutine = new Map<string, HevyRoutineExercise[]>()
  for (const ex of [...exerciseList].sort((a, b) => a.index - b.index)) {
    ex.sets = (setMap.get(ex.id) ?? []).sort((a, b) => a.index - b.index)
    const bucket = exercisesByRoutine.get(ex.hevy_routine_id) ?? []
    bucket.push(ex)
    exercisesByRoutine.set(ex.hevy_routine_id, bucket)
  }

  const folderIds = [...new Set(routines.map(r => r.folder_id).filter((id): id is number => id != null))]
  const folderMap = new Map<number, HevyRoutine['folder']>()
  if (folderIds.length > 0) {
    const { data: folders, error: fErr } = await supabase
      .from('hevy_routine_folders')
      .select('id, title')
      .in('id', folderIds)
    if (fErr) throw fErr
    for (const f of (folders ?? []) as { id: number; title: string }[]) {
      folderMap.set(f.id, f as HevyRoutine['folder'])
    }
  }

  return routines.map(r => ({
    ...r,
    exercises: exercisesByRoutine.get(r.id) ?? [],
    folder: r.folder_id != null ? folderMap.get(r.folder_id) : undefined,
  }))
}

// ─── Exercise Templates ───────────────────────────────────────────────────────
// hevy-initial-sync imports Hevy's whole library, so both reads page: past
// 1,000 rows the end of the alphabet used to vanish from Exercises, the log
// form and routine search.

export async function fetchHevyExerciseTemplates(): Promise<HevyExerciseTemplate[]> {
  const [templates, muscles] = await Promise.all([
    fetchAllPages<HevyExerciseTemplate>((f, t) =>
      supabase.from('hevy_exercise_templates').select('*').order('title').order('id').range(f, t)),
    fetchAllPages<{ id: string; exercise_template_id: string; muscle_group: string }>((f, t) =>
      supabase.from('hevy_exercise_template_muscles').select('id, exercise_template_id, muscle_group').order('id').range(f, t)),
  ])
  if (!templates.length) return []

  const musclesByTemplate = new Map<string, string[]>()
  for (const m of muscles) {
    const bucket = musclesByTemplate.get(m.exercise_template_id) ?? []
    bucket.push(m.muscle_group)
    musclesByTemplate.set(m.exercise_template_id, bucket)
  }

  return templates.map(t => ({
    ...t,
    secondary_muscle_groups: musclesByTemplate.get(t.id) ?? [],
  }))
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
