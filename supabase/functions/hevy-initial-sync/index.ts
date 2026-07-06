import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { upsertRoutineToDb, upsertWorkoutToDb } from '../_shared/hevySync.ts'
import type { HevyRoutine, HevyWorkout } from '../_shared/hevySync.ts'

const ALLOWED_ORIGINS = ['https://lasciviens.github.io', 'http://localhost:5173']

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

async function hevyGet(path: string, hevyApiKey: string) {
  const res = await fetch(`https://api.hevyapp.com${path}`, {
    headers: { 'api-key': hevyApiKey, 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(`Hevy API error ${res.status}: ${path}`)
  return res.json()
}

// ---------------------------------------------------------------------------
// Step 1: Exercise Templates
// ---------------------------------------------------------------------------
async function syncExerciseTemplates(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  hevyApiKey: string,
): Promise<number> {
  let page = 1
  let totalSynced = 0

  while (true) {
    const data = await hevyGet(
      `/v1/exercise_templates?page=${page}&pageSize=100`,
      hevyApiKey,
    )
    const templates: Array<{
      id: string
      title: string
      type: string
      primary_muscle_group: string
      secondary_muscle_groups: string[]
      is_custom: boolean
    }> = data.exercise_templates ?? []

    if (templates.length === 0) break

    const now = new Date().toISOString()

    // Upsert templates
    const { error: upsertErr } = await supabase
      .from('hevy_exercise_templates')
      .upsert(
        templates.map((t) => ({
          id: t.id,
          user_id: userId,
          title: t.title,
          type: t.type,
          primary_muscle_group: t.primary_muscle_group,
          is_custom: t.is_custom,
          synced_at: now,
        })),
        { onConflict: 'id' },
      )
    if (upsertErr) throw upsertErr

    // Secondary muscles: delete then re-insert per template
    for (const t of templates) {
      const { error: delErr } = await supabase
        .from('hevy_exercise_template_muscles')
        .delete()
        .eq('exercise_template_id', t.id)
        .eq('user_id', userId)
      if (delErr) throw delErr

      if (t.secondary_muscle_groups.length > 0) {
        const { error: insErr } = await supabase
          .from('hevy_exercise_template_muscles')
          .insert(
            t.secondary_muscle_groups.map((mg) => ({
              user_id: userId,
              exercise_template_id: t.id,
              muscle_group: mg,
            })),
          )
        if (insErr) throw insErr
      }
    }

    totalSynced += templates.length

    if (page >= data.page_count) break
    page++
  }

  return totalSynced
}

// ---------------------------------------------------------------------------
// Step 2: Routine Folders
// ---------------------------------------------------------------------------
async function syncRoutineFolders(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  hevyApiKey: string,
): Promise<number> {
  // routine_folders doesn't support pageSize param — fetch all at once
  const data = await hevyGet(`/v1/routine_folders`, hevyApiKey)
  const folders: Array<{ id: number; title: string }> = data.routine_folders ?? []

  if (folders.length === 0) return 0

  const now = new Date().toISOString()
  const { error } = await supabase
    .from('hevy_routine_folders')
    .upsert(
      folders.map((f) => ({
        id: f.id,
        user_id: userId,
        title: f.title,
        synced_at: now,
      })),
      { onConflict: 'id' },
    )
  if (error) throw error

  return folders.length
}

// ---------------------------------------------------------------------------
// Step 3: Routines
// ---------------------------------------------------------------------------
async function syncRoutines(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  hevyApiKey: string,
): Promise<number> {
  let page = 1
  let totalSynced = 0

  while (true) {
    const data = await hevyGet(
      `/v1/routines?page=${page}&pageSize=10`,
      hevyApiKey,
    )
    const routines: HevyRoutine[] = data.routines ?? []

    if (routines.length === 0) break

    for (const routine of routines) {
      await upsertRoutineToDb(supabase, userId, routine)
    }

    totalSynced += routines.length

    if (page >= data.page_count) break
    page++
  }

  return totalSynced
}

// ---------------------------------------------------------------------------
// Step 4: Workouts
// ---------------------------------------------------------------------------
async function syncWorkouts(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  hevyApiKey: string,
): Promise<number> {
  let page = 1
  let totalSynced = 0

  while (true) {
    const data = await hevyGet(
      `/v1/workouts?page=${page}&pageSize=10`,
      hevyApiKey,
    )
    const workouts: HevyWorkout[] = data.workouts ?? []

    if (workouts.length === 0) break

    for (const workout of workouts) {
      await upsertWorkoutToDb(supabase, userId, workout)
    }

    totalSynced += workouts.length

    if (page >= data.page_count) break
    page++
  }

  return totalSynced
}

// ---------------------------------------------------------------------------
// Step 5: Body Measurements
// ---------------------------------------------------------------------------
async function syncBodyMeasurements(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  hevyApiKey: string,
): Promise<number> {
  let page = 1
  let totalSynced = 0

  while (true) {
    const data = await hevyGet(
      `/v1/body_measurements?page=${page}&pageSize=10`,
      hevyApiKey,
    )
    const measurements: Array<{
      date: string
      weight_kg: number | null
      lean_mass_kg: number | null
      fat_percent: number | null
      neck_cm: number | null
      shoulder_cm: number | null
      chest_cm: number | null
      left_bicep_cm: number | null
      right_bicep_cm: number | null
      left_forearm_cm: number | null
      right_forearm_cm: number | null
      abdomen_cm: number | null
      waist_cm: number | null
      hips_cm: number | null
      left_thigh_cm: number | null
      right_thigh_cm: number | null
      left_calf_cm: number | null
      right_calf_cm: number | null
    }> = data.body_measurements ?? []

    if (measurements.length === 0) break

    const now = new Date().toISOString()

    const { error } = await supabase
      .from('hevy_body_measurements')
      .upsert(
        measurements.map((m) => ({
          user_id: userId,
          date: m.date,
          weight_kg: m.weight_kg,
          lean_mass_kg: m.lean_mass_kg,
          fat_percent: m.fat_percent,
          neck_cm: m.neck_cm,
          shoulder_cm: m.shoulder_cm,
          chest_cm: m.chest_cm,
          left_bicep_cm: m.left_bicep_cm,
          right_bicep_cm: m.right_bicep_cm,
          left_forearm_cm: m.left_forearm_cm,
          right_forearm_cm: m.right_forearm_cm,
          abdomen_cm: m.abdomen_cm,
          waist_cm: m.waist_cm,
          hips_cm: m.hips_cm,
          left_thigh_cm: m.left_thigh_cm,
          right_thigh_cm: m.right_thigh_cm,
          left_calf_cm: m.left_calf_cm,
          right_calf_cm: m.right_calf_cm,
          updated_at: now,
        })),
        { onConflict: 'user_id,date' },
      )
    if (error) throw error

    totalSynced += measurements.length

    if (page >= data.page_count) break
    page++
  }

  return totalSynced
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
        {
          status: 500,
          headers: { ...headers, 'Content-Type': 'application/json' },
        },
      )
    }

    // --- Run sync steps ---
    let exerciseTemplates: number
    let routineFolders: number
    let routines: number
    let workouts: number
    let bodyMeasurements: number

    try {
      exerciseTemplates = await syncExerciseTemplates(supabase, user.id, hevyApiKey)
      routineFolders = await syncRoutineFolders(supabase, user.id, hevyApiKey)
      routines = await syncRoutines(supabase, user.id, hevyApiKey)
      workouts = await syncWorkouts(supabase, user.id, hevyApiKey)
      bodyMeasurements = await syncBodyMeasurements(supabase, user.id, hevyApiKey)
    } catch (err) {
      const msg = err instanceof Error ? err.message : (err as any)?.message ?? JSON.stringify(err)
      if (msg.includes('Hevy API error')) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 502,
          headers: { ...headers, 'Content-Type': 'application/json' },
        })
      }
      throw err
    }

    // --- Step 6: Update events cursor ---
    const now = new Date().toISOString()
    const { error: cursorErr } = await supabase
      .from('hevy_workout_events_cursor')
      .upsert(
        { user_id: user.id, last_events_since: now, updated_at: now },
        { onConflict: 'user_id' },
      )
    if (cursorErr) throw cursorErr

    return new Response(
      JSON.stringify({
        exercise_templates: exerciseTemplates,
        routine_folders: routineFolders,
        routines,
        workouts,
        body_measurements: bodyMeasurements,
      }),
      {
        status: 200,
        headers: { ...headers, 'Content-Type': 'application/json' },
      },
    )
  } catch (err) {
    const msg = err instanceof Error
      ? err.message
      : (err as any)?.message ?? JSON.stringify(err)
    console.error('hevy-initial-sync error:', msg)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
    })
  }
})
