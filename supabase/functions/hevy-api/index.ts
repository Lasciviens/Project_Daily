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
  await ensureTemplatesQuietly(supabase, userId, [workout], hevyApiKey)
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
  await ensureTemplatesQuietly(supabase, userId, [workout], hevyApiKey)
  return { ok: true }
}

// The workout is saved in Hevy and here already: a template that can't be
// fetched now arrives with the next Sync, so it never fails the save.
async function ensureTemplatesQuietly(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  workouts: HevyWorkout[],
  hevyApiKey: string,
) {
  try {
    await ensureExerciseTemplates(supabase, userId, workouts, hevyApiKey)
  } catch (err) {
    console.warn(`hevy-api: exercise templates not checked: ${(err as Error).message}`)
  }
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
  // Our columns end in "_cm"; Hevy's OpenAPI names seven of them without it
  // (PutBodyMeasurement / BodyMeasurement: abdomen, waist, hips, left_thigh,
  // right_thigh, left_calf, right_calf), so those are sent under its names.
  const HEVY_NAME: Record<string, string> = {
    abdomen_cm: 'abdomen', waist_cm: 'waist', hips_cm: 'hips',
    left_thigh_cm: 'left_thigh', right_thigh_cm: 'right_thigh', left_calf_cm: 'left_calf', right_calf_cm: 'right_calf',
  }
  const hevyBody: Record<string, number> = {}
  for (const [k, v] of Object.entries(merged)) {
    if (v !== null) hevyBody[HEVY_NAME[k] ?? k] = v
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
// Exercise history — GET /v1/exercise_history/{exerciseTemplateId}
// ---------------------------------------------------------------------------
// One entry per logged set (ExerciseHistoryEntry in Hevy's OpenAPI): the
// workout's id, title and times, the set's values and `set_type`. Read live,
// never stored: the app keeps its own sets in hevy_sets; this is Hevy's own
// record of one exercise, shown beside it.

const HISTORY_SET_TYPE = /^[a-z_]{1,32}$/

function isoParam(v: unknown, name: string): string | null {
  if (v == null || v === '') return null
  const d = typeof v === 'string' ? new Date(v) : null
  if (!d || Number.isNaN(d.getTime())) throw new Error(`payload.${name} must be a date`)
  // The spec's own format: "2024-01-01T00:00:00Z" (whole seconds).
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

const finiteOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const timeOrNull = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null)

function cleanHistoryEntry(e: any, templateId: string) {
  if (!e || typeof e !== 'object') return null
  if (typeof e.exercise_template_id === 'string' && e.exercise_template_id !== templateId) return null
  const workoutId = typeof e.workout_id === 'string' && e.workout_id ? e.workout_id : null
  const start = timeOrNull(e.workout_start_time)
  if (!workoutId || !start) return null
  return {
    workout_id: workoutId,
    workout_title: typeof e.workout_title === 'string' ? e.workout_title : '',
    workout_start_time: start,
    workout_end_time: timeOrNull(e.workout_end_time),
    weight_kg: finiteOrNull(e.weight_kg),
    reps: finiteOrNull(e.reps),
    distance_meters: finiteOrNull(e.distance_meters),
    duration_seconds: finiteOrNull(e.duration_seconds),
    rpe: finiteOrNull(e.rpe),
    custom_metric: finiteOrNull(e.custom_metric),
    set_type: typeof e.set_type === 'string' && HISTORY_SET_TYPE.test(e.set_type) ? e.set_type : null,
  }
}

async function handleExerciseHistory(hevyApiKey: string, payload: Record<string, unknown>) {
  const templateId = hevyTemplateId(payload.exercise_template_id)
  if (!templateId) throw new Error('payload.exercise_template_id is required for exercise_history')
  const query = new URLSearchParams()
  const start = isoParam(payload.start_date, 'start_date')
  const end = isoParam(payload.end_date, 'end_date')
  if (start) query.set('start_date', start)
  if (end) query.set('end_date', end)
  const qs = query.toString()
  const data = await hevyRequest('GET', `/v1/exercise_history/${encodeURIComponent(templateId)}${qs ? `?${qs}` : ''}`, hevyApiKey)
  // The spec answers { exercise_history: [...] }; a bare array is tolerated.
  const list: unknown[] = Array.isArray(data?.exercise_history) ? data.exercise_history : Array.isArray(data) ? data : []
  const sets = list.map((e) => cleanHistoryEntry(e, templateId)).filter((e) => e !== null)
  return { exercise_history: sets, skipped: list.length - sets.length }
}

// ---------------------------------------------------------------------------
// Create a custom exercise — POST /v1/exercise_templates, then GET it by id
// ---------------------------------------------------------------------------
// The enums are Hevy's OpenAPI (14.10.2026): CustomExerciseType,
// EquipmentCategory, MuscleGroup. A hand-mirrored copy of
// src/features/training/hevyEnums.ts — scripts/verify-hevy-api.cjs compares them.
const HEVY_EXERCISE_TYPES = ['weight_reps', 'reps_only', 'bodyweight_reps', 'bodyweight_assisted_reps', 'duration', 'weight_duration', 'distance_duration', 'short_distance_weight']
const HEVY_EQUIPMENT = ['none', 'barbell', 'dumbbell', 'kettlebell', 'machine', 'plate', 'resistance_band', 'suspension', 'other']
const HEVY_MUSCLE_GROUPS = ['abdominals', 'shoulders', 'biceps', 'triceps', 'forearms', 'quadriceps', 'hamstrings', 'calves', 'glutes', 'abductors', 'adductors', 'lats', 'upper_back', 'traps', 'lower_back', 'chest', 'cardio', 'neck', 'full_body', 'other']
const HEVY_TITLE_MAX = 100

function oneOf(v: unknown, list: string[], name: string): string {
  if (typeof v !== 'string' || !list.includes(v)) throw new Error(`payload.${name} must be one of Hevy's values`)
  return v
}

function hevyTitle(v: unknown): string {
  const title = typeof v === 'string' ? v.trim() : ''
  if (!title || title.length > HEVY_TITLE_MAX) throw new Error(`A title of 1–${HEVY_TITLE_MAX} characters is required`)
  return title
}

async function handleCreateExerciseTemplate(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  hevyApiKey: string,
  payload: Record<string, unknown>,
) {
  const title = hevyTitle(payload.title)
  const exerciseType = oneOf(payload.exercise_type, HEVY_EXERCISE_TYPES, 'exercise_type')
  const equipment = oneOf(payload.equipment_category, HEVY_EQUIPMENT, 'equipment_category')
  const muscle = oneOf(payload.muscle_group, HEVY_MUSCLE_GROUPS, 'muscle_group')
  const others = payload.other_muscles == null ? [] : payload.other_muscles
  if (!Array.isArray(others)) throw new Error('payload.other_muscles must be a list')
  const otherMuscles = [...new Set(others.map((m) => oneOf(m, HEVY_MUSCLE_GROUPS, 'other_muscles')))].filter((m) => m !== muscle)

  let data: any
  try {
    data = await hevyRequest('POST', '/v1/exercise_templates', hevyApiKey, {
      exercise: { title, exercise_type: exerciseType, equipment_category: equipment, muscle_group: muscle, other_muscles: otherMuscles },
    })
  } catch (err) {
    // 403 "exceeds-custom-exercise-limit" (the spec's only documented 403 here).
    if (err instanceof HevyApiError && err.status === 403) {
      throw new Error("Hevy won't take another custom exercise on this account (its custom exercise limit).")
    }
    throw err
  }
  // The spec answers { id } (an integer in its example); a wrapped template is tolerated.
  const id = hevyTemplateId(data?.id ?? data?.exercise_template?.id ?? data?.exercise_template_id)
  if (!id) return { template_id: null, stored: false }
  let template: HevyTemplateRow | null = null
  try {
    template = await fetchExerciseTemplateById(id, hevyApiKey)
  } catch (err) {
    console.warn(`hevy-api: new exercise ${id} not read back: ${(err as Error).message}`)
  }
  if (!template) return { template_id: id, stored: false }
  await upsertExerciseTemplatesToDb(supabase, userId, [template])
  return { template_id: id, stored: true }
}

// ---------------------------------------------------------------------------
// Create a routine folder — POST /v1/routine_folders, then GET it by id
// ---------------------------------------------------------------------------
// Hevy puts a new folder first ("created at index 0"). Its index is not
// stored: the app lists folders by title.

function cleanFolder(raw: any): { id: number; title: string } | null {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id
  if (!Number.isSafeInteger(id) || id <= 0 || typeof raw.title !== 'string' || !raw.title.trim()) return null
  return { id, title: raw.title }
}

async function handleCreateRoutineFolder(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  hevyApiKey: string,
  payload: Record<string, unknown>,
) {
  const title = hevyTitle(payload.title)
  const data = await hevyRequest('POST', '/v1/routine_folders', hevyApiKey, { routine_folder: { title } })
  const created = cleanFolder(unwrapEntity(data, 'routine_folder'))
  if (!created) return { folder_id: null, stored: false }
  let folder = created
  try {
    const back = await hevyRequest('GET', `/v1/routine_folders/${created.id}`, hevyApiKey)
    folder = cleanFolder(unwrapEntity(back, 'routine_folder')) ?? created
  } catch (err) {
    // The POST answer already is the folder; the read-back only confirms it.
    console.warn(`hevy-api: new folder ${created.id} not read back: ${(err as Error).message}`)
  }
  const { error } = await supabase.from('hevy_routine_folders').upsert(
    { id: folder.id, user_id: userId, title: folder.title, synced_at: new Date().toISOString() },
    { onConflict: 'id' },
  )
  if (error) throw error
  return { folder_id: folder.id, stored: true }
}

// ---------------------------------------------------------------------------
// Fetch missing workouts — every page of GET /v1/workouts (10 per page)
// ---------------------------------------------------------------------------
// For the Hevy card's count check (154): stores each workout Hevy lists that
// isn't here, then reads the count again. Nothing here is deleted: after a
// COMPLETE listing, the stored workouts Hevy no longer lists are returned
// (`not_in_hevy_workouts`) and the app offers to delete them, with Undo.

async function handleSyncMissingWorkouts(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  hevyApiKey: string,
) {
  const hevyIds = new Set<string>()
  const added: HevyWorkout[] = []
  const { complete } = await hevyListAll('/v1/workouts', 'workouts', 10, hevyApiKey, async (items) => {
    const workouts = items.filter((w: any) => typeof w?.id === 'string' && w.id) as HevyWorkout[]
    if (workouts.length === 0) return
    for (const w of workouts) hevyIds.add(w.id)
    const { data, error } = await supabase.from('hevy_workouts').select('id')
      .eq('user_id', userId).in('id', workouts.map((w) => w.id))
    if (error) throw error
    const have = new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id))
    for (const w of workouts) {
      if (have.has(w.id)) continue
      await upsertWorkoutToDb(supabase, userId, w)
      added.push(w)
    }
  })
  await ensureTemplatesQuietly(supabase, userId, added, hevyApiKey)
  const account = await refreshHevyAccount(supabase, userId, hevyApiKey)

  // Only a complete listing can say what Hevy doesn't have.
  type Stored = { id: string; title: string | null; start_time: string | null }
  let notInHevy: Stored[] | null = null
  if (complete) {
    notInHevy = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('hevy_workouts').select('id, title, start_time')
        .eq('user_id', userId).order('id').range(from, from + 999)
      if (error) throw error
      const rows = (data ?? []) as Stored[]
      notInHevy.push(...rows.filter((r) => !hevyIds.has(r.id)))
      if (rows.length < 1000) break
    }
  }
  return {
    added: added.length, complete,
    not_in_hevy: notInHevy ? notInHevy.length : null,
    not_in_hevy_workouts: notInHevy,
    hevy_workout_count: account.hevy_workout_count,
    account_error: account.error,
  }
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
      serviceKey(),
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
        case 'exercise_history':
          result = await handleExerciseHistory(hevyApiKey, payload)
          break
        case 'create_exercise_template':
          result = await handleCreateExerciseTemplate(supabase, user.id, hevyApiKey, payload)
          break
        case 'create_routine_folder':
          result = await handleCreateRoutineFolder(supabase, user.id, hevyApiKey, payload)
          break
        case 'sync_missing_workouts':
          result = await handleSyncMissingWorkouts(supabase, user.id, hevyApiKey)
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
