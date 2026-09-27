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
  // time_blocks.task_id is ON DELETE CASCADE (migration 077), so deleting the
  // task alone also removes its linked block — no separate time_blocks delete.
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

// ---------------------------------------------------------------------------
// Hevy API helper
// ---------------------------------------------------------------------------
class HevyApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

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
    throw new HevyApiError(res.status, `Hevy API ${res.status} ${method} ${path}: ${body}`)
  }
  // Tolerant parse: some Hevy write endpoints return 2xx with an EMPTY body
  // (live-verified on PUT /v1/body_measurements/{date}) — res.json() on that
  // throws "Unexpected end of JSON input" AFTER the write already succeeded,
  // so the UI reported an error for a save that actually worked (and the
  // local DB upsert after this call never ran). Callers that need a body
  // (create/update routine) still get real JSON when Hevy sends one.
  const text = await res.text().catch(() => '')
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// Hevy responses are inconsistent: an entity may come back directly, wrapped
// as { routine: {...} }, or wrapped as an array { routine: [ {...} ] }.
// Normalize all three shapes to a single entity object.
function unwrapEntity<T = any>(data: any, key: string): T {
  const v = data?.[key] ?? data
  return (Array.isArray(v) ? v[0] : v) as T
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------
// Hevy's POST/PUT /v1/workouts accept exactly these keys (published OpenAPI,
// checked 2026-09-27) and 400 on anything else ("… is not allowed"):
//   workout:  title, description, start_time, end_time, is_private, exercises
//   exercise: exercise_template_id, superset_id, notes, sets
//   set:      type, weight_kg, reps, distance_meters, duration_seconds, custom_metric, rpe
// No routine_id, no index/title. The web form already builds this shape
// (routineForm.workoutFormToPayload); this whitelist is the belt-and-braces
// guard so no caller can send a key Hevy rejects.
const WORKOUT_KEYS = ['title', 'description', 'start_time', 'end_time', 'is_private'] as const
const WORKOUT_SET_KEYS = ['type', 'weight_kg', 'reps', 'distance_meters', 'duration_seconds', 'custom_metric', 'rpe'] as const

// deno-lint-ignore no-explicit-any
function sanitizeWorkoutBody(payload: any): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of WORKOUT_KEYS) if (payload?.[k] !== undefined) out[k] = payload[k]
  // deno-lint-ignore no-explicit-any
  out.exercises = (payload?.exercises ?? []).map((ex: any) => ({
    exercise_template_id: ex?.exercise_template_id,
    superset_id:          ex?.superset_id ?? ex?.supersets_id ?? null,
    notes:                ex?.notes ?? null,
    // deno-lint-ignore no-explicit-any
    sets: (ex?.sets ?? []).map((set: any) => {
      const o: Record<string, unknown> = {}
      for (const k of WORKOUT_SET_KEYS) o[k] = set?.[k] ?? null
      if (o.type == null) o.type = 'normal'
      return o
    }),
  }))
  return out
}

async function handleCreateWorkout(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  hevyApiKey: string,
  payload: Record<string, unknown>,
) {
  const data = await hevyRequest('POST', '/v1/workouts', hevyApiKey, { workout: sanitizeWorkoutBody(payload) })
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
  const data = await hevyRequest('PUT', `/v1/workouts/${workoutId}`, hevyApiKey, { workout: sanitizeWorkoutBody(workoutBody) })
  const workout = unwrapEntity<HevyWorkout>(data, 'workout')
  if (!workout?.id) throw new Error('Hevy returned no workout id from update_workout')
  await upsertWorkoutToDb(supabase, userId, workout)
  return { ok: true }
}

// Hevy rejects `rep_range: null` on a set (it must be a { start, end } object
// or absent). Defensive belt-and-suspenders: drop any null rep_range from every
// set before sending, so no caller can trigger the 400 — without ever touching
// a real range object.
// deno-lint-ignore no-explicit-any
function stripNullRepRange(payload: any): void {
  for (const ex of payload?.exercises ?? []) {
    for (const set of ex?.sets ?? []) {
      if (set && set.rep_range == null && 'rep_range' in set) delete set.rep_range
    }
  }
}

async function handleCreateRoutine(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  hevyApiKey: string,
  payload: unknown,
) {
  stripNullRepRange(payload)
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
  // id belongs in the URL only — Hevy rejects it inside the request body.
  // folder_id is also rejected on update ("not allowed") — only valid on create.
  const { id: _id, folder_id: _folderId, ...routineBody } = payload
  stripNullRepRange(routineBody)
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

  const MEASUREMENT_KEYS = [
    'weight_kg', 'lean_mass_kg', 'fat_percent', 'neck_cm', 'shoulder_cm',
    'chest_cm', 'left_bicep_cm', 'right_bicep_cm', 'left_forearm_cm',
    'right_forearm_cm', 'abdomen_cm', 'waist_cm', 'hips_cm', 'left_thigh_cm',
    'right_thigh_cm', 'left_calf_cm', 'right_calf_cm',
  ] as const

  // MERGE semantics (real data-loss bug this fixes): Hevy's PUT replaces the
  // WHOLE day's measurement ("all fields are overwritten; omitted fields are
  // set to null" — its OpenAPI), and the old DB upsert wrote
  // `payload.X ?? null` for every column — so a partial save (e.g. just
  // tapping the weight suggestion chip and hitting Save) silently WIPED the
  // other values already recorded for that date, both in Hevy and locally.
  // Now: load what's stored for the date and overlay the caller's fields:
  //   key absent  → keep the stored value
  //   key = null  → clear it (the user emptied the field)
  //   key = n     → set it
  // If that read FAILS the save stops — merging onto "nothing stored" would
  // replace the whole day with only the provided fields (the same data loss).
  const { data: existing, error: readErr } = await supabase
    .from('hevy_body_measurements')
    .select('*')
    .eq('user_id', userId)
    .eq('date', date)
    .maybeSingle()
  if (readErr) throw new Error(`Couldn't read the stored measurement for ${date}, so nothing was saved: ${readErr.message}`)

  const merged: Record<string, number | null> = {}
  for (const key of MEASUREMENT_KEYS) {
    const has = Object.prototype.hasOwnProperty.call(payload, key)
    const provided = (payload as Record<string, unknown>)[key]
    if (!has || provided === undefined) {
      merged[key] = (existing?.[key] as number | null) ?? null
    } else if (provided === null) {
      merged[key] = null
    } else {
      const n = Number(provided)
      if (provided === '' || !Number.isFinite(n) || n < 0) throw new Error(`Invalid value for ${key}`)
      merged[key] = n
    }
  }

  // Hevy 400s on ANY null field ("Expected number, received null") — nulls
  // must be OMITTED from the request body, not sent (live-verified; this was
  // why every save used to fail). An omitted field is stored as null.
  const hevyBody: Record<string, number> = {}
  for (const [k, v] of Object.entries(merged)) {
    if (v !== null) hevyBody[k] = v
  }
  // Hevy has no DELETE for a body measurement, and an empty PUT isn't a
  // documented way to clear a day — refuse instead of leaving Hevy and the
  // local row disagreeing (the next Sync would bring the values back).
  if (Object.keys(hevyBody).length === 0) {
    throw new Error(existing
      ? "Hevy can't delete a whole day's measurement — keep at least one value, or delete the entry in the Hevy app."
      : 'Nothing to save — enter at least one value.')
  }
  // PUT is the live-verified write. Hevy's OpenAPI says PUT answers 404 when
  // it has no entry for the date and POST (409 when one exists) creates it —
  // so a 404 falls back to POST instead of failing a first-time save.
  try {
    await hevyRequest('PUT', `/v1/body_measurements/${date}`, hevyApiKey, hevyBody)
  } catch (err) {
    if (!(err instanceof HevyApiError) || err.status !== 404) throw err
    await hevyRequest('POST', '/v1/body_measurements', hevyApiKey, { date, ...hevyBody })
  }

  const now = new Date().toISOString()
  const { error: dbErr } = await supabase
    .from('hevy_body_measurements')
    .upsert(
      { user_id: userId, date, ...merged, updated_at: now },
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

    // --- Owner check ---
    // Writes go to ONE shared Hevy account (global HEVY_API_KEY): a valid JWT
    // alone would let any signed-up user create/overwrite the real owner's
    // workouts, routines and body measurements. Gate on the fixed owner id.
    const ownerId = Deno.env.get('HEVY_USER_ID')
    if (!ownerId || user.id !== ownerId) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
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
