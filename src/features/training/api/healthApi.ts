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

export async function fetchHealthMetrics(
  metricName: string,
  opts: { from?: string; to?: string; limit?: number } = {},
): Promise<HealthMetric[]> {
  const { from, to, limit = 30 } = opts

  let query = supabase
    .from('health_metrics')
    .select('*')
    .eq('metric_name', metricName)
    .order('date', { ascending: false })
    .limit(limit)

  if (from) query = query.gte('date', from)
  if (to)   query = query.lte('date', to)

  const { data, error } = await query
  if (error) throw error
  return data ?? []
}
