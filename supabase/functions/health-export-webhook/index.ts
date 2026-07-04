import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const jsonHeaders = { 'Content-Type': 'application/json' }

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>

interface HealthWorkout {
  id: string
  name: string
  start?: string
  end?: string
  duration?: number
  activeEnergyBurned?: { qty: number; units: string }
  totalEnergy?: { qty: number; units: string }
  heartRate?: { avg?: number; min?: number; max?: number }
  // deno-lint-ignore no-explicit-any
  [key: string]: any
}

interface HealthMetricPoint {
  date: string
  source?: string
  // deno-lint-ignore no-explicit-any
  [key: string]: any
}

interface HealthMetricGroup {
  name: string
  units?: string
  data: HealthMetricPoint[]
}

// Parses a Health Auto Export date string ("yyyy-MM-dd HH:mm:ss Z") without
// throwing on malformed input — one bad date shouldn't crash the whole batch.
function safeIso(s: string | undefined): string | null {
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 })
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  // Verify webhook secret — Health Auto Export can't send a Supabase user JWT,
  // so this function must have "Enforce JWT Verification" disabled in the
  // dashboard, and auth is this shared secret instead (same pattern as hevy-sync).
  const secret = Deno.env.get('HEALTH_EXPORT_WEBHOOK_SECRET')
  const authHeader = req.headers.get('authorization') ?? ''
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Single-user app — same person as the Hevy integration, reuse its user id.
  const userId = Deno.env.get('HEVY_USER_ID')
  if (!userId) {
    return new Response(
      JSON.stringify({ error: 'HEVY_USER_ID not configured' }),
      { status: 500, headers: jsonHeaders }
    )
  }

  let workouts: HealthWorkout[] = []
  let metrics: HealthMetricGroup[] = []
  try {
    const body = await req.json()
    const data = body?.data ?? {}
    workouts = Array.isArray(data.workouts) ? data.workouts : []
    metrics  = Array.isArray(data.metrics)  ? data.metrics  : []
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Bad request: ${(err as Error).message}` }),
      { status: 400, headers: jsonHeaders }
    )
  }

  const now = new Date().toISOString()

  // Upsert workouts — comparable shape to hevy_workouts (id is the export's
  // own workout UUID, a stable natural key for idempotent re-delivery).
  // Health Auto Export's legacy "Export Version 1" workout format has no `id`
  // field at all (only v2, which this integration expects, does). Rather than
  // dropping those rows, fall back to a deterministic key built from
  // name+start+end — still idempotent across re-deliveries, just not a real
  // UUID. Only truly skip a workout that has neither an id nor enough fields
  // to build that fallback (nothing to key it on).
  let skippedWorkouts = 0
  if (workouts.length > 0) {
    const rows = workouts
      .map((w: HealthWorkout) => ({
        ...w,
        __id: w.id || (w.name && (w.start || w.end) ? `synthetic:${w.name}:${w.start ?? ''}:${w.end ?? ''}` : null),
      }))
      .filter((w) => {
        const ok = !!w.__id
        if (!ok) skippedWorkouts++
        return ok
      })
      .map(({ __id, ...w }: HealthWorkout & { __id: string }) => ({
        id: __id,
        user_id: userId,
        name: w.name,
        start_time: safeIso(w.start),
        end_time: safeIso(w.end),
        duration_seconds: w.duration ?? null,
        active_energy_kj: w.activeEnergyBurned?.qty ?? null,
        total_energy_kj: w.totalEnergy?.qty ?? null,
        avg_heart_rate: w.heartRate?.avg ?? null,
        min_heart_rate: w.heartRate?.min ?? null,
        max_heart_rate: w.heartRate?.max ?? null,
        raw: w,
        updated_at: now,
        synced_at: now,
      }))

    if (rows.length > 0) {
      const { error } = await supabase
        .from('health_workouts')
        .upsert(rows, { onConflict: 'id' })

      if (error) {
        return new Response(
          JSON.stringify({ error: `upsert health_workouts: ${error.message}` }),
          { status: 500, headers: jsonHeaders }
        )
      }
    }
  }

  // Upsert metrics — one row per (metric, day, source). Value shape varies by
  // metric (qty vs Min/Avg/Max vs multi-field sleep object), so the whole
  // data point is stored as-is in a jsonb column rather than normalized.
  let metricRowCount = 0
  let skippedMetricPoints = 0
  if (metrics.length > 0) {
    const rows: AnyRecord[] = []
    for (const group of metrics) {
      if (!group.name) continue
      for (const point of group.data ?? []) {
        // A malformed date would fail the `date` column cast for this ONE
        // row, but upsert is a single SQL statement — that failure would
        // take the whole batch down with it. Skip instead.
        if (typeof point.date !== 'string' || point.date.length < 10) {
          skippedMetricPoints++
          continue
        }
        rows.push({
          user_id: userId,
          metric_name: group.name,
          date: point.date.slice(0, 10),
          unit: group.units ?? null,
          source: point.source ?? '',
          value: point,
          updated_at: now,
          synced_at: now,
        })
      }
    }

    if (rows.length > 0) {
      const { error } = await supabase
        .from('health_metrics')
        .upsert(rows, { onConflict: 'user_id,metric_name,date,source' })

      if (error) {
        return new Response(
          JSON.stringify({ error: `upsert health_metrics: ${error.message}` }),
          { status: 500, headers: jsonHeaders }
        )
      }
      metricRowCount = rows.length
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      workouts: workouts.length - skippedWorkouts,
      metrics: metricRowCount,
      skipped_workouts: skippedWorkouts,
      skipped_metric_points: skippedMetricPoints,
    }),
    { status: 200, headers: jsonHeaders }
  )
})
