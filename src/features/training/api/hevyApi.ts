import { supabase } from '../../../integrations/supabase/client'
import type {
  HevyWorkout,
  HevyWorkoutExercise,
  HevySet,
  HevyExerciseTemplate,
  HevyBodyMeasurement,
  HevyPR,
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
