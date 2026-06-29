import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGINS = ['https://lasciviens.github.io', 'http://localhost:5173']

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

// ---------------------------------------------------------------------------
// Hevy API helper
// ---------------------------------------------------------------------------
async function hevyRequest(
  method: string,
  path: string,
  hevyApiKey: string,
  body?: unknown,
) {
  const res = await fetch(`https://api.hevyapp.com${path}`, {
    method,
    headers: { 'api-key': hevyApiKey, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Hevy API ${res.status} ${method} ${path}: ${body}`)
  }
  return res.json()
}

// Hevy responses are inconsistent: an entity may come back directly, wrapped
// as { routine: {...} }, or wrapped as an array { routine: [ {...} ] }.
// Normalize all three shapes to a single entity object.
function unwrapEntity<T = any>(data: any, key: string): T {
  const v = data?.[key] ?? data
  return (Array.isArray(v) ? v[0] : v) as T
}

// ---------------------------------------------------------------------------
// Workout sync helpers (mirrors hevy-initial-sync Step 4)
// ---------------------------------------------------------------------------
interface HevyWorkoutSet {
  index: number
  type: string
  weight_kg: number | null
  reps: number | null
  distance_meters: number | null
  duration_seconds: number | null
  rpe: number | null
  custom_metric: number | null
}

interface HevyWorkoutExercise {
  index: number
  title: string
  notes: string | null
  exercise_template_id: string
  superset_id?: number | null
  supersets_id?: number | null
  sets: HevyWorkoutSet[]
}

interface HevyWorkout {
  id: string
  title: string
  routine_id: string | null
  description: string | null
  start_time: string
  end_time: string
  updated_at: string
  created_at: string
  exercises: HevyWorkoutExercise[]
}

async function upsertWorkoutToDb(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  workout: HevyWorkout,
) {
  const now = new Date().toISOString()

  // 1. Upsert workout row
  const { error: workoutErr } = await supabase
    .from('hevy_workouts')
    .upsert(
      {
        id: workout.id,
        user_id: userId,
        title: workout.title,
        routine_id: workout.routine_id,
        description: workout.description,
        start_time: workout.start_time,
        end_time: workout.end_time,
        hevy_updated_at: workout.updated_at,
        hevy_created_at: workout.created_at,
        synced_at: now,
      },
      { onConflict: 'id' },
    )
  if (workoutErr) throw workoutErr

  // 2. Delete existing exercises for this workout
  const { error: delErr } = await supabase
    .from('hevy_workout_exercises')
    .delete()
    .eq('hevy_workout_id', workout.id)
    .eq('user_id', userId)
  if (delErr) throw delErr

  // 3. Insert exercises and their sets
  for (const exercise of workout.exercises ?? []) {
    const { data: insertedExercise, error: exErr } = await supabase
      .from('hevy_workout_exercises')
      .insert({
        user_id: userId,
        hevy_workout_id: workout.id,
        exercise_template_id: exercise.exercise_template_id,
        index: exercise.index,
        title: exercise.title,
        notes: exercise.notes,
        supersets_id: exercise.superset_id ?? exercise.supersets_id ?? null,
      })
      .select('id')
      .single()
    if (exErr) throw exErr

    if ((exercise.sets ?? []).length > 0) {
      const { error: setsErr } = await supabase
        .from('hevy_sets')
        .insert(
          exercise.sets.map((s) => ({
            user_id: userId,
            hevy_exercise_id: insertedExercise.id,
            exercise_template_id: exercise.exercise_template_id,
            index: s.index,
            type: s.type,
            weight_kg: s.weight_kg,
            reps: s.reps,
            distance_meters: s.distance_meters,
            duration_seconds: s.duration_seconds,
            rpe: s.rpe,
            custom_metric: s.custom_metric,
          })),
        )
      if (setsErr) throw setsErr
    }
  }
}

// ---------------------------------------------------------------------------
// Routine sync helpers (mirrors hevy-initial-sync Step 3)
// ---------------------------------------------------------------------------
interface HevyRoutineSet {
  index: number
  type: string
  weight_kg: number | null
  reps: number | null
  rep_range: { start: number; end: number } | null
  distance_meters: number | null
  duration_seconds: number | null
  rpe: number | null
  custom_metric: number | null
}

interface HevyRoutineExercise {
  index: number
  title: string
  notes: string | null
  rest_seconds: number | null
  exercise_template_id: string
  superset_id?: number | null
  supersets_id?: number | null
  sets: HevyRoutineSet[]
}

interface HevyRoutine {
  id: string
  title: string
  folder_id: string | null
  notes: string | null
  updated_at: string
  created_at: string
  exercises: HevyRoutineExercise[]
}

async function upsertRoutineToDb(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  routine: HevyRoutine,
) {
  const now = new Date().toISOString()

  // 1. Upsert routine row
  const { error: routineErr } = await supabase
    .from('hevy_routines')
    .upsert(
      {
        id: routine.id,
        user_id: userId,
        folder_id: routine.folder_id,
        title: routine.title,
        notes: routine.notes,
        hevy_updated_at: routine.updated_at,
        hevy_created_at: routine.created_at,
        synced_at: now,
      },
      { onConflict: 'id' },
    )
  if (routineErr) throw routineErr

  // 2. Delete existing exercises for this routine
  const { error: delErr } = await supabase
    .from('hevy_routine_exercises')
    .delete()
    .eq('hevy_routine_id', routine.id)
    .eq('user_id', userId)
  if (delErr) throw delErr

  // 3. Insert exercises and their sets
  for (const exercise of routine.exercises ?? []) {
    const { data: insertedExercise, error: exErr } = await supabase
      .from('hevy_routine_exercises')
      .insert({
        user_id: userId,
        hevy_routine_id: routine.id,
        exercise_template_id: exercise.exercise_template_id,
        index: exercise.index,
        title: exercise.title,
        notes: exercise.notes,
        rest_seconds: exercise.rest_seconds,
        supersets_id: exercise.superset_id ?? exercise.supersets_id ?? null,
      })
      .select('id')
      .single()
    if (exErr) throw exErr

    if ((exercise.sets ?? []).length > 0) {
      const { error: setsErr } = await supabase
        .from('hevy_routine_sets')
        .insert(
          exercise.sets.map((s) => ({
            user_id: userId,
            hevy_routine_exercise_id: insertedExercise.id,
            index: s.index,
            type: s.type,
            weight_kg: s.weight_kg,
            reps: s.reps,
            rep_range_start: s.rep_range?.start ?? null,
            rep_range_end: s.rep_range?.end ?? null,
            distance_meters: s.distance_meters,
            duration_seconds: s.duration_seconds,
            rpe: s.rpe,
            custom_metric: s.custom_metric,
          })),
        )
      if (setsErr) throw setsErr
    }
  }
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------
async function handleCreateWorkout(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  hevyApiKey: string,
  payload: unknown,
) {
  const data = await hevyRequest('POST', '/v1/workouts', hevyApiKey, { workout: payload })
  const workout = unwrapEntity<HevyWorkout>(data, 'workout')
  if (!workout?.id) throw new Error('Hevy returned no workout id from create_workout')
  await upsertWorkoutToDb(supabase, userId, workout)
  return { workout_id: workout.id }
}

async function handleUpdateWorkout(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  hevyApiKey: string,
  payload: Record<string, unknown>,
) {
  const workoutId = payload.id as string
  if (!workoutId) throw new Error('payload.id is required for update_workout')
  // id belongs in the URL only — Hevy rejects it inside the request body
  const { id: _id, ...workoutBody } = payload
  const data = await hevyRequest('PUT', `/v1/workouts/${workoutId}`, hevyApiKey, { workout: workoutBody })
  const workout = unwrapEntity<HevyWorkout>(data, 'workout')
  if (!workout?.id) throw new Error('Hevy returned no workout id from update_workout')
  await upsertWorkoutToDb(supabase, userId, workout)
  return { ok: true }
}

async function handleCreateRoutine(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  hevyApiKey: string,
  payload: unknown,
) {
  const data = await hevyRequest('POST', '/v1/routines', hevyApiKey, { routine: payload })
  const routine = unwrapEntity<HevyRoutine>(data, 'routine')
  if (!routine?.id) throw new Error('Hevy returned no routine id from create_routine')
  await upsertRoutineToDb(supabase, userId, routine)
  return { routine_id: routine.id }
}

async function handleUpdateRoutine(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  hevyApiKey: string,
  payload: Record<string, unknown>,
) {
  const routineId = payload.id as string
  if (!routineId) throw new Error('payload.id is required for update_routine')
  // id belongs in the URL only — Hevy rejects it inside the request body
  const { id: _id, ...routineBody } = payload
  const data = await hevyRequest('PUT', `/v1/routines/${routineId}`, hevyApiKey, { routine: routineBody })
  const routine = unwrapEntity<HevyRoutine>(data, 'routine')
  if (!routine?.id) throw new Error('Hevy returned no routine id from update_routine')
  await upsertRoutineToDb(supabase, userId, routine)
  return { ok: true }
}

async function handleUpsertBodyMeasurement(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  hevyApiKey: string,
  payload: Record<string, unknown>,
) {
  const date = payload.date as string
  if (!date) throw new Error('payload.date is required for upsert_body_measurement')

  // Send measurement fields to Hevy (excluding date from body per API spec)
  const { date: _date, ...measurementFields } = payload
  await hevyRequest('PUT', `/v1/body_measurements/${date}`, hevyApiKey, measurementFields)

  const now = new Date().toISOString()
  const { error: dbErr } = await supabase
    .from('hevy_body_measurements')
    .upsert(
      {
        user_id: userId,
        date,
        weight_kg: payload.weight_kg ?? null,
        lean_mass_kg: payload.lean_mass_kg ?? null,
        fat_percent: payload.fat_percent ?? null,
        neck_cm: payload.neck_cm ?? null,
        shoulder_cm: payload.shoulder_cm ?? null,
        chest_cm: payload.chest_cm ?? null,
        left_bicep_cm: payload.left_bicep_cm ?? null,
        right_bicep_cm: payload.right_bicep_cm ?? null,
        left_forearm_cm: payload.left_forearm_cm ?? null,
        right_forearm_cm: payload.right_forearm_cm ?? null,
        abdomen_cm: payload.abdomen_cm ?? null,
        waist_cm: payload.waist_cm ?? null,
        hips_cm: payload.hips_cm ?? null,
        left_thigh_cm: payload.left_thigh_cm ?? null,
        right_thigh_cm: payload.right_thigh_cm ?? null,
        left_calf_cm: payload.left_calf_cm ?? null,
        right_calf_cm: payload.right_calf_cm ?? null,
        updated_at: now,
      },
      { onConflict: 'user_id,date' },
    )
  if (dbErr) throw dbErr

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const headers = corsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers })
  }

  try {
    // --- Auth ---
    const authHeader = req.headers.get('authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    // --- Hevy API key ---
    const hevyApiKey = Deno.env.get('HEVY_API_KEY')
    if (!hevyApiKey) {
      return new Response(
        JSON.stringify({ error: 'HEVY_API_KEY not configured' }),
        { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } },
      )
    }

    // --- Parse body ---
    const body = await req.json().catch(() => null)
    const action: string | undefined = body?.action
    const payload: Record<string, unknown> | undefined = body?.payload

    if (!action || payload === undefined) {
      return new Response(
        JSON.stringify({ error: 'Missing action or payload' }),
        { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } },
      )
    }

    // --- Dispatch ---
    let result: unknown

    try {
      switch (action) {
        case 'create_workout':
          result = await handleCreateWorkout(supabase, user.id, hevyApiKey, payload)
          break
        case 'update_workout':
          result = await handleUpdateWorkout(supabase, user.id, hevyApiKey, payload)
          break
        case 'create_routine':
          result = await handleCreateRoutine(supabase, user.id, hevyApiKey, payload)
          break
        case 'update_routine':
          result = await handleUpdateRoutine(supabase, user.id, hevyApiKey, payload)
          break
        case 'upsert_body_measurement':
          result = await handleUpsertBodyMeasurement(supabase, user.id, hevyApiKey, payload)
          break
        default:
          return new Response(
            JSON.stringify({ error: `Unknown action: ${action}` }),
            { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } },
          )
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : (err as any)?.message ?? JSON.stringify(err)
      if (msg.startsWith('Hevy API ')) {
        return new Response(
          JSON.stringify({ error: msg }),
          { status: 502, headers: { ...headers, 'Content-Type': 'application/json' } },
        )
      }
      // DB or validation errors
      return new Response(
        JSON.stringify({ error: msg }),
        { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } },
      )
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('hevy-api error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
    })
  }
})
