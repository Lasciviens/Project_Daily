// Pure aggregation functions over raw health_metrics points — collapses
// point-in-time rows (one per incoming sample, any source) into daily
// numbers for rings/summary cards/charts. Kept separate from healthApi.ts
// (which only fetches) so these are trivially unit-testable without a DB.
import { getAggregationType } from './healthMetrics'
import type { HealthMetric } from './api/healthApi'

// ── Intra-stream duplicate collapse (display-level, sum metrics only) ───────
// A SINGLE stream can carry overlapping samples of the same physical activity:
// starting a Fitness-app workout makes HealthKit hold both the regular step
// samples AND workout-associated ones, and Health Auto Export exports every
// sample with only its START time (no interval end) — so Apple's own
// interval-overlap dedup can't be replicated here. Live proof (2026-07-20,
// 16–17h, watch stream): 88 of 94 minutes had TWO points with essentially the
// same qty (106.86025364796929 vs …26 — float-noise twins), inflating the day
// by thousands of steps even though only one stream was involved.
//
// Backstop rule: within one stream, one MINUTE keeps only its LARGEST point —
// overlapping same-minute samples are the same seconds counted twice, and the
// larger one is the fuller window. Applied only to 'sum'-type metrics (for
// average/minmaxavg/latest, duplicate values don't distort the result). This
// is display-level only: the DB keeps every raw point — the ROOT fix is
// Health Auto Export's "Aggregate Data" export setting; this backstop
// protects whatever raw shape actually arrives. Cross-minute window overlap
// (a ~2-min sample every ~40s) is NOT fully recoverable without interval
// ends; expect residual inflation until the source exports pre-aggregated
// data.
//
// REAL BUG, round 1 (2026-09-06, live-confirmed): "stream" used to mean the
// raw `source` STRING, but Health Auto Export's `source` is a "|"-joined list
// of contributing devices that is NEITHER deduped NOR consistently ordered
// between exports -- the SAME hour, from the SAME device(s), showed up as
// both `"Furkan's Apple Watch"` and `"Furkan's Apple Watch|Furkan's Apple
// Watch"`. The original fix canonicalized this string (dedupe + sort the
// "|"-joined parts, fold a stray NBSP) and grouped duplicates by canonical
// source + exact minute \u2014 round 2 below replaced that grouping key entirely
// (source turned out not to matter at all), so no canonicalization is done
// in THIS file any more. `health-export-webhook`'s own `canonicalizeSource`
// still canonicalizes the `source` COLUMN at ingest time (a separate,
// still-valid fix \u2014 it keeps future re-deliveries from bloating the table
// with as many redundant rows), it's only this display-side grouping that
// changed.
//
// REAL BUG, round 2 (2026-09-06, live-confirmed the SAME day -- round 1
// wasn't enough): after triggering Health Auto Export's 7-day/30-day
// reconciliation automations, basal energy showed ~5400 kcal/day average
// (physiologically implausible -- a real BMR is ~1600-2400) and steps read
// 2-3x too high. Live data showed why: EVERY hour carries not two but often
// THREE rows -- two exact duplicates (round 1's bug) PLUS a THIRD at a
// DIFFERENT minute (e.g. "06:00:00" qty=83.7 and "06:39:34" qty=64.2) whose
// `source` is a DIFFERENT device combination (just "Watch" instead of
// "Watch|Lasci 17 Pro") -- so round 1's per-minute-per-canonical-source key
// treated it as a genuinely different stream and summed it on top. But the
// VALUES across an hour's rows are all nearly identical regardless of which
// devices are listed (confirmed live: 77.55 / 77.64 / 77.60 kcal for the
// SAME real hour) -- these are not independent per-device contributions to
// add together, they are Health Auto Export re-reporting the SAME real
// hour's already-merged HealthKit total multiple times as its sync
// automations re-fire (the regular near-real-time sync, then a
// reconciliation pass minutes or days later) -- the `source` list just
// reflects whichever raw samples happened to be available to HealthKit's
// own merge at THAT sync moment, not a second real measurement. Health Auto
// Export's "Time Grouping: Hours" setting means there is supposed to be
// exactly ONE row per hour; every extra row for an hour already seen is a
// re-delivery, never additional data -- so grouping must be by HOUR ONLY,
// deliberately ignoring both the exact minute and the source string.
// Verified against real numbers: a naive sum for one partial day totaled
// 3309 kcal of basal energy; hour-level collapse (this function) brings the
// SAME rows down to 1164 kcal -- a sane ~80 kcal/hour. Still display-level
// only (the DB keeps every raw row) and still 'sum'-type metrics only --
// average/minmaxavg/latest metrics don't distort this way.
function hourKeyOf(p: HealthMetric): string {
  return p.recorded_at.slice(0, 13) // "yyyy-MM-ddTHH", UTC hour bucket
}

// A row landing exactly on the hour (":00:00") is Health Auto Export's own
// "this hour is now closed, here is its final total" delivery -- prefer it
// over a mid-hour "since last sync, here's the partial total so far" row
// even when the partial happens to read larger (a partial should never beat
// a closed hour's own number). Only when NEITHER row in an hour landed
// exactly on the boundary (both partial) does the larger of the two win, as
// the more complete partial available.
function isHourBoundary(p: HealthMetric): boolean {
  return p.recorded_at.slice(14, 19) === '00:00' // minute:second
}

function collapseIntraStreamMinuteDuplicates(points: HealthMetric[]): HealthMetric[] {
  const byHour = new Map<string, HealthMetric>()
  const passthrough: HealthMetric[] = []
  let dropped = 0
  for (const p of points) {
    const q = p.value?.qty
    if (typeof q !== 'number') { passthrough.push(p); continue }
    const k = hourKeyOf(p)
    const kept = byHour.get(k)
    if (!kept) { byHour.set(k, p); continue }
    dropped++
    const keptIsBoundary = isHourBoundary(kept)
    const pIsBoundary = isHourBoundary(p)
    if (pIsBoundary && !keptIsBoundary) byHour.set(k, p)
    else if (pIsBoundary === keptIsBoundary && q > (kept.value?.qty as number)) byHour.set(k, p)
  }
  if (dropped === 0) return points
  return [...byHour.values(), ...passthrough]
}

const KJ_PER_KCAL = 4.184
const ENERGY_METRICS = new Set(['active_energy', 'basal_energy_burned'])

function qtyOf(point: HealthMetric, metricName?: string): number | null {
  const v = point.value?.qty
  if (typeof v !== 'number') return null
  if (metricName && ENERGY_METRICS.has(metricName) && point.unit?.toLowerCase().includes('kj')) {
    return v / KJ_PER_KCAL
  }
  return v
}

function groupByDate(points: HealthMetric[]): Map<string, HealthMetric[]> {
  const byDate = new Map<string, HealthMetric[]>()
  for (const p of points) {
    const arr = byDate.get(p.date)
    if (arr) arr.push(p)
    else byDate.set(p.date, [p])
  }
  return byDate
}

// Collapses a group of points into a single number per the metric's
// aggregation type. Apple Health is the sole data source, so this stays
// source-blind on purpose — no cross-stream resolution needed.
function aggregateGroup(points: HealthMetric[], metricName: string): number | null {
  const aggType = getAggregationType(metricName)
  const qtys = points.map(p => qtyOf(p, metricName)).filter((v): v is number => v != null)
  if (aggType === 'sum') return qtys.length ? qtys.reduce((a, b) => a + b, 0) : null
  if (aggType === 'average') return qtys.length ? qtys.reduce((a, b) => a + b, 0) / qtys.length : null
  if (aggType === 'latest') {
    const sorted = [...points].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))
    for (let i = sorted.length - 1; i >= 0; i--) {
      const q = qtyOf(sorted[i], metricName)
      if (q != null) return q
    }
    return null
  }
  // 'minmaxavg' (heart_rate) and 'sleep' (sleep_analysis) have their own
  // shape-specific merges below — this generic path shouldn't be called for
  // them, but average-of-qty is a harmless fallback if it ever is.
  return qtys.length ? qtys.reduce((a, b) => a + b, 0) / qtys.length : null
}

export interface DailyValue { date: string; value: number }

// One number per day for sum/average/latest-type metrics.
export function computeDailySeries(metricName: string, points: HealthMetric[]): DailyValue[] {
  let resolved = points
  if (getAggregationType(metricName) === 'sum') resolved = collapseIntraStreamMinuteDuplicates(resolved)
  const byDate = groupByDate(resolved)
  const result: DailyValue[] = []
  for (const [date, pts] of byDate) {
    const value = aggregateGroup(pts, metricName)
    if (value != null) result.push({ date, value })
  }
  return result.sort((a, b) => a.date.localeCompare(b.date))
}

export interface HourlyValue { hour: number; label: string; value: number }

// One number per hour-of-day (0-23) for a single day's points — used by the
// Steps/Energy sections' hourly bar charts. Uses the browser's local timezone
// to bucket (recorded_at is an absolute instant either way).
export function computeHourlyBuckets(metricName: string, points: HealthMetric[]): HourlyValue[] {
  let resolved = points
  if (getAggregationType(metricName) === 'sum') resolved = collapseIntraStreamMinuteDuplicates(resolved)
  const byHour = new Map<number, HealthMetric[]>()
  for (const p of resolved) {
    const h = new Date(p.recorded_at).getHours()
    const arr = byHour.get(h)
    if (arr) arr.push(p)
    else byHour.set(h, [p])
  }
  return Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    label: `${String(h).padStart(2, '0')}:00`,
    value: Math.round((aggregateGroup(byHour.get(h) ?? [], metricName) ?? 0) * 100) / 100,
  }))
}

export interface DailyRange { date: string; min: number; max: number; avg: number }

function rangeFromPoints(pts: HealthMetric[]): { min: number; max: number; avg: number } | null {
  const mins = pts.map(p => p.value?.Min).filter((v): v is number => typeof v === 'number')
  const maxs = pts.map(p => p.value?.Max).filter((v): v is number => typeof v === 'number')
  const avgs = pts.map(p => p.value?.Avg).filter((v): v is number => typeof v === 'number')
  if (!mins.length && !maxs.length && !avgs.length) return null
  return {
    min: mins.length ? Math.min(...mins) : 0,
    max: maxs.length ? Math.max(...maxs) : 0,
    avg: avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : 0,
  }
}

// heart_rate-shaped points ({Min,Avg,Max} per point) — a real day range needs
// the min of all mins / max of all maxes, not just the last window's numbers.
export function computeHeartRateDailySeries(points: HealthMetric[]): DailyRange[] {
  const byDate = groupByDate(points)
  const result: DailyRange[] = []
  for (const [date, pts] of byDate) {
    const range = rangeFromPoints(pts)
    if (range) result.push({ date, ...range })
  }
  return result.sort((a, b) => a.date.localeCompare(b.date))
}

export interface HourlyRange { hour: number; label: string; min: number; max: number; avg: number }

// Same as computeHeartRateDailySeries but bucketed by hour-of-day, for a
// single day's "Day" view.
export function computeHeartRateHourlySeries(points: HealthMetric[]): HourlyRange[] {
  const byHour = new Map<number, HealthMetric[]>()
  for (const p of points) {
    const h = new Date(p.recorded_at).getHours()
    const arr = byHour.get(h)
    if (arr) arr.push(p)
    else byHour.set(h, [p])
  }
  return Array.from({ length: 24 }, (_, h) => {
    const range = rangeFromPoints(byHour.get(h) ?? []) ?? { min: 0, max: 0, avg: 0 }
    return { hour: h, label: `${String(h).padStart(2, '0')}:00`, ...range }
  })
}

export interface SleepSummary { date: string; core: number; rem: number; deep: number; awake: number; total: number }

const SLEEP_STAGE_KEYS = ['Core', 'REM', 'Deep', 'Awake', 'Asleep'] as const

// sleep_analysis arrives in two shapes depending on Health Auto Export's
// "Summarize" setting: pre-aggregated (one point/day with
// core/rem/deep/awake/totalSleep fields already computed) or raw per-segment
// points ({value:'Core'|'Deep'|'REM'|'Awake'|'Asleep', qty: hours, start, end}
// — one row per sleep-stage transition). Handle both.

// The night a sleep session belongs to = the day you WOKE UP (Apple's own
// convention). For pre-aggregated sessions we derive it from the session's
// own sleepEnd (a local-time string like "2026-07-17 07:27:08 +0200" — the
// date part IS the local wake day, no timezone math needed) rather than
// trusting the ingest-stamped `date` blindly: an interrupted night can arrive
// as multiple sessions, and if the exporter ever attributes a pre-midnight
// session to the previous calendar day, keying on `date` alone would split
// one real night across two chart bars. Rows without a parseable sleepEnd
// (manual entries, raw segments) keep their stored date.
function sleepNightKey(p: HealthMetric): string {
  const end = p.value?.sleepEnd
  if (typeof end === 'string' && /^\d{4}-\d{2}-\d{2}/.test(end) && /[+-]\d{2}:?\d{2}$/.test(end.trim())) {
    // Apple exports a local-time string with an explicit offset ("...+0200") —
    // its date part IS the local wake day, use it directly (no tz math).
    return end.slice(0, 10)
  }
  return p.date
}

// "2026-07-17 02:00:51 +0200" (Health Auto Export's local-time format) → ms.
// REAL cross-engine bug: V8 (Chrome/desktop) is lenient and parses this
// space-separated form directly, but Safari/JavaScriptCore (every iPhone,
// including the installed PWA) returns Invalid Date for it. When it did,
// sessionMs returned null → overlapping sleep sessions were treated as
// "untimed" → NOT overlap-merged → summed, so a single night with a duplicate
// re-report showed as e.g. 14h on mobile while desktop correctly showed 8.6h.
// Fix: normalize to strict ISO 8601 ("...T..HH:MM:SS+02:00") first, which
// every engine parses; fall back to the raw string only if that somehow fails.
function sessionMs(s: unknown): number | null {
  if (typeof s !== 'string') return null
  const iso = s.trim()
    .replace(' ', 'T')                              // date/time separator
    .replace(/\s*([+-]\d{2}):?(\d{2})$/, '$1:$2')   // " +0200" → "+02:00"
  let t = new Date(iso).getTime()
  if (!Number.isFinite(t)) t = new Date(s).getTime()
  return Number.isFinite(t) ? t : null
}

// Clusters pre-aggregated sessions whose [sleepStart, sleepEnd] windows
// overlap and keeps only the LONGEST (by totalSleep) session per cluster —
// overlapping windows are duplicate reports of the same sleep (old
// midnight-keyed row vs new sleepStart-keyed row after a re-export, or a
// partial "Since Last Sync" delivery), never two real simultaneous sleeps.
// Sessions with unparseable times are kept as-is (can't prove overlap).
//
// ⚠️ KNOWN LIMITATION — this merge is NOT the whole story for Apple/HAE sleep.
// Live case (night of 2026-07-17): DB had ONLY two overlapping rows,
// 02:00→07:27/4.94h and its subset 03:36→07:27/3.34h, BOTH deep=0. Keep-
// longest yields 4.94h and the site showed 4h56m — but Apple Health's own UI
// showed 8h8m for that night, with all the Deep sleep in an EARLIER session
// (~21:45→~01:00) that NEVER arrived in our DB. So the low number was a DATA-
// DELIVERY gap (HAE's aggregate + "Since Last Sync" mode split the night and
// dropped the early piece), not a merge win. Two aggregate rows carry no
// per-segment timestamps, so a lost sub-session is unrecoverable from them —
// the merge can only dedupe what actually arrived. Mitigation: run HAE's
// "Previous 7 Days" reconciliation automation (re-sends a complete night as
// ONE row, as the clean 2026-07-18 00:51→09:55/8.64h row proves). Do NOT
// "fix" this by summing overlapping rows — that double-counts the genuine
// duplicate-redelivery case.
function mergeSleepSessions(preAggregated: HealthMetric[]): HealthMetric[] {
  interface Sess { p: HealthMetric; start: number; end: number; total: number }
  const timed: Sess[] = []
  const untimed: HealthMetric[] = []
  const seenExact = new Set<string>()
  for (const p of preAggregated) {
    const start = sessionMs(p.value?.sleepStart)
    const end   = sessionMs(p.value?.sleepEnd)
    const key   = `${p.value?.sleepStart ?? p.recorded_at}`
    if (seenExact.has(key)) continue // identical session under two row keys
    seenExact.add(key)
    if (start != null && end != null && end > start) {
      timed.push({ p, start, end, total: p.value?.totalSleep ?? 0 })
    } else {
      untimed.push(p)
    }
  }
  timed.sort((a, b) => a.start - b.start)
  const kept: HealthMetric[] = [...untimed]
  let cluster: Sess[] = []
  let clusterEnd = -Infinity
  const flush = () => {
    if (cluster.length === 0) return
    kept.push(cluster.reduce((best, s) => (s.total > best.total ? s : best)).p)
    cluster = []
  }
  for (const s of timed) {
    if (s.start >= clusterEnd) flush()
    cluster.push(s)
    clusterEnd = Math.max(clusterEnd, s.end)
  }
  flush()
  return kept
}

export interface SleepSessionInterval { startMs: number; endMs: number; totalSleep: number }

// The night's distinct sleep session windows (post overlap-merge), for the
// session-interval timeline. Session-level ONLY — the source data carries no
// per-stage segment timing (verified against every live row), so this is the
// finest honest granularity available.
export function extractSleepSessions(points: HealthMetric[], nightKey: string): SleepSessionInterval[] {
  const pts = points.filter(p => sleepNightKey(p) === nightKey && typeof p.value?.totalSleep === 'number')
  return mergeSleepSessions(pts)
    .map(p => {
      const start = sessionMs(p.value?.sleepStart)
      const end   = sessionMs(p.value?.sleepEnd)
      return start != null && end != null && end > start
        ? { startMs: start, endMs: end, totalSleep: p.value?.totalSleep ?? 0 }
        : null
    })
    .filter((s): s is SleepSessionInterval => s !== null)
    .sort((a, b) => a.startMs - b.startMs)
}

// (Derived sleep metrics used to live here — a heuristic 0–100 "sleep score"
// and a clinical sleep-efficiency % — BOTH removed on explicit user decision:
// only measured values are shown for sleep. Don't reintroduce derived sleep
// metrics without asking.)

export function computeSleepSummary(points: HealthMetric[]): SleepSummary[] {
  const byDate = new Map<string, HealthMetric[]>()
  for (const p of points) {
    const key = sleepNightKey(p)
    const arr = byDate.get(key)
    if (arr) arr.push(p)
    else byDate.set(key, [p])
  }
  const result: SleepSummary[] = []
  for (const [date, pts] of byDate) {
    // A manual entry is a deliberate correction for that specific night — it
    // must win over synced Watch data for the same date, not just get summed
    // or shadowed by it. Real bug this fixes: whenever ANY Watch point (even
    // a pre-aggregated one) existed for a date, the branch below took it
    // unconditionally and never looked at the manual per-segment rows for
    // that same date, so a manual backfill silently never showed up whenever
    // the Watch had already reported something.
    const manualPts = pts.filter(p => p.source === 'manual')
    const sourcePts = manualPts.length > 0 ? manualPts : pts

    const preAggregated = sourcePts.filter(p => typeof p.value?.totalSleep === 'number')
    if (preAggregated.length > 0) {
      // SUM every DISTINCT session for the night — a night can genuinely have
      // more than one session (interrupted sleep, nap). But sessions that
      // OVERLAP in time are the same sleep reported twice with different
      // windows (verified live: after a webhook redeploy + re-export, one
      // night had a 02:00→07:27/4.94h row AND a 03:36→…/3.34h subset row —
      // naive summing showed 8.28h for what was really 4.94h of sleep).
      // mergeSleepSessions clusters overlapping [sleepStart, sleepEnd]
      // windows and keeps only the longest session per cluster.
      const kept = mergeSleepSessions(preAggregated)
      let core = 0, rem = 0, deep = 0, awake = 0, total = 0
      for (const p of kept) {
        const v = p.value
        core += v.core ?? 0; rem += v.rem ?? 0; deep += v.deep ?? 0; awake += v.awake ?? 0
        total += v.totalSleep ?? ((v.core ?? 0) + (v.rem ?? 0) + (v.deep ?? 0))
      }
      result.push({ date, core, rem, deep, awake, total })
      continue
    }

    const stageSum: Record<string, number> = { Core: 0, REM: 0, Deep: 0, Awake: 0, Asleep: 0 }
    for (const p of sourcePts) {
      const stage = p.value?.value
      const qty = p.value?.qty
      if (typeof stage === 'string' && typeof qty === 'number' && SLEEP_STAGE_KEYS.includes(stage as typeof SLEEP_STAGE_KEYS[number])) {
        stageSum[stage] += qty
      }
    }
    const core = stageSum.Core, rem = stageSum.REM, deep = stageSum.Deep, awake = stageSum.Awake
    const total = core + rem + deep + stageSum.Asleep
    if (total > 0 || awake > 0) result.push({ date, core, rem, deep, awake, total })
  }
  return result.sort((a, b) => a.date.localeCompare(b.date))
}

// Average share of Deep/Core/REM (normalized to sum to 1) across nights with
// real stage data — used to back-fill a manually-logged night (the user only
// enters a total when the Watch wasn't worn to sleep) with a realistic
// breakdown instead of leaving it as one undifferentiated bucket. Awake time
// is deliberately excluded from the split (a manual entry has no way to know
// how long you were briefly awake, so it's left at 0 rather than guessed).
export function estimateSleepStageProportions(summaries: SleepSummary[]): { deep: number; core: number; rem: number } | null {
  const withStages = summaries
    .map(s => ({ ...s, stageTotal: s.deep + s.core + s.rem }))
    .filter(s => s.stageTotal > 0)
  if (!withStages.length) return null
  const fractions = withStages.map(s => ({ deep: s.deep / s.stageTotal, core: s.core / s.stageTotal, rem: s.rem / s.stageTotal }))
  const avgOf = (key: 'deep' | 'core' | 'rem') => fractions.reduce((sum, f) => sum + f[key], 0) / fractions.length
  return { deep: avgOf('deep'), core: avgOf('core'), rem: avgOf('rem') }
}
