import { supabase } from '../../../integrations/supabase/client'

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
export async function fetchHealthMetricSeries(
  metricName: string,
  fromDate: string,
  toDate: string,
): Promise<HealthMetric[]> {
  const all: HealthMetric[] = []
  let offset = 0

  for (;;) {
    const { data, error } = await supabase
      .from('health_metrics')
      .select('*')
      .eq('metric_name', metricName)
      .gte('date', fromDate)
      .lte('date', toDate)
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
