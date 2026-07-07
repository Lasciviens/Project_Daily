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

// All points (any source) for one metric within a date range — used by chart
// sections (rings, steps, energy, heart, sleep, body) to build daily/hourly
// series. Ordered ascending so callers can group-by-day without re-sorting.
export async function fetchHealthMetricSeries(
  metricName: string,
  fromDate: string,
  toDate: string,
): Promise<HealthMetric[]> {
  const { data, error } = await supabase
    .from('health_metrics')
    .select('*')
    .eq('metric_name', metricName)
    .gte('date', fromDate)
    .lte('date', toDate)
    .order('recorded_at', { ascending: true })

  if (error) throw error
  return data ?? []
}
