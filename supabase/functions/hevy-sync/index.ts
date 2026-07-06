import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const jsonHeaders = { 'Content-Type': 'application/json' }

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const hevyApiKey = Deno.env.get('HEVY_API_KEY')!

async function hevyGet(path: string) {
  const res = await fetch(`https://api.hevyapp.com${path}`, {
    headers: { 'api-key': hevyApiKey },
  })
  if (!res.ok) throw new Error(`Hevy API ${res.status}: ${path}`)
  return res.json()
}

Deno.serve(async (req) => {
  // Handle preflight — Hevy servers won't send this but be safe
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 })
  }

  // Only POST is meaningful
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  // Verify webhook secret
  const secret = Deno.env.get('HEVY_WEBHOOK_SECRET')
  const authHeader = req.headers.get('authorization') ?? ''
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Resolve user ID (single-user app — stored in Vault)
  const userId = Deno.env.get('HEVY_USER_ID')
  if (!userId) {
    return new Response(
      JSON.stringify({ error: 'HEVY_USER_ID not configured' }),
      { status: 500, headers: jsonHeaders }
    )
  }

  // Parse request body
  let workoutId: string
  try {
    const body = await req.json()
    workoutId = body?.workoutId
    if (!workoutId) throw new Error('missing workoutId')
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Bad request: ${(err as Error).message}` }),
      { status: 400, headers: jsonHeaders }
    )
  }

  // Fetch full workout from Hevy
  let workout: {
    id: string
    title: string
    routine_id: string | null
    description: string | null
    start_time: string
    end_time: string
    updated_at: string
    created_at: string
    exercises: Array<{
      exercise_template_id: string
      index: number
      title: string
      notes: string | null
      superset_id?: number | null
      supersets_id?: number | null
      sets: Array<{
        index: number
        type: string
        weight_kg: number | null
        reps: number | null
        distance_meters: number | null
        duration_seconds: number | null
        rpe: number | null
        custom_metric: number | null
      }>
    }>
  }
  try {
    const data = await hevyGet(`/v1/workouts/${workoutId}`)
    // GET /v1/workouts/{id} returns the workout directly; tolerate wrapped/array shapes too
    const raw = data?.workout ?? data
    workout = Array.isArray(raw) ? raw[0] : raw
    if (!workout?.id) throw new Error('no workout in Hevy response')
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Hevy fetch failed: ${(err as Error).message}` }),
      { status: 502, headers: jsonHeaders }
    )
  }

  // Upsert hevy_workouts
  const { error: upsertWorkoutError } = await supabase
    .from('hevy_workouts')
    .upsert(
      {
        id: workout.id,
        user_id: userId,
        title: workout.title,
        routine_id: workout.routine_id ?? null,
        description: workout.description ?? null,
        start_time: workout.start_time,
        end_time: workout.end_time,
        hevy_updated_at: workout.updated_at,
        hevy_created_at: workout.created_at,
        synced_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    )

  if (upsertWorkoutError) {
    return new Response(
      JSON.stringify({ error: `upsert hevy_workouts: ${upsertWorkoutError.message}` }),
      { status: 500, headers: jsonHeaders }
    )
  }

  // Delete existing exercises for this workout (full replacement)
  const { error: deleteError } = await supabase
    .from('hevy_workout_exercises')
    .delete()
    .eq('hevy_workout_id', workout.id)
    .eq('user_id', userId)

  if (deleteError) {
    return new Response(
      JSON.stringify({ error: `delete hevy_workout_exercises: ${deleteError.message}` }),
      { status: 500, headers: jsonHeaders }
    )
  }

  // Insert exercises and their sets
  for (const ex of workout.exercises ?? []) {
    // Insert exercise row, get back the generated uuid
    const { data: exerciseRow, error: exInsertError } = await supabase
      .from('hevy_workout_exercises')
      .insert({
        user_id: userId,
        hevy_workout_id: workout.id,
        exercise_template_id: ex.exercise_template_id,
        index: ex.index,
        title: ex.title,
        notes: ex.notes ?? null,
        supersets_id: ex.superset_id ?? ex.supersets_id ?? null,
      })
      .select('id')
      .single()

    if (exInsertError || !exerciseRow) {
      return new Response(
        JSON.stringify({ error: `insert hevy_workout_exercises: ${exInsertError?.message}` }),
        { status: 500, headers: jsonHeaders }
      )
    }

    if (ex.sets.length === 0) continue

    // Insert all sets for this exercise
    const setsPayload = ex.sets.map((s) => ({
      user_id: userId,
      hevy_exercise_id: exerciseRow.id,
      exercise_template_id: ex.exercise_template_id,
      index: s.index,
      type: s.type,
      weight_kg: s.weight_kg ?? null,
      reps: s.reps ?? null,
      distance_meters: s.distance_meters ?? null,
      duration_seconds: s.duration_seconds ?? null,
      rpe: s.rpe ?? null,
      custom_metric: s.custom_metric ?? null,
    }))

    const { error: setsInsertError } = await supabase
      .from('hevy_sets')
      .insert(setsPayload)

    if (setsInsertError) {
      return new Response(
        JSON.stringify({ error: `insert hevy_sets: ${setsInsertError.message}` }),
        { status: 500, headers: jsonHeaders }
      )
    }
  }

  return new Response(
    JSON.stringify({ ok: true, workoutId }),
    { status: 200, headers: jsonHeaders }
  )
})
