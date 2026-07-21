import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'

export interface HealthWorkout {
  id:               string
  user_id:          string
  name:             string
  start_time:       string | null
  end_time:         string | null
  duration_seconds: number | null
  active_energy_kj: number | null
  total_energy_kj:  number | null
  avg_heart_rate:   number | null
  min_heart_rate:   number | null
  max_heart_rate:   number | null
  // deno-lint-ignore no-explicit-any
  raw:              Record<string, any>
  synced_at:        string
}

export interface HealthMetric {
  id:          string
  user_id:     string
  metric_name: string
  date:        string
  recorded_at: string
  unit:        string | null
  source:      string
  // Which device/source stream this row belongs to. Optional here because rows
  // fetched before migration 062 is applied won't have the column — the
  // aggregation layer treats a missing family as 'apple' (every legacy row is
  // Apple). 'fitbit' rows arrive from the Google Health poller (Phase 3).
  source_family?: 'apple' | 'fitbit' | 'manual'
  // deno-lint-ignore no-explicit-any
  value:       Record<string, any>
  synced_at:   string
}

export async function fetchHealthWorkouts(opts: {
  limit?: number
  offset?: number
} = {}): Promise<HealthWorkout[]> {
  const { limit = 20, offset = 0 } = opts

  const { data, error } = await supabase
    .from('health_workouts')
    .select('*')
    .order('start_time', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) throw error
  return data ?? []
}

// No server-side source filtering — this is a personal, single-user dataset,
// so a bounded fetch + client-side filtering in the table UI is simpler than
// adding query params for every facet. Point-in-time grain means far more
// rows per day than before (one per incoming sample, not one per day), so the
// default limit is generous but still bounded.
export async function fetchHealthMetrics(opts: { limit?: number } = {}): Promise<HealthMetric[]> {
  const { limit = 5000 } = opts

  const { data, error } = await supabase
    .from('health_metrics')
    .select('*')
    .order('recorded_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data ?? []
}

// Supabase/PostgREST caps every response at this many rows server-side
// (confirmed: an explicit Range header asking for more still comes back
// capped) — a client-side .limit() alone can't ask for more than this.
const MAX_ROWS_PER_PAGE = 1000

// All points (any source) for one metric within a date range — used by chart
// sections (rings, steps, energy, heart, sleep, body) to build daily/hourly
// series. Ordered ascending so callers can group-by-day without re-sorting.
//
// Paginates past the server's row cap (real bug, fixed): high-frequency
// metrics like active_energy/heart_rate arrive roughly once a minute from
// Apple Watch, so a week (let alone a month) can easily exceed 1000 rows.
// With no pagination, ascending order + the silent cap meant the response
// was truncated to the OLDEST rows in range — the most recent days (today,
// yesterday) fell off the end entirely. This showed up as "Day view has
// data, Week view doesn't" (a single day rarely hits the cap; a week/month
// range routinely does).
// `sourceFamily` (optional): restrict to one source stream ('apple' | 'fitbit').
// Omitted → every source (today's behavior, unchanged). This is inert
// scaffolding for the Phase 4 source switch — no caller passes it yet. When it
// IS passed, migration 062 (which adds the source_family column) must already
// be applied, or the .eq() errors with 42703; that ordering is guaranteed
// because the Phase 4 UI ships after 062.
export async function fetchHealthMetricSeries(
  metricName: string,
  fromDate: string,
  toDate: string,
  sourceFamily?: 'apple' | 'fitbit',
): Promise<HealthMetric[]> {
  const all: HealthMetric[] = []
  let offset = 0

  for (;;) {
    let query = supabase
      .from('health_metrics')
      .select('*')
      .eq('metric_name', metricName)
      .gte('date', fromDate)
      .lte('date', toDate)
    if (sourceFamily) query = query.eq('source_family', sourceFamily)

    const { data, error } = await query
      .order('recorded_at', { ascending: true })
      .range(offset, offset + MAX_ROWS_PER_PAGE - 1)

    if (error) throw error
    const page = data ?? []
    all.push(...page)
    if (page.length < MAX_ROWS_PER_PAGE) break
    offset += MAX_ROWS_PER_PAGE
  }

  return all
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
// "Asleep" bucket, so the stage breakdown still looks like a real night
// instead of reading as unknown/empty.
//
// Upsert, not insert: `recorded_at` is deterministic per (date, stage) —
// baseMs only depends on `input.date` — so re-submitting a correction for a
// night that already has a manual entry lands on the exact same 3 rows and
// overwrites them, rather than colliding with the unique index (a plain
// insert would 409 on the second submission for the same night). Apple's
// own rows for that date have a different `source` and different real
// `recorded_at` timestamps, so they're never touched by this — a manual
// correction can never clobber synced Watch data, only other manual rows.
export async function upsertManualSleepEntry(input: ManualSleepInput): Promise<void> {
  const user = await requireUser()
  const split = input.stageProportions ?? DEFAULT_STAGE_SPLIT
  const baseMs = new Date(`${input.date}T08:00:00`).getTime()

  const rows = (['Deep', 'Core', 'REM'] as const).map((stage, i) => ({
    user_id:     user.id,
    metric_name: 'sleep_analysis',
    date:        input.date,
    // Staggered by a second each so the (user_id, metric_name, recorded_at,
    // source) unique index doesn't collide across the 3 stage rows.
    recorded_at: new Date(baseMs + i * 1000).toISOString(),
    unit:        'hr',
    source:      'manual',
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
