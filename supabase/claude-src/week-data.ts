// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · reading the week (weekly report, phase 3)
//
//  The database reads behind week-facts.ts, with the service-role client: that client has no row level security, so
//  every read of a table that holds the owner's rows names the user id in the query itself (the id main.ts verified
//  or took from its own environment, never one from a request). The rows come back as they are and week-facts.ts
//  turns them into figures. A section whose read fails is reported as unreadable, never as empty: the report then
//  says so, and the other sections still go ahead.
// ─────────────────────────────────────────────────────────────────────────────

import type { Db } from './ledger.ts'
import {
  foodFacts, healthFacts, osloMidnight, shiftDay, taskFacts, trainingFacts,
  type FoodRows, type HealthRows, type TaskRows, type TrainingRows, type WeekFacts, type WeekRange,
} from './week-facts.ts'

type DataRow = Record<string, unknown>
type QueryAnswer = { data: unknown; error: { code?: string } | null }

// PostgREST answers at most 1000 rows a request.
const PAGE = 1000
// The most pages one read takes: a week of minute-by-minute rows is a few thousand, so this is a wall, not a limit
// anyone should meet. A read that hits it says so (`truncated`) and the report carries the note.
const MAX_PAGES = 25
// A list in `in (…)` stays short enough for a request address.
const IN_CHUNK = 100

/** Reads a query page by page. `truncated` is true when the page limit stopped it. */
async function allRows(page: (from: number, to: number) => PromiseLike<QueryAnswer>): Promise<{ rows: DataRow[]; truncated: boolean }> {
  const rows: DataRow[] = []
  for (let i = 0; i < MAX_PAGES; i++) {
    const { data, error } = await page(i * PAGE, i * PAGE + PAGE - 1)
    if (error) throw new Error(`read failed ${error.code ?? ''}`.trim())
    const got = Array.isArray(data) ? (data as DataRow[]) : []
    rows.push(...got)
    if (got.length < PAGE) return { rows, truncated: false }
  }
  return { rows, truncated: true }
}

async function byIds(ids: string[], page: (part: string[], from: number, to: number) => PromiseLike<QueryAnswer>): Promise<DataRow[]> {
  const out: DataRow[] = []
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const part = ids.slice(i, i + IN_CHUNK)
    out.push(...(await allRows((from, to) => page(part, from, to))).rows)
  }
  return out
}

const unique = (xs: unknown[]) => [...new Set(xs.filter((x): x is string => typeof x === 'string' && x !== ''))]

async function readTraining(db: Db, userId: string, week: WeekRange): Promise<TrainingRows> {
  const fromAt = osloMidnight(shiftDay(week.start, -28)).toISOString()
  const { rows: workouts } = await allRows((from, to) => db.from('hevy_workouts')
    .select('id, title, start_time, hevy_created_at').eq('user_id', userId).gte('start_time', fromAt).lt('start_time', week.endAt).order('id').range(from, to))
  if (!workouts.length) return { workouts, exercises: [], sets: [], templates: [], secondaries: [] }
  const exercises = await byIds(unique(workouts.map(w => w.id)), (part, from, to) => db.from('hevy_workout_exercises')
    .select('id, hevy_workout_id, exercise_template_id').in('hevy_workout_id', part).order('id').range(from, to))
  const sets = await byIds(unique(exercises.map(e => e.id)), (part, from, to) => db.from('hevy_sets')
    .select('id, hevy_exercise_id, type, weight_kg, reps').in('hevy_exercise_id', part).order('id').range(from, to))
  const templateIds = unique(exercises.map(e => e.exercise_template_id))
  const templates = await byIds(templateIds, (part, from, to) => db.from('hevy_exercise_templates')
    .select('id, title, primary_muscle_group').in('id', part).order('id').range(from, to))
  const secondaries = await byIds(templateIds, (part, from, to) => db.from('hevy_exercise_template_muscles')
    .select('id, exercise_template_id, muscle_group').in('exercise_template_id', part).order('id').range(from, to))
  return { workouts, exercises, sets, templates, secondaries }
}

async function readHealth(db: Db, userId: string, week: WeekRange): Promise<HealthRows> {
  const from = shiftDay(week.prevStart, -2)
  const sleep = await allRows((a, b) => db.from('health_metrics').select('value, date, source, recorded_at')
    .eq('user_id', userId).eq('metric_name', 'sleep_analysis').gte('date', from).lte('date', week.end)
    .order('recorded_at', { ascending: true }).order('id', { ascending: true }).range(a, b))
  const metrics = await allRows((a, b) => db.from('health_metrics').select('metric_name, date, unit, value, recorded_at, source')
    .eq('user_id', userId).in('metric_name', ['step_count', 'active_energy', 'resting_heart_rate']).gte('date', week.prevStart).lte('date', week.end)
    .order('recorded_at', { ascending: true }).order('id', { ascending: true }).range(a, b))
  const weights: HealthRows['weights'] = []
  const wFrom = shiftDay(week.prevStart, -21)
  // Three sources hold a weight: Hevy's body measurements, the scale's report, and Apple Health. A source that is
  // not there (a missing table, an older schema) simply adds nothing.
  const soft = async (read: () => PromiseLike<QueryAnswer>): Promise<DataRow[]> => {
    try {
      const { data, error } = await read()
      return error || !Array.isArray(data) ? [] : (data as DataRow[])
    } catch { return [] }
  }
  for (const r of await soft(() => db.from('hevy_body_measurements').select('date, weight_kg, updated_at').eq('user_id', userId).gte('date', wFrom).lte('date', week.end).not('weight_kg', 'is', null).limit(PAGE))) {
    weights.push({ at: typeof r.updated_at === 'string' ? r.updated_at : `${String(r.date)}T12:00:00Z`, kg: Number(r.weight_kg) })
  }
  for (const r of await soft(() => db.from('body_composition_reports').select('measured_at, weight_kg').eq('user_id', userId).gte('measured_at', osloMidnight(wFrom).toISOString()).lt('measured_at', week.endAt).limit(PAGE))) {
    weights.push({ at: String(r.measured_at), kg: Number(r.weight_kg) })
  }
  for (const r of await soft(() => db.from('health_metrics').select('recorded_at, unit, value').eq('user_id', userId).eq('metric_name', 'weight_body_mass').gte('date', wFrom).lte('date', week.end).limit(PAGE))) {
    const qty = (r.value as DataRow | null)?.qty
    if (typeof qty !== 'number') continue
    const unit = String(r.unit ?? '').toLowerCase()
    weights.push({ at: String(r.recorded_at), kg: unit.startsWith('lb') ? qty * 0.45359237 : unit === 'g' ? qty / 1000 : qty })
  }
  return { sleep: sleep.rows, metrics: metrics.rows, weights, truncated: sleep.truncated || metrics.truncated }
}

async function readFood(db: Db, userId: string, week: WeekRange): Promise<FoodRows> {
  const read = (cols: string) => db.from('food_log_entries').select(cols).eq('user_id', userId).gte('date', week.start).lte('date', week.end).eq('status', 'eaten').limit(PAGE)
  let first: QueryAnswer = await read('date, calories, protein_g')
  // Before the `status` column (an older schema) every entry counts as eaten.
  if (first.error?.code === '42703') first = await db.from('food_log_entries').select('date, calories, protein_g').eq('user_id', userId).gte('date', week.start).lte('date', week.end).limit(PAGE)
  if (first.error) throw new Error('read failed food')
  const water = await db.from('water_log_entries').select('date, amount_ml').eq('user_id', userId).gte('date', week.start).lte('date', week.end).limit(PAGE)
  const targets = await db.from('day_targets').select('calories, protein_g, water_ml').eq('user_id', userId).maybeSingle()
  return {
    entries: Array.isArray(first.data) ? (first.data as DataRow[]) : [],
    water: !water.error && Array.isArray(water.data) ? (water.data as DataRow[]) : [],
    targets: !targets.error && targets.data && typeof targets.data === 'object' ? (targets.data as DataRow) : null,
  }
}

async function readTasks(db: Db, userId: string, week: WeekRange): Promise<TaskRows> {
  const done = await allRows((a, b) => db.from('tasks').select('title, status, domain, completed_at')
    .eq('user_id', userId).eq('status', 'done').gte('completed_at', week.startAt).lt('completed_at', week.endAt).order('id').range(a, b))
  const open = await allRows((a, b) => db.from('tasks').select('title, status, due_date')
    .eq('user_id', userId).not('status', 'in', '(done,cancelled)').not('due_date', 'is', null).lte('due_date', week.end).order('id').range(a, b))
  const created = await db.from('tasks').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', week.startAt).lt('created_at', week.endAt)
  const blocksRead = (cols: string) => allRows((a, b) => db.from('time_blocks').select(cols)
    .eq('user_id', userId).gte('date', week.start).lte('date', week.end).order('id').range(a, b))
  let blocks: DataRow[]
  try {
    blocks = (await blocksRead('date, category, duration_minutes, busy, task:tasks(status)')).rows
  } catch {
    // Before the `busy` column (migration 155): every block counts as busy.
    blocks = (await blocksRead('date, category, duration_minutes, task:tasks(status)')).rows
  }
  return { done: done.rows, open: open.rows, created: created.error || typeof created.count !== 'number' ? null : created.count, blocks }
}

/**
 * The week's figures: four sections, each read and worked out on its own. A section that cannot be read is named in
 * `unreadable` (its figures are null); the others carry on.
 */
export async function readWeekFacts(db: Db, userId: string, week: WeekRange, partial: boolean): Promise<WeekFacts> {
  const unreadable: string[] = []
  const section = async <T>(name: string, run: () => Promise<T>): Promise<T | null> => {
    try { return await run() } catch { unreadable.push(name); return null }
  }
  const [training, health, food, tasks] = await Promise.all([
    section('training', async () => trainingFacts(await readTraining(db, userId, week), week)),
    section('health', async () => healthFacts(await readHealth(db, userId, week), week)),
    section('food', async () => foodFacts(await readFood(db, userId, week), week)),
    section('tasks', async () => taskFacts(await readTasks(db, userId, week), week)),
  ])
  return { week_start: week.start, week_end: week.end, partial, training, health, food, tasks, unreadable: unreadable.sort() }
}
