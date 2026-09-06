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

// Workout numeric fields arrive either as a plain number or as a
// { qty, units } quantity object (confirmed in production: heartRate.avg/min/max
// come through as quantity objects, not plain numbers, despite the interface
// above) — passing an object straight into a `numeric` column fails the whole
// upsert. Unwrap either shape, or null if neither.
function numOrQty(v: unknown): number | null {
  if (typeof v === 'number') return v
  if (v && typeof v === 'object' && typeof (v as AnyRecord).qty === 'number') return (v as AnyRecord).qty
  return null
}

// REAL BUG (2026-09-06, live-confirmed): Health Auto Export's `source` field
// is a "|"-joined list of every device that contributed to that aggregated
// interval — but the list is NOT deduped and NOT ordered consistently between
// exports. Confirmed live: the regular sync wrote `source: "Furkan's Apple
// Watch"` for an hour, and a later "Since Last Sync"/reconciliation export
// wrote THE SAME hour's THE SAME value as `source: "Furkan's Apple
// Watch|Furkan's Apple Watch"` (the same device listed twice) — a different
// string, so it passed the `(user_id,metric_name,recorded_at,source)` unique
// key as a NEW row instead of upserting over the existing one. Every 'sum'
// metric (steps, active/basal energy — anything computeDailySeries adds up)
// then double/triple-counted that hour. Also seen with a genuine second
// device: "Lasci 17 Pro|Furkan's Apple Watch" vs "...|Furkan's Apple
// Watch|Furkan's Apple Watch" for the identical value. Canonicalizing before
// it ever reaches the `source` column (and the upsert's conflict key) makes
// these collapse onto the SAME row — an upsert, not a duplicate. Also folds
// a stray NBSP Apple sometimes writes inside "Apple Watch" to a normal space,
// which would otherwise defeat the "same device" comparison too.
function canonicalizeSource(raw: string): string {
  const parts = raw
    .split('|')
    .map(p => p.trim().replace(/\u00a0/g, ' '))
    .filter(Boolean)
  return [...new Set(parts)].sort().join('|')
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
  let workoutRowCount = 0
  if (workouts.length > 0) {
    // Keyed by id (real or synthetic) — same "cannot affect row a second
    // time" risk as metrics below if two workouts in one request share a
    // key (e.g. two id-less workouts with identical name+start+end).
    const rowsById = new Map<string, AnyRecord>()
    for (const raw of workouts) {
      const id = raw.id || (raw.name && (raw.start || raw.end) ? `synthetic:${raw.name}:${raw.start ?? ''}:${raw.end ?? ''}` : null)
      if (!id) {
        skippedWorkouts++
        continue
      }
      rowsById.set(id, {
        id,
        user_id: userId,
        name: raw.name,
        start_time: safeIso(raw.start),
        end_time: safeIso(raw.end),
        duration_seconds: numOrQty(raw.duration),
        active_energy_kj: numOrQty(raw.activeEnergyBurned),
        total_energy_kj: numOrQty(raw.totalEnergy),
        avg_heart_rate: numOrQty(raw.heartRate?.avg),
        min_heart_rate: numOrQty(raw.heartRate?.min),
        max_heart_rate: numOrQty(raw.heartRate?.max),
        // Everything through THIS webhook is Apple-family: Huawei Health already
        // syncs into Apple HealthKit before Health Auto Export reads it.
        // Stamping explicitly (not relying on the column default) so the
        // family is correct even if the default ever changes.
        source_family: 'apple',
        raw,
        updated_at: now,
        synced_at: now,
      })
    }
    const rows = [...rowsById.values()]

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
      workoutRowCount = rows.length
    }
  }

  // Upsert metrics — one row PER INCOMING POINT (point-in-time grain, keyed by
  // its exact timestamp), not one row per day. Health Auto Export sends
  // per-second/per-hour samples regardless of its "Summarize"/"Time Grouping"
  // settings — collapsing them by day at ingest time (the old behavior) meant
  // every new point silently overwrote the previous one, so only the LAST
  // point of the day ever survived (confirmed against real exports: this
  // made cumulative metrics like steps/energy show tiny fragments instead of
  // real daily totals). Storing every point as its own row discards nothing;
  // all summing/averaging/min-max happens at query time in the app (see
  // src/features/training/api/healthApi.ts), which also makes hourly-
  // resolution charts possible. Value shape varies by metric (qty vs
  // Min/Avg/Max vs multi-field sleep object), so the whole point is stored
  // as-is in a jsonb column rather than normalized.
  let metricRowCount = 0
  let skippedMetricPoints = 0
  if (metrics.length > 0) {
    // Keyed by the same columns as the upsert's onConflict target — a single
    // INSERT..ON CONFLICT DO UPDATE statement errors ("cannot affect row a
    // second time") if two rows in the same call share a conflict key. Two
    // points can only collide here if they share the exact same timestamp
    // (to-the-second) for the same metric+source — last one wins, matching
    // what a second, later-arriving request would do anyway.
    const rowsByKey = new Map<string, AnyRecord>()
    for (const group of metrics) {
      if (!group.name) continue
      for (const point of group.data ?? []) {
        // A malformed date would fail the `date`/`recorded_at` column cast
        // for this ONE row, but upsert is a single SQL statement — that
        // failure would take the whole batch down with it. Skip instead.
        if (typeof point.date !== 'string' || point.date.length < 10) {
          skippedMetricPoints++
          continue
        }
        // Sleep is special: a single night can have MORE THAN ONE session
        // (main sleep + a nap, or an interrupted night), and Health Auto
        // Export sends each as its own point — but every one of them carries
        // point.date = local MIDNIGHT of the attributed day. Keying on that
        // (as every other metric does) made all a night's sessions collide on
        // (metric,recorded_at,source) so the upsert kept only the last one,
        // silently dropping the rest (confirmed: iPhone 7h37m vs our 6.4h).
        // For sleep we key on the session's own start instead, so every
        // session survives; `date` still comes from the midnight-attributed
        // day so they group under the correct night.
        const sleepStart = typeof point.sleepStart === 'string' ? point.sleepStart : null
        const recordedAt = (group.name === 'sleep_analysis' && sleepStart ? safeIso(sleepStart) : null) ?? safeIso(point.date)
        if (!recordedAt) {
          skippedMetricPoints++
          continue
        }
        // Local calendar day from the export's own local-time string (before
        // UTC conversion) — safe against timezone-shift bugs near midnight,
        // unlike deriving it from the UTC `recorded_at` afterward.
        const date = point.date.slice(0, 10)
        const source = canonicalizeSource(point.source ?? '')
        rowsByKey.set(`${group.name}|${recordedAt}|${source}`, {
          user_id: userId,
          metric_name: group.name,
          date,
          recorded_at: recordedAt,
          unit: group.units ?? null,
          source,
          // Apple-family (see the workout upsert above for why).
          source_family: 'apple',
          value: point,
          updated_at: now,
          synced_at: now,
        })
      }
    }
    const rows = [...rowsByKey.values()]

    // Chunked so a large backfill (many days × many hourly points) can't hit
    // a single request's statement/parameter limits.
    const CHUNK_SIZE = 2000
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE)
      const { error } = await supabase
        .from('health_metrics')
        .upsert(chunk, { onConflict: 'user_id,metric_name,recorded_at,source' })

      if (error) {
        return new Response(
          JSON.stringify({ error: `upsert health_metrics: ${error.message}` }),
          { status: 500, headers: jsonHeaders }
        )
      }
    }
    metricRowCount = rows.length
  }

  return new Response(
    JSON.stringify({
      ok: true,
      workouts: workoutRowCount,
      metrics: metricRowCount,
      skipped_workouts: skippedWorkouts,
      skipped_metric_points: skippedMetricPoints,
    }),
    { status: 200, headers: jsonHeaders }
  )
})
