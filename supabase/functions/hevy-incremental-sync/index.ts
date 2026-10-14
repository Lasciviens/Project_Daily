// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.107.0'

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

const hevyApiKey = Deno.env.get('HEVY_API_KEY')

async function hevyGet(path: string) {
  const res = await fetch(`https://api.hevyapp.com${path}`, {
    headers: { 'api-key': hevyApiKey! },
  })
  if (!res.ok) throw new Error(`Hevy API ${res.status}: ${path}`)
  return res.json()
}

// Routines, routine folders, body measurements and the exercise library have
// NO event feed on Hevy, so the workout-events delta above never picks up a
// routine or a custom exercise you created in the Hevy app. These are small
// collections — on each Sync we re-fetch them all and upsert, so "Sync" keeps
// everything current without a full re-import. Folders and the library page
// through the shared block's helpers (syncAllRoutineFolders reads every page;
// it used to read only the first, at most 10 folders).
// deno-lint-ignore no-explicit-any
async function refreshRoutines(supabase: any, userId: string): Promise<number> {
  let page = 1
  let total = 0
  const seenIds = new Set<string>()
  // Pruning below deletes every local routine Hevy didn't return, so it may
  // only run after a COMPLETE listing: every page up to page_count read, in
  // the documented shape. An odd response (no `routines` array, an empty page
  // before the last one) keeps the local rows instead of wiping them.
  let complete = false
  while (true) {
    const data = await hevyGet(`/v1/routines?page=${page}&pageSize=10`)
    // page_count missing → read on until an empty page.
    const pageCount = data?.page_count != null && Number.isFinite(Number(data.page_count)) ? Number(data.page_count) : null
    if (!Array.isArray(data?.routines)) break
    // deno-lint-ignore no-explicit-any
    const routines: any[] = data.routines
    if (routines.length === 0) { complete = pageCount == null || page >= pageCount; break }
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
    if (pageCount != null && page >= pageCount) { complete = true; break }
    if (page >= 500) break // runaway guard; incomplete → no pruning
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
  // here after a genuinely successful full fetch, never a transient failure
  // (and only when the listing was complete — see `complete` above).
  // Hevy's public API has no routine DELETE, so this is also how a routine
  // deleted in the Hevy app leaves the web app: the Routines tab says so.
  if (!complete) return total
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
        // Hevy's OpenAPI names these seven without "_cm" (BodyMeasurement:
        // abdomen, waist, hips, left_thigh …); either name is read.
        abdomen_cm: m.abdomen ?? m.abdomen_cm ?? null, waist_cm: m.waist ?? m.waist_cm ?? null, hips_cm: m.hips ?? m.hips_cm ?? null,
        left_thigh_cm: m.left_thigh ?? m.left_thigh_cm ?? null, right_thigh_cm: m.right_thigh ?? m.right_thigh_cm ?? null,
        left_calf_cm: m.left_calf ?? m.left_calf_cm ?? null, right_calf_cm: m.right_calf ?? m.right_calf_cm ?? null,
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
    // The next cursor is the moment BEFORE the events are read: an edit made
    // in Hevy while this sync runs is read again next time (the upserts are
    // idempotent) instead of falling between the read and a later "now".
    const syncStartedAt = new Date().toISOString()

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
    // Dedupe updates by workout id, keeping the NEWEST version: Hevy lists
    // events "from newest to oldest" (its OpenAPI), so the first one seen
    // wins unless a later one carries a newer updated_at. (Overwriting on
    // every event used to keep the OLDEST edit of a workout edited twice
    // between syncs.)
    const toDeleteSet = new Set<string>()
    const toUpdate = new Map<string, HevyWorkout>()
    const time = (w: HevyWorkout) => { const t = Date.parse(w?.updated_at ?? ''); return Number.isNaN(t) ? -Infinity : t }

    for (const event of allEvents) {
      if (event.type === 'deleted') {
        if (event.id) toDeleteSet.add(event.id)
      } else if (event.type === 'updated' && event.workout?.id) {
        const seen = toUpdate.get(event.workout.id)
        if (!seen || time(event.workout) > time(seen)) toUpdate.set(event.workout.id, event.workout)
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
    // body measurements and exercises (new custom ones, Hevy's pictures)
    // created or edited in the Hevy app show up on Sync (no more needing
    // "Import all" for a new routine).
    let routinesSynced = 0
    try {
      await syncAllRoutineFolders(supabase, user.id, hevyApiKey!)
      routinesSynced = await refreshRoutines(supabase, user.id)
      await refreshBodyMeasurements(supabase, user.id)
    } catch (err) {
      return new Response(
        JSON.stringify({ error: `refresh routines/body failed: ${(err as Error).message}` }),
        { status: 502, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    // Step 4c: The exercise library (new custom exercises, Hevy's pictures),
    // on its own: it never fails the Sync — `exercise_templates: null` tells
    // the app it wasn't read this time (the next Sync tries again).
    let templatesSynced: number | null = null
    try {
      templatesSynced = await syncAllExerciseTemplates(supabase, user.id, hevyApiKey!)
    } catch (err) {
      console.warn(`hevy-incremental-sync: exercise library not read: ${(err as Error).message}`)
    }

    // Step 4d: An updated workout naming an exercise the library doesn't
    // have gets it by id (the workouts are stored already, so a failure here
    // doesn't fail the Sync; `templates_added: null` says it wasn't checked).
    let templatesAdded: number | null = null
    try {
      const updated = [...toUpdate].filter(([id]) => !toDeleteSet.has(id)).map(([, w]) => w)
      templatesAdded = await ensureExerciseTemplates(supabase, user.id, updated, hevyApiKey!)
    } catch (err) {
      console.warn(`hevy-incremental-sync: exercise templates not checked: ${(err as Error).message}`)
    }

    // Step 5: Advance the cursor to when this sync started reading
    const { error: cursorError } = await supabase
      .from('hevy_workout_events_cursor')
      .upsert(
        {
          user_id: user.id,
          last_events_since: syncStartedAt,
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

    // Step 6: The account — user info and Hevy's workout count, compared on
    // the Hevy card with the workouts stored here (154). Never fails the Sync.
    const account = await refreshHevyAccount(supabase, user.id, hevyApiKey!)

    return new Response(
      JSON.stringify({
        updated: updatedCount, deleted: toDeleteSet.size, routines: routinesSynced,
        exercise_templates: templatesSynced, templates_added: templatesAdded,
        account_checked: account.ok, account_error: account.error, hevy_workout_count: account.hevy_workout_count,
      }),
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
