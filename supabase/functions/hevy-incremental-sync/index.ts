// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── Inlined from the former _shared/hevySync.ts ─────────────────────────────
// Kept as a per-function copy because Supabase Dashboard deploys don't bundle
// sibling _shared/ files. If this Hevy upsert logic ever changes, update the
// copy in all four functions (hevy-sync / hevy-initial-sync /
// hevy-incremental-sync / hevy-api) by hand.
// Shared Hevy workout/routine → Supabase upsert logic. Was independently
// duplicated (upsert row → delete exercises → re-insert exercises+sets) across
// hevy-sync, hevy-initial-sync, hevy-incremental-sync and hevy-api.

export interface HevyWorkoutSet {
  index: number
  type: string
  weight_kg: number | null
  reps: number | null
  distance_meters: number | null
  duration_seconds: number | null
  rpe: number | null
  custom_metric: number | null
}

export interface HevyWorkoutExercise {
  index: number
  title: string
  notes: string | null
  exercise_template_id: string
  superset_id?: number | null
  supersets_id?: number | null
  sets: HevyWorkoutSet[]
}

export interface HevyWorkout {
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

export async function upsertWorkoutToDb(
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
            hevy_exercise_id: (insertedExercise as any).id,
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

  // If this workout was logged from a routine, and that routine had a planned
  // session task open (created via RoutinesTab "Plan routine" →
  // source_type='training_session'), the real workout fulfills it — close it.
  // Freeform workouts (no routine_id) are left alone; the client surfaces a
  // manual-confirm suggestion for those instead (see WorkoutsSubTab).
  if (workout.routine_id) {
    await closeMatchingTrainingTask(supabase, userId, workout.routine_id)
  }
}

async function closeMatchingTrainingTask(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  routineId: string,
) {
  const { data: tasks, error: taskErr } = await supabase
    .from('tasks')
    .select('id')
    .eq('user_id', userId)
    .eq('source_type', 'training_session')
    .eq('source_id', routineId)
    .neq('status', 'done')
    .neq('status', 'cancelled')
  if (taskErr) throw taskErr

  const taskIds = (tasks ?? []).map((t: any) => t.id)
  if (taskIds.length === 0) return

  // Mirrors the client's deleteTask (tasksApi.ts) minus Google Calendar
  // cleanup — no user OAuth token is available from this server context.
  const { error: blockErr } = await supabase
    .from('time_blocks')
    .delete()
    .eq('source_type', 'task')
    .in('source_id', taskIds)
  if (blockErr) throw blockErr

  const { error: delTaskErr } = await supabase
    .from('tasks')
    .delete()
    .in('id', taskIds)
  if (delTaskErr) throw delTaskErr
}

export interface HevyRoutineSet {
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

export interface HevyRoutineExercise {
  index: number
  title: string
  notes: string | null
  rest_seconds: number | null
  exercise_template_id: string
  superset_id?: number | null
  supersets_id?: number | null
  sets: HevyRoutineSet[]
}

export interface HevyRoutine {
  id: string
  title: string
  folder_id: string | null
  notes: string | null
  updated_at: string
  created_at: string
  exercises: HevyRoutineExercise[]
}

export async function upsertRoutineToDb(
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
            hevy_routine_exercise_id: (insertedExercise as any).id,
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

const ALLOWED_ORIGINS = ['https://lasciviens.github.io', 'http://localhost:5173']

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

const hevyApiKey = Deno.env.get('HEVY_API_KEY')

async function hevyGet(path: string) {
  const res = await fetch(`https://api.hevyapp.com${path}`, {
    headers: { 'api-key': hevyApiKey! },
  })
  if (!res.ok) throw new Error(`Hevy API ${res.status}: ${path}`)
  return res.json()
}

// Routines, routine folders and body measurements have NO event feed on Hevy,
// so the workout-events delta above never picks up a routine you created in the
// Hevy app. These are small collections — on each Sync we just re-fetch them all
// and upsert, so "Sync" keeps everything current without a full re-import.
// deno-lint-ignore no-explicit-any
async function refreshRoutineFolders(supabase: any, userId: string): Promise<void> {
  const data = await hevyGet(`/v1/routine_folders`)
  const folders: Array<{ id: number; title: string }> = data.routine_folders ?? []
  if (folders.length === 0) return
  const now = new Date().toISOString()
  const { error } = await supabase.from('hevy_routine_folders').upsert(
    folders.map((f) => ({ id: f.id, user_id: userId, title: f.title, synced_at: now })),
    { onConflict: 'id' },
  )
  if (error) throw error
}

// deno-lint-ignore no-explicit-any
async function refreshRoutines(supabase: any, userId: string): Promise<number> {
  let page = 1
  let total = 0
  const seenIds = new Set<string>()
  while (true) {
    const data = await hevyGet(`/v1/routines?page=${page}&pageSize=10`)
    // deno-lint-ignore no-explicit-any
    const routines: any[] = data.routines ?? []
    if (routines.length === 0) break
    const now = new Date().toISOString()
    for (const routine of routines) {
      seenIds.add(routine.id)
      const { error: rErr } = await supabase.from('hevy_routines').upsert({
        id: routine.id, user_id: userId, folder_id: routine.folder_id ?? null,
        title: routine.title, notes: routine.notes ?? null,
        hevy_updated_at: routine.updated_at, hevy_created_at: routine.created_at, synced_at: now,
      }, { onConflict: 'id' })
      if (rErr) throw rErr

      const { error: delErr } = await supabase.from('hevy_routine_exercises')
        .delete().eq('hevy_routine_id', routine.id).eq('user_id', userId)
      if (delErr) throw delErr

      for (const ex of routine.exercises ?? []) {
        const { data: exRow, error: exErr } = await supabase.from('hevy_routine_exercises').insert({
          user_id: userId, hevy_routine_id: routine.id,
          exercise_template_id: ex.exercise_template_id, index: ex.index, title: ex.title,
          notes: ex.notes ?? null, rest_seconds: ex.rest_seconds ?? null, supersets_id: ex.superset_id ?? ex.supersets_id ?? null,
        }).select('id').single()
        if (exErr) throw exErr
        if ((ex.sets ?? []).length > 0) {
          // deno-lint-ignore no-explicit-any
          const { error: sErr } = await supabase.from('hevy_routine_sets').insert(ex.sets.map((s: any) => ({
            user_id: userId, hevy_routine_exercise_id: exRow.id, index: s.index, type: s.type,
            weight_kg: s.weight_kg, reps: s.reps,
            rep_range_start: s.rep_range?.start ?? null, rep_range_end: s.rep_range?.end ?? null,
            distance_meters: s.distance_meters, duration_seconds: s.duration_seconds,
            rpe: s.rpe, custom_metric: s.custom_metric,
          })))
          if (sErr) throw sErr
        }
      }
    }
    total += routines.length
    if (page >= data.page_count) break
    page++
  }

  // Routines have no delete-event feed (see the comment above this function),
  // so a routine removed in the Hevy app between syncs previously left a
  // STALE local row forever — this function only ever upserted. Real bug this
  // fixes: the AI (or the UI) would db_query a stale id from hevy_routines and
  // then get a 404 "Routine not found" from Hevy on update/delete. Reconcile
  // against this fresh full list: anything local that Hevy didn't return this
  // time is gone from Hevy, so delete it here too. Cascades to
  // hevy_routine_exercises/hevy_routine_sets via their ON DELETE CASCADE FKs
  // (024_hevy.sql). Safe even when seenIds is empty (a real zero-routines
  // account) — hevyGet throws on a non-ok response, so we only ever reach
  // here after a genuinely successful full fetch, never a transient failure.
  const { data: localRoutines, error: localErr } = await supabase
    .from('hevy_routines').select('id').eq('user_id', userId)
  if (localErr) throw localErr
  // deno-lint-ignore no-explicit-any
  const staleIds = (localRoutines ?? []).map((r: any) => r.id as string).filter((id: string) => !seenIds.has(id))
  if (staleIds.length > 0) {
    const { error: staleErr } = await supabase.from('hevy_routines')
      .delete().eq('user_id', userId).in('id', staleIds)
    if (staleErr) throw staleErr
  }
  return total
}

// deno-lint-ignore no-explicit-any
async function refreshBodyMeasurements(supabase: any, userId: string): Promise<void> {
  let page = 1
  while (true) {
    const data = await hevyGet(`/v1/body_measurements?page=${page}&pageSize=10`)
    // deno-lint-ignore no-explicit-any
    const measurements: any[] = data.body_measurements ?? []
    if (measurements.length === 0) break
    const now = new Date().toISOString()
    // Map explicit columns — do NOT spread ...m: Hevy's measurement object
    // carries its own numeric `id`, which would land in the uuid `id` column
    // ("invalid input syntax for type uuid").
    const { error } = await supabase.from('hevy_body_measurements').upsert(
      // deno-lint-ignore no-explicit-any
      measurements.map((m: any) => ({
        user_id: userId, date: m.date,
        weight_kg: m.weight_kg ?? null, lean_mass_kg: m.lean_mass_kg ?? null, fat_percent: m.fat_percent ?? null,
        neck_cm: m.neck_cm ?? null, shoulder_cm: m.shoulder_cm ?? null, chest_cm: m.chest_cm ?? null,
        left_bicep_cm: m.left_bicep_cm ?? null, right_bicep_cm: m.right_bicep_cm ?? null,
        left_forearm_cm: m.left_forearm_cm ?? null, right_forearm_cm: m.right_forearm_cm ?? null,
        abdomen_cm: m.abdomen_cm ?? null, waist_cm: m.waist_cm ?? null, hips_cm: m.hips_cm ?? null,
        left_thigh_cm: m.left_thigh_cm ?? null, right_thigh_cm: m.right_thigh_cm ?? null,
        left_calf_cm: m.left_calf_cm ?? null, right_calf_cm: m.right_calf_cm ?? null,
        updated_at: now,
      })),
      { onConflict: 'user_id,date' },
    )
    if (error) throw error
    if (page >= data.page_count) break
    page++
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const headers = corsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers })
  }

  try {
    // Guard: HEVY_API_KEY must be set
    if (!hevyApiKey) {
      return new Response(
        JSON.stringify({ error: 'HEVY_API_KEY not configured' }),
        { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    // Verify JWT
    const authHeader = req.headers.get('authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization' }),
        { status: 401, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    // Owner check: one shared Hevy account (global HEVY_API_KEY), so a valid
    // JWT alone isn't enough — gate on the fixed owner id (see hevy-sync).
    const ownerId = Deno.env.get('HEVY_USER_ID')
    if (!ownerId || user.id !== ownerId) {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    // Step 1: Read last cursor
    const { data: cursorRow } = await supabase
      .from('hevy_workout_events_cursor')
      .select('last_events_since')
      .eq('user_id', user.id)
      .maybeSingle()

    const since = cursorRow?.last_events_since ?? '1970-01-01T00:00:00Z'

    // Step 2: Paginate all events since the cursor.
    // Hevy event shapes (oneOf):
    //   updated → { type: 'updated', workout: { ...full workout... } }
    //   deleted → { type: 'deleted', id: string, deleted_at: string }
    // NOTE: 'updated' events embed the full workout — there is no event.id on them.
    type HevyEvent =
      | { type: 'updated'; workout: HevyWorkout }
      | { type: 'deleted'; id: string; deleted_at: string }

    const allEvents: HevyEvent[] = []
    let page = 1

    while (true) {
      let data: { page: number; page_count: number; events: HevyEvent[] }
      try {
        data = await hevyGet(
          `/v1/workouts/events?page=${page}&pageSize=10&since=${encodeURIComponent(since)}`
        )
      } catch (err) {
        return new Response(
          JSON.stringify({ error: `Hevy fetch failed: ${(err as Error).message}` }),
          { status: 502, headers: { ...headers, 'Content-Type': 'application/json' } }
        )
      }

      allEvents.push(...(data.events ?? []))

      if (page >= data.page_count) break
      page++
    }

    // Separate events. Deletes carry an id; updates carry the full workout.
    // Dedupe updates by workout id (later events win).
    const toDeleteSet = new Set<string>()
    const toUpdate = new Map<string, HevyWorkout>()

    for (const event of allEvents) {
      if (event.type === 'deleted') {
        if (event.id) toDeleteSet.add(event.id)
      } else if (event.type === 'updated' && event.workout?.id) {
        toUpdate.set(event.workout.id, event.workout)
      }
    }

    // Step 3: Process deletions
    for (const workoutId of toDeleteSet) {
      const { error: deleteError } = await supabase
        .from('hevy_workouts')
        .delete()
        .eq('id', workoutId)
        .eq('user_id', user.id)
      // CASCADE handles hevy_workout_exercises and hevy_sets

      if (deleteError) {
        return new Response(
          JSON.stringify({ error: `delete hevy_workouts: ${deleteError.message}` }),
          { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
        )
      }
    }

    // Step 4: Process updates (skip workouts that were also deleted).
    // The workout payload is already embedded in the event — no re-fetch needed.
    let updatedCount = 0

    for (const [workoutId, workout] of toUpdate) {
      if (toDeleteSet.has(workoutId)) continue

      try {
        await upsertWorkoutToDb(supabase, user.id, workout)
      } catch (err) {
        return new Response(
          JSON.stringify({ error: `upsert workout: ${(err as Error).message}` }),
          { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
        )
      }

      updatedCount++
    }

    // Step 4b: Re-fetch the small, event-less collections so routines/folders/
    // body measurements created or edited in the Hevy app show up on Sync
    // (no more needing "Import all" for a new routine).
    let routinesSynced = 0
    try {
      await refreshRoutineFolders(supabase, user.id)
      routinesSynced = await refreshRoutines(supabase, user.id)
      await refreshBodyMeasurements(supabase, user.id)
    } catch (err) {
      return new Response(
        JSON.stringify({ error: `refresh routines/body failed: ${(err as Error).message}` }),
        { status: 502, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    // Step 5: Advance cursor to now
    const { error: cursorError } = await supabase
      .from('hevy_workout_events_cursor')
      .upsert(
        {
          user_id: user.id,
          last_events_since: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )

    if (cursorError) {
      return new Response(
        JSON.stringify({ error: `upsert hevy_workout_events_cursor: ${cursorError.message}` }),
        { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ updated: updatedCount, deleted: toDeleteSet.size, routines: routinesSynced }),
      { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    const origin2 = req.headers.get('origin')
    const headers2 = corsHeaders(origin2)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : (err as any)?.message ?? JSON.stringify(err) }),
      { status: 500, headers: { ...headers2, 'Content-Type': 'application/json' } }
    )
  }
})
