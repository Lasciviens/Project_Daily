import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'

/** A workout row without `raw` — what the list needs. */
export interface HealthWorkoutSummary {
  id:               string
  name:             string
  start_time:       string | null
  end_time:         string | null
  duration_seconds: number | null
  active_energy_kj: number | null
  total_energy_kj:  number | null
  avg_heart_rate:   number | null
  min_heart_rate:   number | null
  max_heart_rate:   number | null
}

export interface HealthWorkout extends HealthWorkoutSummary {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- free-form HAE jsonb, read defensively
  raw:              Record<string, any>
}

export interface HealthMetric {
  id:          string
  metric_name: string
  date:        string
  recorded_at: string
  unit:        string | null
  source:      string
  // Not selected by the chart reads (see METRIC_COLUMNS); kept optional so
  // fixtures and older callers still type-check.
  user_id?:    string
  source_family?: 'apple' | 'manual'
  synced_at?:  string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- free-form HAE jsonb, read defensively
  value:       Record<string, any>
}

// Only what the aggregation reads. `select('*')` also pulled user_id,
// synced_at and source_family on every one of tens of thousands of rows.
const METRIC_COLUMNS = 'id,metric_name,date,recorded_at,unit,source,value'
const WORKOUT_SUMMARY_COLUMNS = 'id,name,start_time,end_time,duration_seconds,active_energy_kj,total_energy_kj,avg_heart_rate,min_heart_rate,max_heart_rate'

// Supabase/PostgREST caps every response at this many rows server-side
// (confirmed: an explicit Range header asking for more still comes back
// capped) — a client-side .limit() alone can't ask for more than this.
const MAX_ROWS_PER_PAGE = 1000

// Every page past the first is requested at once: the first page returns the
// exact row count, so the remaining ranges are known up front. A month of
// minute-grain heart rate (~43k rows) used to be ~44 sequential requests.
//
// Pages are ordered by (recorded_at, id). recorded_at alone is not unique —
// the documented re-delivery pattern puts the same hour under two source
// strings — and Postgres gives no stable order inside a tie across separate
// LIMIT/OFFSET requests, so a tie straddling a page boundary could return one
// row twice and skip another (H-09). `id` makes the order total.
type PageQuery = (from: number, to: number, withCount: boolean) => PromiseLike<{
  data: unknown[] | null
  error: unknown
  count?: number | null
}>

async function fetchAllPages<T>(page: PageQuery): Promise<T[]> {
  const first = await page(0, MAX_ROWS_PER_PAGE - 1, true)
  if (first.error) throw first.error
  const rows = (first.data ?? []) as T[]
  if (rows.length < MAX_ROWS_PER_PAGE) return rows
  if (first.count == null) {
    // No count came back: page sequentially rather than stop at 1000 rows.
    for (let o = MAX_ROWS_PER_PAGE; ; o += MAX_ROWS_PER_PAGE) {
      const r = await page(o, o + MAX_ROWS_PER_PAGE - 1, false)
      if (r.error) throw r.error
      const chunk = (r.data ?? []) as T[]
      rows.push(...chunk)
      if (chunk.length < MAX_ROWS_PER_PAGE) return rows
    }
  }
  const total = first.count
  if (total <= rows.length) return rows
  const offsets: number[] = []
  for (let o = MAX_ROWS_PER_PAGE; o < total; o += MAX_ROWS_PER_PAGE) offsets.push(o)
  const rest = await Promise.all(offsets.map(o => page(o, o + MAX_ROWS_PER_PAGE - 1, false)))
  for (const r of rest) {
    if (r.error) throw r.error
    rows.push(...((r.data ?? []) as T[]))
  }
  return rows
}

// All points (any source) for one metric within a date range — the input of
// every daily/hourly series. Ordered ascending so callers can group by day
// without re-sorting.
//
// Paginates past the server's row cap (real bug, fixed): high-frequency
// metrics like active_energy/heart_rate arrive roughly once a minute from
// Apple Watch, so a week (let alone a month) can easily exceed 1000 rows.
// Without pagination, ascending order + the silent cap cut off the most
// recent days ("Day view has data, Week view doesn't").
export async function fetchHealthMetricSeries(
  metricName: string,
  fromDate: string,
  toDate: string,
): Promise<HealthMetric[]> {
  return fetchAllPages<HealthMetric>((from, to, withCount) =>
    supabase
      .from('health_metrics')
      .select(METRIC_COLUMNS, withCount ? { count: 'exact' } : undefined)
      .eq('metric_name', metricName)
      .gte('date', fromDate)
      .lte('date', toDate)
      .order('recorded_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to))
}

/** Several metrics in one request — the mini-card grids used to fire one
 *  paginated query per card (~21 for the Steps view). Grouped by metric. */
export async function fetchHealthMetricsBatch(
  metricNames: readonly string[],
  fromDate: string,
  toDate: string,
): Promise<Record<string, HealthMetric[]>> {
  const out: Record<string, HealthMetric[]> = {}
  for (const m of metricNames) out[m] = []
  if (!metricNames.length) return out
  const rows = await fetchAllPages<HealthMetric>((from, to, withCount) =>
    supabase
      .from('health_metrics')
      .select(METRIC_COLUMNS, withCount ? { count: 'exact' } : undefined)
      .in('metric_name', [...metricNames])
      .gte('date', fromDate)
      .lte('date', toDate)
      .order('recorded_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to))
  for (const r of rows) (out[r.metric_name] ??= []).push(r)
  return out
}

export interface LatestHealthValue { value: number; date: string; recordedAt: string; unit: string | null }

const KJ_PER_KCAL = 4.184
function numericQty(row: HealthMetric): number | null {
  const q = row.value?.qty
  if (typeof q !== 'number' || !Number.isFinite(q)) return null
  const energy = row.metric_name === 'active_energy' || row.metric_name === 'basal_energy_burned'
  return energy && row.unit?.toLowerCase().includes('kj') ? q / KJ_PER_KCAL : q
}

/** The newest reading EVER of a point-in-time metric (VO2 max, 6-minute walk,
 *  resting HR…), on or before `onOrBefore` when given. A window-bound read
 *  showed "—" on most days because Apple writes VO2 max only after qualifying
 *  outdoor walks/runs (H-04). Reads a few rows so a stray non-numeric row
 *  can't hide the real one. */
export async function fetchLatestHealthValue(metricName: string, onOrBefore?: string): Promise<LatestHealthValue | null> {
  let q = supabase
    .from('health_metrics')
    .select(METRIC_COLUMNS)
    .eq('metric_name', metricName)
  if (onOrBefore) q = q.lte('date', onOrBefore)
  const { data, error } = await q
    .order('recorded_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(5)
  if (error) throw error
  for (const row of (data ?? []) as HealthMetric[]) {
    const value = numericQty(row)
    if (value != null) return { value, date: row.date, recordedAt: row.recorded_at, unit: row.unit }
  }
  return null
}

export async function fetchLatestHealthValues(
  metricNames: readonly string[],
  onOrBefore?: string,
): Promise<Record<string, LatestHealthValue | null>> {
  const entries = await Promise.all(metricNames.map(async m => [m, await fetchLatestHealthValue(m, onOrBefore)] as const))
  return Object.fromEntries(entries)
}

// Local midnight of a 'yyyy-MM-dd' day as an instant — start_time is a
// timestamptz, so a date window has to become a real instant range.
function localMidnightIso(date: string, addDays = 0): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d + addDays).toISOString()
}

/** Workouts that started inside [from, to] (local days), newest first, without
 *  the `raw` payload — the list used to download every HR curve and GPS route
 *  even while collapsed (H-07). */
export async function fetchHealthWorkoutSummaries(fromDate: string, toDate: string): Promise<HealthWorkoutSummary[]> {
  const { data, error } = await supabase
    .from('health_workouts')
    .select(WORKOUT_SUMMARY_COLUMNS)
    .gte('start_time', localMidnightIso(fromDate))
    .lt('start_time', localMidnightIso(toDate, 1))
    .order('start_time', { ascending: false })
    .limit(200)
  if (error) throw error
  return (data ?? []) as HealthWorkoutSummary[]
}

/** One workout with `raw`, read only when its detail opens. */
export async function fetchHealthWorkout(id: string): Promise<HealthWorkout | null> {
  const { data, error } = await supabase
    .from('health_workouts')
    .select(`${WORKOUT_SUMMARY_COLUMNS},raw`)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as HealthWorkout | null) ?? null
}

export interface ManualSleepInput {
  date:             string // the night this sleep is attributed to
  totalHours:       number
  stageProportions: { deep: number; core: number; rem: number } | null // null → use DEFAULT_STAGE_SPLIT
}

// Typical adult sleep-stage split (Apple's own published averages) — used
// only when there's no real Watch-tracked history yet to estimate from.
const DEFAULT_STAGE_SPLIT = { deep: 0.15, core: 0.60, rem: 0.25 }

// Logs (or corrects) a night as source: 'manual', as separate Deep/Core/REM
// rows — matching the same raw per-segment shape real Watch data arrives
// in, so every existing aggregation/render path (stage bar, totals, trend
// chart) handles it identically without special-casing. Stage hours are
// the entered total split by `stageProportions` (the user's own historical
// average, computed by the caller) rather than one undifferentiated
// "Asleep" bucket.
//
// Upsert, not insert: `recorded_at` is deterministic per (date, stage), so
// re-submitting a correction for a night lands on the exact same 3 rows and
// overwrites them. Apple's own rows for that date have a different `source`
// and different real `recorded_at` timestamps, so they're never touched.
//
// source_family: 'manual' is written explicitly — the column defaults to
// 'apple', so every manual correction used to be labelled Apple (H-19).
export async function upsertManualSleepEntry(input: ManualSleepInput): Promise<void> {
  const user = await requireUser()
  const split = input.stageProportions ?? DEFAULT_STAGE_SPLIT
  const baseMs = new Date(`${input.date}T08:00:00`).getTime()

  const rows = (['Deep', 'Core', 'REM'] as const).map((stage, i) => ({
    user_id:       user.id,
    metric_name:   'sleep_analysis',
    date:          input.date,
    // Staggered by a second each so the (user_id, metric_name, recorded_at,
    // source) unique index doesn't collide across the 3 stage rows.
    recorded_at:   new Date(baseMs + i * 1000).toISOString(),
    unit:          'hr',
    source:        'manual',
    source_family: 'manual',
    value: {
      value:  stage,
      qty:    input.totalHours * (stage === 'Deep' ? split.deep : stage === 'Core' ? split.core : split.rem),
      source: 'manual',
    },
  }))

  const { error } = await supabase
    .from('health_metrics')
    .upsert(rows, { onConflict: 'user_id,metric_name,recorded_at,source' })
  if (error) throw error
}
