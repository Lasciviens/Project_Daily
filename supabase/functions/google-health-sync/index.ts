// google-health-sync — pulls Fitbit Air data from the Google Health API v4
// into health_metrics (source_family='fitbit') + health_sleep_segments.
//
// Every endpoint path, filter token, and payload shape below was LIVE-VERIFIED
// on 2026-07-21 (docs/google-health-api-surface.md) — path ids are kebab-case,
// filter fields snake_case, JSON fields camelCase; numeric values often arrive
// as STRINGS.
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

const jsonHeaders = { 'Content-Type': 'application/json' }
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
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

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

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: tokenRow.refresh_token,
      client_id:     Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      grant_type:    'refresh_token',
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
