// Pure aggregation functions over raw health_metrics points — collapses
// point-in-time rows (one per incoming sample, any source) into daily
// numbers for rings/summary cards/charts. Kept separate from healthApi.ts
// (which only fetches) so these are trivially unit-testable without a DB.
import { getAggregationType } from './healthMetrics'
import { defaultSourceFor } from './healthSourceDefaults'
import { todayStr, shiftDateStr } from '../../shared/utils/dateUtils'
import type { HealthMetric } from './api/healthApi'

// ── Source-family resolution (Fitbit Air integration, Phase 0) ──────────────
// CARDINAL RULE (docs/fitbit-air-integration.md): both Apple and Fitbit data
// live in the DB in full. For DISPLAY, a given (metric, day) must resolve to a
// SINGLE source family — never blend two device streams into one aggregate
// (that would double-count steps/energy or average two different HR sensors).
// The winner is the metric's default family IF it has data that day, else the
// other family present. This runs BEFORE any aggregation, in one shared place.
//
// ZERO-DRIFT GUARANTEE: today every row is Apple-family, so every day-group has
// exactly one family and the fast-path returns the points untouched — output
// is byte-identical to before this layer existed. The resolver only starts
// making choices once the Phase 3 poller writes 'fitbit' rows.

export type RowFamily = 'apple' | 'fitbit' | 'manual'

// A missing/legacy family is 'apple' — every row written before migration 062
// (and every row through the Apple webhook) is Apple-family.
export function familyOf(p: HealthMetric): RowFamily {
  const f = p.source_family
  return f === 'fitbit' || f === 'manual' ? f : 'apple'
}

// Exported so the Phase 0 verification script (scripts/verify-health-source-
// resolver.cjs) can assert the zero-drift identity property directly. Callers
// inside this module use it via the compute functions — nothing OUTSIDE resolves
// per-caller (that's the C1/H2 invariant).
export function resolveSourcePerDate(
  points: HealthMetric[],
  metricName: string,
  keyFn: (p: HealthMetric) => string = p => p.date,
): HealthMetric[] {
  // Global fast-path: if the whole set carries ≤1 distinct family (the only
  // case that exists today), there is nothing to resolve — return the SAME
  // array, so callers see identical points in identical order.
  let firstFamily: RowFamily | null = null
  let mixed = false
  for (const p of points) {
    const f = familyOf(p)
    if (firstFamily === null) firstFamily = f
    else if (f !== firstFamily) { mixed = true; break }
  }
  if (!mixed) return points

  const preferred = defaultSourceFor(metricName)
  // Winner priority when the preferred family is absent from a given day-group:
  // preferred first, then a fixed order over the remaining families. (A group
  // with two non-preferred families can't occur until real Fitbit data exists;
  // this ordering is the documented Phase-3 behaviour, inert now.)
  const priority: RowFamily[] = [preferred, 'apple', 'fitbit', 'manual']

  const byDay = new Map<string, HealthMetric[]>()
  for (const p of points) {
    const k = keyFn(p)
    const arr = byDay.get(k)
    if (arr) arr.push(p)
    else byDay.set(k, [p])
  }

  const out: HealthMetric[] = []
  for (const group of byDay.values()) {
    const present = new Set(group.map(familyOf))
    if (present.size <= 1) { out.push(...group); continue }
    const winner = priority.find(f => present.has(f)) as RowFamily
    for (const p of group) if (familyOf(p) === winner) out.push(p)
  }
  return out
}

// Health Auto Export can export active/basal energy in kJ instead of kcal
// depending on the device's locale/unit settings, even though every card in
// the Health tab labels the value "kcal" — convert so the label is honest.
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

// Collapses a group of points (any source, all merged) into a single number
// per the metric's aggregation type. Source is deliberately ignored — the
// same metric can arrive under differing source strings within one day
// (e.g. a compound "Watch|Phone" string once a second data provider joins
// partway through the day); the daily total should read as one number.
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
  const byDate = groupByDate(resolveSourcePerDate(points, metricName))
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
  const byHour = new Map<number, HealthMetric[]>()
  for (const p of resolveSourcePerDate(points, metricName)) {
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
  const byDate = groupByDate(resolveSourcePerDate(points, 'heart_rate'))
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
  for (const p of resolveSourcePerDate(points, 'heart_rate')) {
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
  if (typeof end === 'string' && /^\d{4}-\d{2}-\d{2}/.test(end)) return end.slice(0, 10)
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
// the merge can only dedupe what actually arrived. Mitigations: run HAE's
// "Previous 7 Days" reconciliation automation (re-sends a complete night as
// ONE row, as the clean 2026-07-18 00:51→09:55/8.64h row proves), and/or move
// sleep to Fitbit (below). Do NOT "fix" this by summing overlapping rows —
// that double-counts the genuine duplicate-redelivery case.
//
// ⚠️ FITBIT NOTE (the durable fix — Fitbit becomes the sleep source): Google
// Health API returns sleep as timestamped stage SEGMENTS (stages[],
// light/deep/rem/wake), so the true night is reconstructable with no aggregate
// ambiguity. It also reports one "main sleep" log plus separate NON-overlapping
// nap logs (those must keep summing) and exposes its own efficiency. Re-verify
// this merge against real Fitbit payloads before trusting it for that source.
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
  const pts = resolveSourcePerDate(points, 'sleep_analysis', sleepNightKey)
    .filter(p => sleepNightKey(p) === nightKey && typeof p.value?.totalSleep === 'number')
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
// metrics without asking. If a future source exports its own score/efficiency
// natively — Fitbit's API does for efficiency — showing THAT value is fine;
// computing our own is what was rejected.)

export function computeSleepSummary(points: HealthMetric[]): SleepSummary[] {
  const byDate = new Map<string, HealthMetric[]>()
  for (const p of resolveSourcePerDate(points, 'sleep_analysis', sleepNightKey)) {
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
    // a pre-aggregated one, regardless of source) existed for a date, the
    // branch below took it unconditionally and never looked at the manual
    // per-segment rows for that same date, so a manual backfill silently
    // never showed up whenever the Watch had already reported something.
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

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// How many preceding days computeBasalEnergyDailySeries looks at for its
// per-hour reference — callers must fetch this many extra buffer days
// before the earliest date they pass in.
export const BASAL_REFERENCE_WINDOW_DAYS = 7

// Basal (resting) energy is roughly constant hour-to-hour, so a gap from the
// Watch being off (charging, not worn, or just removed mid-hour) shouldn't
// read as zero/partial for that stretch. For every hour of the target day,
// if the Watch-measured amount is below what that SAME hour-of-day usually
// contributes, top it up to that floor instead of leaving the raw (possibly
// partial) reading. The floor is the MEDIAN of that hour across the last
// `BASAL_REFERENCE_WINDOW_DAYS` days (only days/hours that have any data) —
// median rather than a single day's average so one unusually high/low
// reference day can't skew the floor, and per-hour rather than one flat
// number so a naturally-lower-basal hour (e.g. deep sleep) isn't over-
// corrected using a naturally-higher hour's rate. `allPoints` must include
// that many extra buffer days before the earliest date in `dates`.
export function computeBasalEnergyDailySeries(allPoints: HealthMetric[], dates: string[]): DailyValue[] {
  const byDate = groupByDate(allPoints)
  const today = todayStr()
  const currentHour = new Date().getHours()

  const hourlyCache = new Map<string, number[]>()
  function hourlyFor(date: string): number[] {
    let hourly = hourlyCache.get(date)
    if (!hourly) {
      hourly = computeHourlyBuckets('basal_energy_burned', byDate.get(date) ?? []).map(h => h.value)
      hourlyCache.set(date, hourly)
    }
    return hourly
  }

  const result: DailyValue[] = []
  for (const date of dates) {
    const hourly = hourlyFor(date)
    // Don't project into hours of today that haven't happened yet.
    const maxHour = date === today ? currentHour : 23

    const referenceByHour = Array.from({ length: 24 }, (_, h) => {
      const samples: number[] = []
      for (let d = 1; d <= BASAL_REFERENCE_WINDOW_DAYS; d++) {
        const v = hourlyFor(shiftDateStr(date, -d))[h]
        if (v > 0) samples.push(v)
      }
      return samples.length ? median(samples) : null
    })

    let total = 0
    for (let h = 0; h <= maxHour; h++) {
      const ref = referenceByHour[h]
      total += ref != null ? Math.max(hourly[h], ref) : hourly[h]
    }
    if (total > 0 || (byDate.get(date) ?? []).length) result.push({ date, value: Math.round(total * 10) / 10 })
  }
  return result
}
