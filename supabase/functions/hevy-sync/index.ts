// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0'

// <supabase-keys>
// Supabase's new API keys (sb_secret_… / sb_publishable_…) arrive as JSON
// dictionaries keyed by name; the legacy JWT keys are the fallback until the
// owner switches them off (docs/backend/environment.md). Same in every
// function (scripts/verify-supabase-keys.cjs).
function supabaseKey(newVar: string, legacyVar: string): string {
  try {
    const keys = JSON.parse(Deno.env.get(newVar) ?? '{}') as Record<string, unknown>
    const key = keys.default ?? Object.values(keys)[0]
    if (typeof key === 'string' && key) return key
  } catch { /* not set or not JSON: the legacy key */ }
  return Deno.env.get(legacyVar) ?? ''
}
const serviceKey = () => supabaseKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
const publishableKey = () => supabaseKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
// </supabase-keys>

// ── Inlined from the former _shared/hevySync.ts ─────────────────────────────
// Kept as a per-function copy because Supabase Dashboard deploys don't bundle
// sibling _shared/ files. If this Hevy upsert logic ever changes, update the
// copy in all four functions (hevy-sync / hevy-initial-sync /
// hevy-incremental-sync / hevy-api) by hand — from the import above to the
// end marker below; scripts/verify-hevy-api.cjs fails when they differ.
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

  // A planned session this workout fulfils is marked done and linked to it
  // by the database itself (migration 141, trigger on hevy_workouts) — for
  // every writer, never a future plan, and nothing is deleted.
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

// ── Exercise templates and the account (migration 154) ─────────────────────
// Field shapes are Hevy's published OpenAPI (checked 14.10.2026; no live
// sample was read — docs/integrations/hevy.md). Each value is checked where it
// enters; one that isn't what the spec says is stored as unknown (NULL) or the
// row is skipped, never guessed.

export interface HevyTemplateRow {
  id: string
  title: string
  type: string
  primary_muscle_group: string | null
  secondary_muscle_groups: string[]
  is_custom: boolean
  /** Hevy's own picture of the exercise; null when it has none. */
  thumbnail_url: string | null
}

// Template ids: 8 hex characters for Hevy's library ("D04AC939"), a UUID in
// the spec's example; POST /v1/exercise_templates answers a number.
const HEVY_TEMPLATE_ID = /^[A-Za-z0-9_-]{1,64}$/
// The same rule as migration 154's CHECK: an http(s) URL without spaces.
const HEVY_IMAGE_URL = /^https?:\/\/\S+$/i

export function hevyTemplateId(v: unknown): string | null {
  const s = typeof v === 'number' && Number.isSafeInteger(v) ? String(v) : v
  return typeof s === 'string' && HEVY_TEMPLATE_ID.test(s) ? s : null
}

/** One ExerciseTemplate, or null when it has no usable id, title or type. */
export function cleanExerciseTemplate(raw: any): HevyTemplateRow | null {
  if (!raw || typeof raw !== 'object') return null
  const id = hevyTemplateId(raw.id)
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  const type = typeof raw.type === 'string' ? raw.type.trim() : ''
  if (!id || !title || !type) return null
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const thumb = text(raw.thumbnail_url)
  const secondary = Array.isArray(raw.secondary_muscle_groups)
    ? [...new Set(raw.secondary_muscle_groups.map(text).filter((m: string | null): m is string => !!m))]
    : []
  return {
    id, title, type,
    primary_muscle_group: text(raw.primary_muscle_group),
    secondary_muscle_groups: secondary as string[],
    is_custom: raw.is_custom === true,
    thumbnail_url: thumb && thumb.length <= 2048 && HEVY_IMAGE_URL.test(thumb) ? thumb : null,
  }
}

// A column added by a migration that hasn't run (42703 from Postgres,
// PGRST204 from PostgREST's schema cache).
function isMissingColumn(error: any, column: string): boolean {
  return (error?.code === '42703' || error?.code === 'PGRST204') && String(error?.message ?? '').includes(column)
}

/** Stores templates and their secondary muscles: one upsert, one delete and
 *  one insert for the whole batch (the library is a few hundred rows). */
export async function upsertExerciseTemplatesToDb(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  templates: HevyTemplateRow[],
) {
  if (templates.length === 0) return
  const now = new Date().toISOString()
  const rows = templates.map((t) => ({
    id: t.id, user_id: userId, title: t.title, type: t.type,
    primary_muscle_group: t.primary_muscle_group, is_custom: t.is_custom,
    thumbnail_url: t.thumbnail_url, synced_at: now,
  }))
  let { error } = await supabase.from('hevy_exercise_templates').upsert(rows, { onConflict: 'id' })
  // Before migration 154 there is no thumbnail_url: store the rest.
  if (error && isMissingColumn(error, 'thumbnail_url')) {
    ;({ error } = await supabase.from('hevy_exercise_templates')
      .upsert(rows.map(({ thumbnail_url: _t, ...r }) => r), { onConflict: 'id' }))
  }
  if (error) throw error

  const { error: delErr } = await supabase
    .from('hevy_exercise_template_muscles')
    .delete()
    .eq('user_id', userId)
    .in('exercise_template_id', templates.map((t) => t.id))
  if (delErr) throw delErr
  const muscles = templates.flatMap((t) => t.secondary_muscle_groups.map((mg) => ({
    user_id: userId, exercise_template_id: t.id, muscle_group: mg,
  })))
  if (muscles.length > 0) {
    const { error: insErr } = await supabase.from('hevy_exercise_template_muscles').insert(muscles)
    if (insErr) throw insErr
  }
}

/** A GET with the key in its header. `data` is null on an empty or non-JSON body. */
export async function hevyGetJson(path: string, hevyApiKey: string): Promise<{ status: number; data: any }> {
  const res = await fetch(`https://api.hevyapp.com${path}`, { headers: { 'api-key': hevyApiKey } })
  const text = await res.text().catch(() => '')
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { data = null }
  return { status: res.status, data }
}

/** GET /v1/exercise_templates/{id}. The spec answers the template itself; a
 *  wrapped { exercise_template } (or a one-element array) is tolerated.
 *  null when Hevy has no such template (404) or sent something else. */
export async function fetchExerciseTemplateById(id: string, hevyApiKey: string): Promise<HevyTemplateRow | null> {
  const { status, data } = await hevyGetJson(`/v1/exercise_templates/${encodeURIComponent(id)}`, hevyApiKey)
  if (status === 404) return null
  if (status < 200 || status >= 300) throw new Error(`Hevy API ${status}: GET /v1/exercise_templates/{id}`)
  const raw = data?.exercise_template ?? data
  return cleanExerciseTemplate(Array.isArray(raw) ? raw[0] : raw)
}

/** Templates the given workouts name that aren't stored yet (a custom
 *  exercise made in the Hevy app since the last library read): each is
 *  fetched by id and stored. One that Hevy can't return is skipped (it is
 *  tried again with the next workout that names it). Returns how many came. */
export async function ensureExerciseTemplates(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  workouts: Array<{ exercises?: Array<{ exercise_template_id?: unknown }> }>,
  hevyApiKey: string,
): Promise<number> {
  const wanted = [...new Set(workouts.flatMap((w) => (w?.exercises ?? []).map((e) => hevyTemplateId(e?.exercise_template_id)))
    .filter((id): id is string => !!id))]
  if (wanted.length === 0) return 0
  const known = new Set<string>()
  for (let i = 0; i < wanted.length; i += 100) {
    const { data, error } = await supabase.from('hevy_exercise_templates').select('id')
      .eq('user_id', userId).in('id', wanted.slice(i, i + 100))
    if (error) throw error
    for (const r of (data ?? []) as Array<{ id: string }>) known.add(r.id)
  }
  const found: HevyTemplateRow[] = []
  for (const id of wanted) {
    if (known.has(id)) continue
    try {
      const t = await fetchExerciseTemplateById(id, hevyApiKey)
      if (t) found.push(t)
    } catch (err) {
      console.warn(`hevy template ${id} not fetched: ${(err as Error).message}`)
    }
  }
  await upsertExerciseTemplatesToDb(supabase, userId, found)
  return found.length
}

export type HevyWeightUnit = 'kg' | 'lbs'
export type HevyDistanceUnit = 'kilometers' | 'miles'
export interface HevyUserInfo {
  username: string | null
  weight_unit: HevyWeightUnit | null
  distance_unit: HevyDistanceUnit | null
  is_pro: boolean | null
}

/** GET /v1/user/info answers { data: UserInfo }; a bare UserInfo is tolerated. */
export function cleanUserInfo(body: any): HevyUserInfo | null {
  const raw = body?.data ?? body
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const username = typeof raw.username === 'string' && raw.username.trim() ? raw.username.trim().slice(0, 200) : null
  const info: HevyUserInfo = {
    username,
    weight_unit: raw.weight_unit === 'kg' || raw.weight_unit === 'lbs' ? raw.weight_unit : null,
    distance_unit: raw.distance_unit === 'kilometers' || raw.distance_unit === 'miles' ? raw.distance_unit : null,
    is_pro: typeof raw.is_pro === 'boolean' ? raw.is_pro : null,
  }
  // Not one field as the spec describes it: another shape, not an account.
  return Object.values(info).every((v) => v === null) ? null : info
}

/** GET /v1/workouts/count answers { workout_count }. */
export function cleanWorkoutCount(body: any): number | null {
  const n = body?.workout_count
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null
}

/** Reads user info and the workout count and stores them in hevy_account
 *  (migration 154). Never throws: the sync it follows has already
 *  succeeded. A read that fails stores why (last_error, last_error_at —
 *  a status or "unexpected shape", never a header or a key), keeps the
 *  facts it already had, and says so in `error`; a good read clears it. */
export async function refreshHevyAccount(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  hevyApiKey: string,
): Promise<{ ok: boolean; hevy_workout_count: number | null; error: string | null }> {
  const brief = (err: unknown) => String((err as Error)?.message ?? err ?? 'unknown error').slice(0, 120)
  const problems: string[] = []
  const row: Record<string, unknown> = { user_id: userId }
  let count: number | null = null
  try {
    const info = await hevyGetJson('/v1/user/info', hevyApiKey)
    const answered = info.status >= 200 && info.status < 300
    const user = answered ? cleanUserInfo(info.data) : null
    if (user) Object.assign(row, user, { synced_at: new Date().toISOString() })
    else problems.push(answered ? 'user info: unexpected shape' : `user info: Hevy answered ${info.status}`)
  } catch (err) {
    problems.push(`user info: ${brief(err)}`)
  }
  try {
    // Taken before the request: the app compares the count with the
    // workouts Hevy created up to this moment.
    const checkedAt = new Date().toISOString()
    const counted = await hevyGetJson('/v1/workouts/count', hevyApiKey)
    const answered = counted.status >= 200 && counted.status < 300
    count = answered ? cleanWorkoutCount(counted.data) : null
    if (count != null) Object.assign(row, { hevy_workout_count: count, count_checked_at: checkedAt })
    else problems.push(answered ? 'count: unexpected shape' : `count: Hevy answered ${counted.status}`)
  } catch (err) {
    problems.push(`count: ${brief(err)}`)
  }
  const error = problems.length > 0 ? problems.join('; ').slice(0, 300) : null
  Object.assign(row, { last_error: error, last_error_at: error ? new Date().toISOString() : null })
  try {
    const { error: dbErr } = await supabase.from('hevy_account').upsert(row, { onConflict: 'user_id' })
    if (dbErr) throw dbErr
  } catch (err) {
    console.warn(`hevy account not stored: ${brief(err)}`)
    return { ok: false, hevy_workout_count: count, error: error ?? `not stored: ${brief(err)}` }
  }
  if (error) console.warn(`hevy account not read: ${error}`)
  return { ok: error === null, hevy_workout_count: count, error }
}

/** Every page of a Hevy list (`page`, `page_count`, the list under `key`).
 *  `complete` is false when a page came back in another shape or the run
 *  stopped early — a caller that prunes must not prune then. */
export async function hevyListAll(
  path: string,
  key: string,
  pageSize: number,
  hevyApiKey: string,
  onPage: (items: any[]) => Promise<void>,
): Promise<{ complete: boolean; total: number }> {
  let total = 0
  for (let page = 1; page <= 1000; page++) {
    const sep = path.includes('?') ? '&' : '?'
    const { status, data } = await hevyGetJson(`${path}${sep}page=${page}&pageSize=${pageSize}`, hevyApiKey)
    // Past the last page some lists answer 404 ("Page not found") instead of an empty list.
    if (status === 404 && page > 1) return { complete: true, total }
    if (status < 200 || status >= 300) throw new Error(`Hevy API ${status}: GET ${path}`)
    const items = data?.[key]
    if (!Array.isArray(items)) return { complete: false, total }
    if (items.length > 0) await onPage(items)
    total += items.length
    const pageCount = Number(data?.page_count)
    if (Number.isFinite(pageCount) ? page >= pageCount : items.length === 0) return { complete: true, total }
    if (items.length === 0) return { complete: false, total }
  }
  return { complete: false, total }
}

/** Every routine folder, page by page (at most 10 per page), stored. */
export async function syncAllRoutineFolders(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  hevyApiKey: string,
): Promise<number> {
  const { total } = await hevyListAll('/v1/routine_folders', 'routine_folders', 10, hevyApiKey, async (items) => {
    const now = new Date().toISOString()
    const rows = items
      .filter((f: any) => Number.isSafeInteger(f?.id) && f.id > 0 && typeof f?.title === 'string')
      .map((f: any) => ({ id: f.id, user_id: userId, title: f.title, synced_at: now }))
    if (rows.length === 0) return
    const { error } = await supabase.from('hevy_routine_folders').upsert(rows, { onConflict: 'id' })
    if (error) throw error
  })
  return total
}

/** Hevy's whole exercise library (custom exercises included), 100 per page. */
export async function syncAllExerciseTemplates(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  hevyApiKey: string,
): Promise<number> {
  let stored = 0
  await hevyListAll('/v1/exercise_templates', 'exercise_templates', 100, hevyApiKey, async (items) => {
    const templates = items.map(cleanExerciseTemplate).filter((t): t is HevyTemplateRow => !!t)
    await upsertExerciseTemplatesToDb(supabase, userId, templates)
    stored += templates.length
  })
  return stored
}
// ── End of the shared Hevy block (scripts/verify-hevy-api.cjs compares the four copies) ──

const jsonHeaders = { 'Content-Type': 'application/json' }

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  serviceKey()
)

const hevyApiKey = Deno.env.get('HEVY_API_KEY')!

async function hevyGet(path: string) {
  const res = await fetch(`https://api.hevyapp.com${path}`, {
    headers: { 'api-key': hevyApiKey },
  })
  if (!res.ok) throw new Error(`Hevy API ${res.status}: ${path}`)
  return res.json()
}

// Constant-time secret check (security review 26.10.2026): both sides are
// hashed to the same length first, so the answer time shows neither the
// secret's length nor how much of it matched. Never log either value.
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const hash = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  const [a, b] = await Promise.all([hash(given), hash(expected)])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
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
  if (!secret || !(await sameSecret(authHeader, `Bearer ${secret}`))) {
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
  let workout: HevyWorkout
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

  try {
    await upsertWorkoutToDb(supabase, userId, workout)
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `upsert workout: ${(err as Error).message}` }),
      { status: 500, headers: jsonHeaders }
    )
  }

  // An exercise the library here doesn't have yet (a custom one made in the
  // Hevy app) is fetched by id, so the workout shows its name, muscles and
  // picture. The workout is already stored: a failure here doesn't fail it
  // (the next Sync reads the whole library again).
  let templatesAdded = 0
  try {
    templatesAdded = await ensureExerciseTemplates(supabase, userId, [workout], hevyApiKey)
  } catch (err) {
    console.warn(`hevy-sync: exercise templates not checked: ${(err as Error).message}`)
  }

  return new Response(
    JSON.stringify({ ok: true, workoutId, templates_added: templatesAdded }),
    { status: 200, headers: jsonHeaders }
  )
})
