// google-health-sync — pulls Fitbit Air data from the Google Health API v4
// into health_metrics (source_family='fitbit') + health_sleep_segments.
//
// Every endpoint path, filter token, and payload shape below was LIVE-VERIFIED
// on 2026-07-21 (docs/google-health-api-surface.md) — path ids are kebab-case,
// filter fields snake_case, JSON fields camelCase; numeric values often arrive
// as STRINGS.
//
// 2026-08-20 completeness pass: re-verified every ingested metric's exact
// field names against a fresh fetch of the same v4 discovery document (still
// the current version — no v5 exists). Found and fixed FIVE real gaps:
// basal_energy_burned and respiratory_rate were never fetched at all despite
// being documented as shipped; walking_running_distance and
// heart_rate_variability were fetched but silently produced zero rows because
// the field names read were wrong (both were originally shipped as
// best-guesses, explicitly flagged "unverified" in their own comments — the
// guesses were wrong); active_zone_minutes was summing raw per-zone minutes
// without Fitbit's own ×2 cardio/peak weighting. vo2_max is a new addition
// (the Air can produce it via Connected-GPS; previously Apple-only).
//
// THREE non-negotiable gates (PM-ratified, tracker Phase 3):
//  1. Intraday `dataPoints` list for cumulative metrics (never dailyRollUp) —
//     the app's hourly source-resolution depends on sub-day granularity.
//  2. PLATFORM ALLOWLIST: only dataSource.platform === 'FITBIT' is ingested.
//     The Google Health iOS app mirrors Apple HealthKit into this same API;
//     unfiltered ingest would re-store the Apple webhook's own data mislabeled
//     as 'fitbit'. Everything else is dropped AND counted (skipped_non_fitbit).
//  3. Storage at HOURLY grain, mirroring the Apple pipeline's Time-Grouping:
//     Hours baseline — sums per civil hour; heart-rate samples collapse to one
//     {Min,Avg,Max} row per hour (the shape the app's minmaxavg path reads).
//
// Auth: EITHER a real user JWT (the in-app "Fetch now" button) OR the shared
// secret header `x-sync-secret: <GOOGLE_HEALTH_SYNC_SECRET>` (the cron
// schedule). Deploy with "Enforce JWT Verification" OFF (config.toml), same as
// the two webhooks — the secret path is not a Supabase JWT.
//
// Token: reuses the ONE Google refresh token stored by calendar-oauth in
// user_calendar_tokens (the unified "Connect Google" consent carries the
// health scopes too). On invalid_grant → records reconnect_required in
// google_health_sync_state and app_error_logs, returns 401.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// The Fetch-now path is called from the BROWSER (supabase.functions.invoke),
// so CORS headers are mandatory — same allow-list as calendar-oauth. The cron
// path is server-to-server and ignores them.
const ALLOWED_ORIGINS = ['https://lasciviens.github.io', 'http://localhost:5173']
function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey, x-sync-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}
const API = 'https://health.googleapis.com/v4/users/me'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>

const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

// Civil date string from the API's civil time object {date:{year,month,day}}.
function civilDate(ct: AnyRecord | undefined): string | null {
  const d = ct?.date
  if (!d || typeof d.year !== 'number') return null
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
}

// Hour-truncated ISO from an RFC3339 timestamp — the row's recorded_at for
// hourly-aggregated values. Oslo's offset is whole-hour year-round, so UTC
// hour boundaries and civil hour boundaries coincide (same invariant the
// frontend resolver documents).
const hourIso = (ts: string) => ts.slice(0, 13) + ':00:00Z'

// A daily-summary row keyed by a sentinel far-future date is config, not a real
// day (the live sweep saw daily-heart-rate-zones dated 9998-12-31) — skip those.
const isSentinelDate = (d: string) => d.startsWith('999')

// distance point → kilometres. VERIFIED against the live v4 discovery schema
// (2026-08-20): the `Distance` DataPoint has exactly one value field,
// `millimeters` (an int64, arrives as a STRING like every int64 in this API) —
// the earlier `distanceMillimeters`/`distanceMeters`/`kilometers`/`qty` guesses
// were all wrong field names, which is why this metric produced zero Fitbit
// rows despite the ingestion call existing since v1.1. Stored in KM to match
// the Apple pipeline — StepsSection reads walking_running_distance's qty
// straight as kilometres.
function distanceKm(body: AnyRecord): number | null {
  const mm = num(body?.millimeters)
  return mm != null ? mm / 1_000_000 : null
}

// Active Zone Minutes point → WEIGHTED minutes. VERIFIED against the live
// schema: `ActiveZoneMinutes` delivers one point PER HEART-RATE ZONE per
// interval — `heartRateZone` (FAT_BURN | CARDIO | PEAK) + `activeZoneMinutes`
// (raw minutes in that zone, int64-as-string). Fitbit's own AZM definition
// weights Cardio and Peak zones ×2 (they count double toward the daily AZM
// goal) and Fat Burn ×1 — the previous flat-sum/guessed-field-name version
// ignored this weighting entirely (and its field-name fallbacks never matched
// anything real), so AZM was being undercounted whenever cardio/peak minutes
// were logged.
function activeZoneMin(body: AnyRecord): number | null {
  const raw = num(body?.activeZoneMinutes)
  if (raw == null) return null
  const zone = String(body?.heartRateZone ?? '').toUpperCase()
  const weight = (zone === 'CARDIO' || zone === 'PEAK') ? 2 : 1
  return raw * weight
}

async function listDataPoints(
  accessToken: string,
  dataType: string,       // kebab-case path id
  filter: string,
  skipped: { nonFitbit: number },
): Promise<AnyRecord[]> {
  const out: AnyRecord[] = []
  let pageToken = ''
  for (let page = 0; page < 30; page++) {
    const url = `${API}/dataTypes/${dataType}/dataPoints?pageSize=10000&filter=${encodeURIComponent(filter)}` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '')
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`${dataType}: HTTP ${res.status} ${body.slice(0, 200)}`)
    }
    const j = await res.json()
    for (const p of j.dataPoints ?? []) {
      // Gate 2 — strict allowlist. Unknown/missing platform is dropped too.
      if (p?.dataSource?.platform === 'FITBIT') out.push(p)
      else skipped.nonFitbit++
    }
    pageToken = j.nextPageToken ?? ''
    if (!pageToken) break
  }
  return out
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('origin'))
  const jsonHeaders = { ...cors, 'Content-Type': 'application/json' }
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: cors })

  // ── Auth: user JWT (Fetch now) or shared secret (cron) ──
  const secret = Deno.env.get('GOOGLE_HEALTH_SYNC_SECRET')
  const syncSecretHeader = req.headers.get('x-sync-secret')
  let userId: string | null = null
  if (secret && syncSecretHeader === secret) {
    userId = Deno.env.get('HEVY_USER_ID') ?? null   // single-user app, same id everywhere
  } else {
    const authHeader = req.headers.get('authorization') ?? ''
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    userId = user?.id ?? null
  }
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders })

  let days = 1
  try {
    const body = await req.json().catch(() => ({}))
    if (typeof body?.days === 'number') days = Math.min(14, Math.max(1, Math.floor(body.days)))
  } catch { /* default */ }

  const now = new Date()
  const fromIso = new Date(now.getTime() - days * 86400_000).toISOString().slice(0, 19) + 'Z'
  const toIso   = new Date(now.getTime() + 86400_000).toISOString().slice(0, 19) + 'Z'
  const syncedAt = now.toISOString()

  async function recordState(patch: AnyRecord) {
    await supabase.from('google_health_sync_state').upsert(
      { user_id: userId, ...patch, updated_at: syncedAt },
      { onConflict: 'user_id' },
    )
  }
  async function fail(status: number, error: string, reconnect = false) {
    await recordState({ last_error: error, last_error_at: syncedAt })
    await supabase.from('app_error_logs').insert({
      user_id: userId, message: `google-health-sync: ${error}`, context: { reconnect },
    }).then(() => {}, () => {})
    return new Response(JSON.stringify({ error, reconnect_required: reconnect }), { status, headers: jsonHeaders })
  }

  // ── Mint an access token from the unified stored refresh token ──
  const { data: tokenRow } = await supabase
    .from('user_calendar_tokens').select('refresh_token').eq('user_id', userId).single()
  if (!tokenRow?.refresh_token) return fail(401, 'not_connected — use Connect Google in the app', true)

  // DOWN-SCOPED refresh (live-verified requirement, 2026-07-21): the Google
  // Health API rejects any access token that also carries non-health scopes —
  // 403 DISALLOWED_OAUTH_SCOPES naming "cl_events,tasks". The ONE stored
  // refresh token keeps the full union (single "Connect Google" consent);
  // here we mint a health-only access token by passing the narrower scope set
  // (standard OAuth2 down-scoping). calendar-token keeps minting full-scope
  // tokens for Calendar/Tasks, which tolerate extra scopes.
  const HEALTH_SCOPES = [
    'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
    'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
    'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
  ].join(' ')
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: tokenRow.refresh_token,
      client_id:     Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      grant_type:    'refresh_token',
      scope:         HEALTH_SCOPES,
    }),
  })
  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({} as AnyRecord))
    const reconnect = err.error === 'invalid_grant'
    return fail(reconnect ? 401 : 502, `token refresh failed: ${err.error ?? tokenRes.status}`, reconnect)
  }
  const { access_token } = await tokenRes.json()

  const skipped = { nonFitbit: 0 }
  const counts: AnyRecord = {}
  const metricRows: AnyRecord[] = []
  const SOURCE = 'Fitbit Air'

  const baseRow = (metric: string, date: string, recordedAt: string, unit: string, value: AnyRecord) => ({
    user_id: userId, metric_name: metric, date, recorded_at: recordedAt, unit,
    source: SOURCE, source_family: 'fitbit', value, updated_at: syncedAt, synced_at: syncedAt,
  })

  // Cumulative interval type → hourly {qty} sum rows (gate 1 + 3), same shape as
  // the steps/energy loop below. `conv` maps one point's union body to its
  // contribution in the STORED unit (or null to skip) — lets the two v1.1
  // cumulative metrics (distance, AZM) reuse the exact bucket logic while doing
  // their own unit normalization, without touching the verified steps/energy path.
  async function ingestCumulative(
    pathId: string, unionField: string, filterTok: string,
    metric: string, unit: string, conv: (b: AnyRecord) => number | null,
  ) {
    const pts = await listDataPoints(access_token, pathId,
      `${filterTok}.interval.start_time >= "${fromIso}" AND ${filterTok}.interval.start_time < "${toIso}"`, skipped)
    const byHour = new Map<string, { date: string; sum: number }>()
    for (const p of pts) {
      const body = p[unionField]
      const q = conv(body ?? {})
      const start = body?.interval?.startTime
      const date = civilDate(body?.interval?.civilStartTime)
      if (q == null || typeof start !== 'string' || !date) continue
      const k = hourIso(start)
      const cur = byHour.get(k)
      if (cur) cur.sum += q
      else byHour.set(k, { date, sum: q })
    }
    for (const [k, v] of byHour) metricRows.push(baseRow(metric, v.date, k, unit, { qty: v.sum }))
    counts[metric] = byHour.size
  }

  try {
    // ── Cumulative interval metrics → hourly sums (gate 1 + 3) ──
    for (const [pathId, filterTok, metric, unit, valueKey] of [
      ['steps', 'steps', 'step_count', 'count', 'count'],
      ['active-energy-burned', 'active_energy_burned', 'active_energy', 'kcal', 'kcal'],
    ] as const) {
      const pts = await listDataPoints(access_token, pathId,
        `${filterTok}.interval.start_time >= "${fromIso}" AND ${filterTok}.interval.start_time < "${toIso}"`, skipped)
      const byHour = new Map<string, { date: string; sum: number }>()
      for (const p of pts) {
        const body = p[pathId === 'steps' ? 'steps' : 'activeEnergyBurned']
        const q = num(body?.[valueKey])
        const start = body?.interval?.startTime
        const date = civilDate(body?.interval?.civilStartTime)
        if (q == null || typeof start !== 'string' || !date) continue
        const k = hourIso(start)
        const cur = byHour.get(k)
        if (cur) cur.sum += q
        else byHour.set(k, { date, sum: q })
      }
      for (const [k, v] of byHour) metricRows.push(baseRow(metric, v.date, k, unit, { qty: v.sum }))
      counts[metric] = byHour.size
    }

    // ── v1.1 cumulative interval metrics → hourly sums (own unit normalization) ──
    // Distance stored in km (app convention); AZM in weighted minutes.
    await ingestCumulative('distance', 'distance', 'distance',
      'walking_running_distance', 'km', distanceKm)
    await ingestCumulative('active-zone-minutes', 'activeZoneMinutes', 'active_zone_minutes',
      'active_zone_minutes', 'min', activeZoneMin)

    // ── Basal energy burned (cumulative interval, same shape as active energy) ──
    // Real gap fixed 2026-08-20: this was never fetched at all despite
    // docs/fitbit-air-integration.md documenting it as "v1, shipped" — the
    // ingestion call itself was simply missing. Schema (VERIFIED): same shape
    // as ActiveEnergyBurned — `interval` + `kcal`.
    await ingestCumulative('basal-energy-burned', 'basalEnergyBurned', 'basal_energy_burned',
      'basal_energy_burned', 'kcal', b => num(b?.kcal))

    // ── Heart rate samples → one {Min,Avg,Max} row per hour ──
    {
      const pts = await listDataPoints(access_token, 'heart-rate',
        `heart_rate.sample_time.physical_time >= "${fromIso}" AND heart_rate.sample_time.physical_time < "${toIso}"`, skipped)
      const byHour = new Map<string, { date: string; min: number; max: number; sum: number; n: number }>()
      for (const p of pts) {
        const hr = p.heartRate
        const bpm = num(hr?.beatsPerMinute)
        const t = hr?.sampleTime?.physicalTime
        const date = civilDate(hr?.sampleTime?.civilTime)
        if (bpm == null || typeof t !== 'string' || !date) continue
        const k = hourIso(t)
        const cur = byHour.get(k)
        if (!cur) byHour.set(k, { date, min: bpm, max: bpm, sum: bpm, n: 1 })
        else { cur.min = Math.min(cur.min, bpm); cur.max = Math.max(cur.max, bpm); cur.sum += bpm; cur.n++ }
      }
      for (const [k, v] of byHour) {
        metricRows.push(baseRow('heart_rate', v.date, k, 'count/min',
          { Min: v.min, Max: v.max, Avg: Math.round((v.sum / v.n) * 10) / 10 }))
      }
      counts.heart_rate = byHour.size
    }

    // ── Daily resting heart rate ──
    {
      const fromDate = fromIso.slice(0, 10)
      const pts = await listDataPoints(access_token, 'daily-resting-heart-rate',
        `daily_resting_heart_rate.date >= "${fromDate}"`, skipped)
      let n = 0
      for (const p of pts) {
        const d = p.dailyRestingHeartRate
        const bpm = num(d?.beatsPerMinute)
        const date = civilDate(d)   // {date:{...}} lives directly on the value
        if (bpm == null || !date) continue
        metricRows.push(baseRow('resting_heart_rate', date, `${date}T12:00:00Z`, 'count/min', { qty: bpm }))
        n++
      }
      counts.resting_heart_rate = n
    }

    // ── Daily heart-rate variability (one value per day) ──
    // Field name VERIFIED against the live schema 2026-08-20: the DAILY summary
    // type (`DailyHeartRateVariability`, which is what this path fetches) does
    // NOT have `rootMeanSquareOfSuccessiveDifferencesMilliseconds` — that field
    // lives on the SEPARATE intraday `HeartRateVariability` sample type, which
    // this ingestion never queries. The real daily field is
    // `averageHeartRateVariabilityMilliseconds` — reading the wrong schema's
    // field name is why this produced zero Fitbit rows despite the call
    // existing since v1.1. Registered 'average' in METRIC_AGGREGATION (a daily
    // point → itself per day, averaged across a week window).
    {
      const fromDate = fromIso.slice(0, 10)
      const pts = await listDataPoints(access_token, 'daily-heart-rate-variability',
        `daily_heart_rate_variability.date >= "${fromDate}"`, skipped)
      let n = 0
      for (const p of pts) {
        const d = p.dailyHeartRateVariability
        const ms = num(d?.averageHeartRateVariabilityMilliseconds)
        const date = civilDate(d)
        if (ms == null || !date || isSentinelDate(date)) continue
        metricRows.push(baseRow('heart_rate_variability', date, `${date}T12:00:00Z`, 'ms', { qty: ms }))
        n++
      }
      counts.heart_rate_variability = n
    }

    // ── Daily respiratory rate (one value per day) — real gap fixed 2026-08-20:
    // never fetched at all. Schema (VERIFIED): `DailyRespiratoryRate` has
    // `breathsPerMinute` + `date`. Unit matches the Apple pipeline's existing
    // respiratory_rate rows ('count/min') for display consistency.
    {
      const fromDate = fromIso.slice(0, 10)
      const pts = await listDataPoints(access_token, 'daily-respiratory-rate',
        `daily_respiratory_rate.date >= "${fromDate}"`, skipped)
      let n = 0
      for (const p of pts) {
        const d = p.dailyRespiratoryRate
        const bpm = num(d?.breathsPerMinute)
        const date = civilDate(d)
        if (bpm == null || !date || isSentinelDate(date)) continue
        metricRows.push(baseRow('respiratory_rate', date, `${date}T12:00:00Z`, 'count/min', { qty: bpm }))
        n++
      }
      counts.respiratory_rate = n
    }

    // ── Daily VO2 max (one value per day) — real gap fixed 2026-08-20: never
    // fetched at all, despite the Air being documented as able to produce it
    // via Connected-GPS. Schema (VERIFIED): `DailyVO2Max` has `vo2Max`
    // (ml/kg/min) + `date` (+ optional `estimated`/`cardioFitnessLevel`, not
    // stored — this app shows the raw number only, matching the Apple pipeline's
    // existing vo2_max rows). Low-volume metric (a handful of points even on
    // the Apple side), so a small row count here is expected, not a bug.
    {
      const fromDate = fromIso.slice(0, 10)
      const pts = await listDataPoints(access_token, 'daily-vo2-max',
        `daily_vo2_max.date >= "${fromDate}"`, skipped)
      let n = 0
      for (const p of pts) {
        const d = p.dailyVo2Max
        const v = num(d?.vo2Max)
        const date = civilDate(d)
        if (v == null || !date || isSentinelDate(date)) continue
        metricRows.push(baseRow('vo2_max', date, `${date}T12:00:00Z`, 'ml/(kg·min)', { qty: v }))
        n++
      }
      counts.vo2_max = n
    }

    // ── Nightly skin-temperature deviation (daily summary, point-in-time) ──
    // Field names VERIFIED against the live schema 2026-08-20: none of the four
    // guessed "deviation" field names exist. `DailySleepTemperatureDerivations`
    // actually carries the absolute `nightlyTemperatureCelsius` and an OPTIONAL
    // `baselineTemperatureCelsius` (median of the last 30 days) — there is no
    // single ready-made "deviation" field; we compute it ourselves as
    // nightly − baseline, matching what the app displays (a deviation, not an
    // absolute temperature). `baselineTemperatureCelsius` is optional (e.g. the
    // first ~30 days have no baseline yet) — skip the row rather than storing
    // a bare absolute temperature under a metric name the UI treats as a
    // deviation, which would silently misrepresent it.
    {
      const fromDate = fromIso.slice(0, 10)
      const pts = await listDataPoints(access_token, 'daily-sleep-temperature-derivations',
        `daily_sleep_temperature_derivations.date >= "${fromDate}"`, skipped)
      let n = 0
      for (const p of pts) {
        const d = p.dailySleepTemperatureDerivations
        const nightly = num(d?.nightlyTemperatureCelsius)
        const baseline = num(d?.baselineTemperatureCelsius)
        const date = civilDate(d)
        if (nightly == null || baseline == null || !date || isSentinelDate(date)) continue
        metricRows.push(baseRow('skin_temperature', date, `${date}T12:00:00Z`, '°C', { qty: nightly - baseline }))
        n++
      }
      counts.skin_temperature = n
    }

    // ── Blood oxygen (SpO2) — the shape the Air populates is UNCONFIRMED ──
    // Registered minmaxavg (heart_rate-shaped assumption, tracker Phase 0 lock).
    // Both the intraday samples type and the daily-summary type exist; try the
    // SAMPLES type first (fits minmaxavg cleanly via hourly Min/Avg/Max, exactly
    // like HR), and if it yields no rows, fall back to the daily summary. The
    // path that produced data is reflected in counts.oxygen_saturation_source.
    // Both are empty until a real overnight wear — never hard-fail. The value
    // field is also unverified, so read it under a few plausible keys.
    {
      const spo2Pct = (o: AnyRecord | undefined): number | null => num(
        o?.percentage ?? o?.oxygenSaturationPercentage ?? o?.saturationPercentage ??
        o?.value ?? o?.qty,
      )
      // Path A: oxygen-saturation samples → hourly Min/Avg/Max (minmaxavg).
      const samples = await listDataPoints(access_token, 'oxygen-saturation',
        `oxygen_saturation.sample_time.physical_time >= "${fromIso}" AND oxygen_saturation.sample_time.physical_time < "${toIso}"`, skipped)
      const byHour = new Map<string, { date: string; min: number; max: number; sum: number; n: number }>()
      for (const p of samples) {
        const o = p.oxygenSaturation
        const pct = spo2Pct(o)
        const t = o?.sampleTime?.physicalTime
        const date = civilDate(o?.sampleTime?.civilTime)
        if (pct == null || typeof t !== 'string' || !date) continue
        const k = hourIso(t)
        const cur = byHour.get(k)
        if (!cur) byHour.set(k, { date, min: pct, max: pct, sum: pct, n: 1 })
        else { cur.min = Math.min(cur.min, pct); cur.max = Math.max(cur.max, pct); cur.sum += pct; cur.n++ }
      }
      if (byHour.size > 0) {
        for (const [k, v] of byHour) {
          metricRows.push(baseRow('oxygen_saturation', v.date, k, '%',
            { Min: v.min, Max: v.max, Avg: Math.round((v.sum / v.n) * 10) / 10 }))
        }
        counts.oxygen_saturation = byHour.size
        counts.oxygen_saturation_source = 'samples'
      } else {
        // Path B: daily-oxygen-saturation summary → one Min/Avg/Max row per day.
        const fromDate = fromIso.slice(0, 10)
        const daily = await listDataPoints(access_token, 'daily-oxygen-saturation',
          `daily_oxygen_saturation.date >= "${fromDate}"`, skipped)
        let n = 0
        for (const p of daily) {
          const d = p.dailyOxygenSaturation
          const date = civilDate(d)
          if (!date || isSentinelDate(date)) continue
          const avg = spo2Pct(d) ?? num(d?.average ?? d?.avg)
          if (avg == null) continue
          const min = num(d?.min ?? d?.minimum) ?? avg
          const max = num(d?.max ?? d?.maximum) ?? avg
          metricRows.push(baseRow('oxygen_saturation', date, `${date}T12:00:00Z`, '%',
            { Min: min, Max: max, Avg: avg }))
          n++
        }
        counts.oxygen_saturation = n
        counts.oxygen_saturation_source = n > 0 ? 'daily' : 'none'
      }
    }

    // ── Sleep sessions → stage segments + one aggregate sleep_analysis row ──
    const segmentRows: AnyRecord[] = []
    {
      const pts = await listDataPoints(access_token, 'sleep',
        `sleep.interval.end_time >= "${fromIso}" AND sleep.interval.end_time < "${toIso}"`, skipped)
      let n = 0
      const STAGE_MAP: Record<string, string> = {
        LIGHT: 'light', DEEP: 'deep', REM: 'rem', WAKE: 'wake', AWAKE: 'wake', ASLEEP: 'asleep',
      }
      for (const p of pts) {
        const s = p.sleep
        const start = s?.interval?.startTime
        const end = s?.interval?.endTime
        if (typeof start !== 'string' || typeof end !== 'string') continue
        const externalId = s?.metadata?.externalId ?? p.name ?? null
        for (const st of s?.stages ?? []) {
          const stage = STAGE_MAP[String(st?.type ?? '').toUpperCase()]
          if (!stage || typeof st.startTime !== 'string' || typeof st.endTime !== 'string') continue
          segmentRows.push({
            user_id: userId, start_at: st.startTime, end_at: st.endTime, stage,
            source: SOURCE, source_family: 'fitbit', source_record_id: externalId,
            synced_at: syncedAt, updated_at: syncedAt,
          })
        }
        // Aggregate row in the exact shape the app's sleep pipeline reads
        // (totalSleep/core/rem/deep/awake hours + session window). Fitbit's
        // LIGHT maps onto the app's "core" bucket (closest concept — never
        // blended with Apple rows anyway; whole-night single-source rule).
        const sum = s?.summary
        const mins = (v: unknown) => (num(v) ?? 0) / 60
        const stageMin = (t: string) =>
          mins((sum?.stagesSummary ?? []).find((x: AnyRecord) => x?.type === t)?.minutes)
        // End's civil day = the night it belongs to (wake-day attribution).
        const endOffsetSec = num(s?.interval?.endUtcOffset?.replace?.('s', '')) ?? 0
        const endLocal = new Date(new Date(end).getTime() + endOffsetSec * 1000)
        const date = endLocal.toISOString().slice(0, 10)
        metricRows.push(baseRow('sleep_analysis', date, start, 'hr', {
          sleepStart: start, sleepEnd: end,
          totalSleep: mins(sum?.minutesAsleep),
          core: stageMin('LIGHT'), deep: stageMin('DEEP'), rem: stageMin('REM'),
          awake: mins(sum?.minutesAwake),
          source: SOURCE,
        }))
        n++
      }
      counts.sleep_sessions = n
      counts.sleep_segments = segmentRows.length
    }

    // ── Upserts (idempotent on the same keys the Apple pipeline uses) ──
    const CHUNK = 2000
    for (let i = 0; i < metricRows.length; i += CHUNK) {
      const { error } = await supabase.from('health_metrics')
        .upsert(metricRows.slice(i, i + CHUNK), { onConflict: 'user_id,metric_name,recorded_at,source' })
      if (error) throw new Error(`upsert health_metrics: ${error.message}`)
    }
    for (let i = 0; i < segmentRows.length; i += CHUNK) {
      const { error } = await supabase.from('health_sleep_segments')
        .upsert(segmentRows.slice(i, i + CHUNK), { onConflict: 'user_id,source_family,start_at,end_at,stage' })
      if (error) throw new Error(`upsert health_sleep_segments: ${error.message}`)
    }
  } catch (e) {
    return fail(502, (e as Error).message)
  }

  await recordState({ last_success_at: syncedAt, last_error: null, last_error_at: null })
  return new Response(JSON.stringify({
    ok: true, window_days: days, rows: metricRows.length, counts,
    skipped_non_fitbit: skipped.nonFitbit,
  }), { status: 200, headers: jsonHeaders })
})
