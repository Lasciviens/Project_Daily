// Pure aggregation functions for the Training "Progress" tab (the e1RM
// formula, metric dispatch, weekly volume, sessions per week, relative
// strength, rep ranges, sets per muscle) — kept import-free
// (no supabase client, no React) so it's testable via sucrase, matching the
// health/dayAgenda convention elsewhere in this repo.
//
// Built from a strength-coach + sports-scientist agent review (2026-08-28):
// see the metric-per-exercise-type mapping below — a single universal
// weight×reps formula silently misrenders for bodyweight/duration-based
// exercises, which is the actual gap this file exists to close (the existing
// Personal-Records feature only ever implicitly handled the weight_reps case).

export interface ProgressSetRow {
  workout_id:       string
  date:             string // 'yyyy-MM-dd', the workout's own day
  exercise_template_id: string
  set_type:         'normal' | 'warmup' | 'dropset' | 'failure'
  weight_kg:        number | null
  reps:             number | null
  duration_seconds: number | null
  distance_meters:  number | null
  /** The workout's own hevy_workouts.routine_id — null for a freeform (no
   *  routine) session. Used by progress-engine/program.ts to scope "current
   *  program" history and to find when each routine was last trained. */
  routine_id?:      string | null
  /** hevy_sets.rpe — optional effort rating (0-10), null when not logged.
   *  Carried for display only; no decision in this app depends on it. */
  rpe?:             number | null
  /** hevy_sets.index — the set's own order within its exercise, e.g. for
   *  building a real ordered set vector (progress-engine/normalize.ts).
   *  Optional so existing callers that never fetch it keep working. */
  set_index?:       number
  /** hevy_workouts.title — e.g. "Pull Day". Optional for the same reason. */
  workout_title?:   string | null
}

export interface ProgressTemplateRow {
  id:   string
  type: string // Hevy's CustomExerciseType — kept as string, see HevyExerciseTemplate
}

// ── Est. 1RM (Epley) ────────────────────────────────────────────────────────
// THE one estimated-1RM formula in the app — the progress engine, the charts
// and the Personal Records list all import this; never re-implement it (two
// formulas once put two different "1RM"s for the same set on two screens).
// Epley/Brzycki both carry material error above ~12 reps (commonly cited
// ~±10% even at ≤10 reps) — sets outside that range are not eligible and
// return null, which a caller shows as "n/a above 12 reps", never a number.
export const EST_1RM_MAX_REPS = 12

export function est1RM(weightKg: number, reps: number | null | undefined): number | null {
  if (reps == null || !Number.isFinite(weightKg) || reps <= 0 || reps > EST_1RM_MAX_REPS) return null
  if (reps === 1) return weightKg
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10
}

// ── Per-exercise-type metric dispatch ───────────────────────────────────────
// The real fix this file is for: which number actually represents "getting
// better" depends on HOW the exercise is logged. Getting this wrong either
// silently omits an exercise from the chart or draws a nonsense line (e.g. an
// assisted-pullup chart where MORE assistance reads as "progress").
export type ProgressMetricKind = 'est1rm' | 'reps' | 'addedWeight' | 'assistedWeight' | 'duration' | 'distance'

export function metricKindForExerciseType(type: string): ProgressMetricKind {
  switch (type) {
    case 'weight_reps':
    case 'short_distance_weight':
      return 'est1rm'
    case 'bodyweight_reps':
    case 'reps_only':
      return 'reps'
    case 'bodyweight_weighted':
      return 'addedWeight'
    case 'bodyweight_assisted':
      return 'assistedWeight'
    case 'duration':
    case 'weight_duration':
      return 'duration'
    case 'distance_duration':
    case 'floors_duration':
    case 'steps_duration':
      return 'distance'
    default:
      return 'est1rm'
  }
}

// ── Week keys ───────────────────────────────────────────────────────────────
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Monday date ('yyyy-MM-dd') of the LOCAL week a local date falls in — the
 *  one definition of "a week" for the whole Progress tab (recoveryAggregate.ts
 *  keys its sleep/resting-HR weeks the same way via shared mondayOfStr). */
export function mondayOf(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day)
  return ymd(d)
}

/** A week key shifted by N whole weeks (negative = earlier). */
export function shiftWeek(weekStart: string, weeks: number): string {
  const d = new Date(weekStart + 'T00:00:00')
  d.setDate(d.getDate() + weeks * 7)
  return ymd(d)
}

/** The last calendar week that's actually finished — a partial current week
 *  always looks like a collapse, so every trend and "last week" read uses
 *  this, never the week `today` falls in. `today` must be a LOCAL date. */
export function lastCompleteWeek(today: string): string {
  return shiftWeek(mondayOf(today), -1)
}

/** Every Monday from `fromWeek` to `untilWeek` inclusive (both week keys). */
export function weeksBetween(fromWeek: string, untilWeek: string): string[] {
  const out: string[] = []
  for (let w = fromWeek; w <= untilWeek; w = shiftWeek(w, 1)) out.push(w)
  return out
}

/** The span a dense weekly series covers: from the first week with data to
 *  the later of the last week with data and `untilWeek`. Filling up to
 *  `untilWeek` (usually the last complete week, or the current week) is what
 *  keeps a break honest — a series that stops at the last logged week hides
 *  every empty week after it (a three-month break read as an unbroken
 *  streak). Returns [] when there is no data at all. */
function denseWeekKeys(dataWeeks: Iterable<string>, untilWeek?: string): string[] {
  const sorted = [...dataWeeks].sort()
  if (sorted.length === 0) return []
  const last = untilWeek && untilWeek > sorted[sorted.length - 1] ? untilWeek : sorted[sorted.length - 1]
  return weeksBetween(sorted[0], last)
}

// ── Weekly volume trend ─────────────────────────────────────────────────────
// Only exercise types where weight×reps is a real "load" quantity contribute
// — duration/distance/reps-only types have no weight-based tonnage and would
// otherwise silently mix apples and oranges into one number.
export const TONNAGE_TYPES: ReadonlySet<string> = new Set(['weight_reps', 'short_distance_weight', 'bodyweight_weighted'])

export interface WeeklyVolumePoint {
  weekStart: string // Monday, 'yyyy-MM-dd'
  tonnageKg: number
}

/** DENSE weekly tonnage: every week from the first tonnage week to
 *  max(last tonnage week, `untilWeek`), untrained weeks as an explicit zero.
 *  Dense so `rollingAverage` averages CALENDAR weeks (a sparse series once
 *  let a "4-week average" span 7+ real weeks after a break) and so a break
 *  since the last logged week shows as zeros instead of vanishing. */
export function computeWeeklyVolumeTrend(
  sets: ProgressSetRow[],
  templates: ProgressTemplateRow[],
  untilWeek?: string,
): WeeklyVolumePoint[] {
  const typeById = new Map(templates.map(t => [t.id, t.type]))
  const byWeek = new Map<string, number>()
  for (const s of sets) {
    if (s.set_type === 'warmup') continue
    if (s.weight_kg == null || s.reps == null) continue
    const type = typeById.get(s.exercise_template_id)
    if (!type || !TONNAGE_TYPES.has(type)) continue
    const wk = mondayOf(s.date)
    byWeek.set(wk, (byWeek.get(wk) ?? 0) + s.weight_kg * s.reps)
  }
  return denseWeekKeys(byWeek.keys(), untilWeek).map(weekStart => ({ weekStart, tonnageKg: Math.round(byWeek.get(weekStart) ?? 0) }))
}

/** Trailing N-week simple moving average, aligned to the same weekStart keys
 *  as `points` (nulls where fewer than N weeks of history exist yet). */
export function rollingAverage(points: WeeklyVolumePoint[], windowWeeks: number): (number | null)[] {
  return points.map((_, i) => {
    if (i < windowWeeks - 1) return null
    const slice = points.slice(i - windowWeeks + 1, i + 1)
    return Math.round(slice.reduce((a, p) => a + p.tonnageKg, 0) / windowWeeks)
  })
}

// ── Sessions per week (the ONE definition) ──────────────────────────────────
// A "session" is one distinct workout id, filed under the LOCAL day it
// happened on. Every "sessions this week" readout (Progress adherence, the
// Workouts tab, Home, the coach snapshot) should go through these so they
// agree on the same number. Callers map their own rows to {id, date}: a
// ProgressSetRow is {id: workout_id, date}; a Hevy workout is
// {id, date: localDayOf(start_time ?? hevy_created_at)}.
export interface DatedSession { id: string; date: string }

export interface ConsistencyWeek {
  weekStart: string // Monday
  sessionCount: number
}

function sessionIdsByWeek(sessions: readonly DatedSession[]): Map<string, Set<string>> {
  const byWeek = new Map<string, Set<string>>()
  for (const s of sessions) {
    const wk = mondayOf(s.date)
    const ids = byWeek.get(wk) ?? new Set<string>()
    ids.add(s.id)
    byWeek.set(wk, ids)
  }
  return byWeek
}

/** Distinct sessions in the week starting `weekStart` (0 when none). */
export function sessionsInWeek(sessions: readonly DatedSession[], weekStart: string): number {
  return sessionIdsByWeek(sessions).get(weekStart)?.size ?? 0
}

/** Distinct sessions in the calendar week `today` (a LOCAL date) falls in —
 *  Monday up to today. 0 on a Monday with nothing logged, never last week's
 *  count. */
export function sessionsThisWeek(sessions: readonly DatedSession[], today: string): number {
  return sessionsInWeek(sessions, mondayOf(today))
}

/** DENSE sessions-per-week from the first week with a session to
 *  max(last session week, `untilWeek`) — zero weeks included, so a streak or
 *  an adherence count can't glue two trained weeks across a gap, and a break
 *  since the last logged week still shows up. */
export function weeklySessionCounts(sessions: readonly DatedSession[], untilWeek?: string): ConsistencyWeek[] {
  const byWeek = sessionIdsByWeek(sessions)
  return denseWeekKeys(byWeek.keys(), untilWeek).map(weekStart => ({ weekStart, sessionCount: byWeek.get(weekStart)?.size ?? 0 }))
}

/** One DatedSession per workout in a set list. */
export function sessionsFromSets(sets: readonly Pick<ProgressSetRow, 'workout_id' | 'date'>[]): DatedSession[] {
  const seen = new Map<string, string>()
  for (const s of sets) if (!seen.has(s.workout_id)) seen.set(s.workout_id, s.date)
  return [...seen].map(([id, date]) => ({ id, date }))
}

export function computeConsistencyByWeek(sets: ProgressSetRow[], untilWeek?: string): ConsistencyWeek[] {
  return weeklySessionCounts(sessionsFromSets(sets), untilWeek)
}

/** Consecutive weeks (most recent first) with at least `minSessions`
 *  sessions — stops at the first week that falls short. When the series ends
 *  with the still-running `inProgressWeek`, that week is skipped rather than
 *  counted as a miss (a Tuesday hasn't failed the week yet) — unless it has
 *  already met the bar, in which case it counts. */
export function currentStreakWeeks(weeks: ConsistencyWeek[], minSessions = 1, inProgressWeek?: string): number {
  let streak = 0
  for (let i = weeks.length - 1; i >= 0; i--) {
    const w = weeks[i]
    const meets = w.sessionCount >= minSessions
    if (i === weeks.length - 1 && inProgressWeek && w.weekStart === inProgressWeek && !meets) continue
    if (meets) streak++
    else break
  }
  return streak
}

// ── Relative strength vs bodyweight ─────────────────────────────────────────
// Added from a follow-up sports-scientist + strength-coach review
// (2026-08-31), reconciling their two proposals: only 'est1rm'-type exercises
// are eligible (bodyweight_weighted's "total load" variant was considered and
// dropped — two different ratio formulas on one chart is exactly the kind of
// silent misread this file exists to prevent), and the bodyweight-resolution
// ladder below is the sports-scientist's stricter version (interpolate
// between two close anchors, else nearest-within-14-days, else a real gap —
// never an indefinite carry-forward, which would flatten the denominator
// across a cut/bulk and make the ratio lie about which side changed).
export interface BodyweightAnchor { date: string; kg: number }

const MAX_INTERPOLATION_GAP_DAYS = 21
const MAX_NEAREST_ANCHOR_DAYS = 14

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86_400_000)
}

/** Resolves a session date to a bodyweight, or null when nothing nearby
 *  justifies a guess. `anchors` must be sorted ascending by date.
 *  `estimated` is true whenever the value isn't an exact same-day weigh-in —
 *  callers render those as a visually distinct (hollow) point. */
export function resolveBodyweightForDate(
  dateStr: string,
  anchors: BodyweightAnchor[],
): { kg: number; estimated: boolean } | null {
  if (anchors.length === 0) return null

  const exact = anchors.find(a => a.date === dateStr)
  if (exact) return { kg: exact.kg, estimated: false }

  let prev: BodyweightAnchor | null = null
  let next: BodyweightAnchor | null = null
  for (const a of anchors) {
    if (a.date < dateStr) prev = a
    else if (a.date > dateStr && !next) next = a
  }

  if (prev && next) {
    const span = daysBetween(prev.date, next.date)
    if (span <= MAX_INTERPOLATION_GAP_DAYS) {
      const t = daysBetween(prev.date, dateStr) / span
      return { kg: Math.round((prev.kg + t * (next.kg - prev.kg)) * 10) / 10, estimated: true }
    }
  }

  // No usable bracket (or too wide a gap) — fall back to whichever single
  // anchor is nearest, but only within 14 days. Never extrapolate before the
  // very first weigh-in: a bodyweight history usually starts because
  // something changed (a bulk, a cut), so backfilling assumes the opposite
  // of what's most likely true right where it matters most.
  const candidates = [prev, next].filter((a): a is BodyweightAnchor => a != null)
  if (candidates.length === 0) return null
  const nearest = candidates.reduce((best, a) =>
    Math.abs(daysBetween(dateStr, a.date)) < Math.abs(daysBetween(dateStr, best.date)) ? a : best)
  const gap = Math.abs(daysBetween(dateStr, nearest.date))
  return gap <= MAX_NEAREST_ANCHOR_DAYS ? { kg: nearest.kg, estimated: true } : null
}

export interface RelativeStrengthPoint {
  date: string
  ratio: number
  bodyweightKg: number
  est1rmValue: number
  estimated: boolean
}

/** One session's best estimated 1RM — the progress engine's own per-session
 *  value (progress-engine/metricStrategy.ts `sessionBestE1rm`), so this chart
 *  and the decision table read the same number for the same session. */
export interface SessionStrengthPoint { date: string; topValue: number | null }

/** Combines one exercise's per-session best e1RM with resolved bodyweight to
 *  produce a strength-per-bodyweight trend. Sessions with no usable
 *  bodyweight nearby are dropped rather than guessed — see
 *  resolveBodyweightForDate. */
export function computeRelativeStrengthTrend(
  points: readonly SessionStrengthPoint[],
  anchors: BodyweightAnchor[],
): RelativeStrengthPoint[] {
  const sorted = [...anchors].sort((a, b) => a.date.localeCompare(b.date))
  const out: RelativeStrengthPoint[] = []
  for (const p of points) {
    if (p.topValue == null) continue
    const bw = resolveBodyweightForDate(p.date, sorted)
    if (!bw) continue
    out.push({ date: p.date, ratio: Math.round((p.topValue / bw.kg) * 100) / 100, bodyweightKg: bw.kg, est1rmValue: p.topValue, estimated: bw.estimated })
  }
  return out
}

export interface IndexedStrengthPoint {
  date: string
  /** Both indexed to 100 at the window's FIRST point — "+6%"/"-4%" reads
   *  directly with no mental division, and both series share ONE axis. A
   *  follow-up sports-scientist + research review (2026-09-01) replaced the
   *  original ratio-plus-separate-bodyweight-line chart with this: the
   *  ratio forced the reader to do the attribution in their head (exactly
   *  what the chart exists to prevent), and index-to-100 is the standard
   *  finance/data-viz technique for comparing two differently-scaled series
   *  (confirmed against real precedent — no fitness app does this for a
   *  strength context specifically, but it's well-validated elsewhere and
   *  strictly clearer than a raw ratio here). */
  strengthIndex: number
  bodyweightIndex: number
  estimated: boolean
}

/** Rebase computeRelativeStrengthTrend's own est1rmValue/bodyweightKg series
 *  to 100 at the first point. Deliberately built ON TOP of the existing
 *  ratio points rather than a parallel computation — one source of the raw
 *  numbers, two presentations of them. */
export function indexRelativeStrengthTrend(points: RelativeStrengthPoint[]): IndexedStrengthPoint[] {
  if (points.length === 0) return []
  const baseStrength = points[0].est1rmValue
  const baseBodyweight = points[0].bodyweightKg
  return points.map(p => ({
    date: p.date,
    strengthIndex: Math.round((p.est1rmValue / baseStrength) * 1000) / 10,
    bodyweightIndex: Math.round((p.bodyweightKg / baseBodyweight) * 1000) / 10,
    estimated: p.estimated,
  }))
}

// ── Rep-range distribution ──────────────────────────────────────────────────
// Boundaries are the sports-scientist review's call, not the strength-coach's
// originally-proposed 1-5/6-8/9-12/13-20/21+ split: Schoenfeld et al. 2017
// (JSCR 31(12):3508-3523) and Morton et al. 2016 (J Appl Physiol 121(1):
// 129-138) find hypertrophy roughly EQUIVALENT from ~5 to ~30 reps taken near
// failure, with heavy loads specifically favouring maximal strength — there is
// no evidence for a boundary at rep 8, so this file deliberately does not draw
// one, and the buckets carry neutral rep-count labels rather than a
// "hypertrophy range" claim the literature doesn't support.
export interface RepBucket { key: string; min: number; max: number; label: string }
export const REP_BUCKETS: RepBucket[] = [
  { key: '1-5',  min: 1,  max: 5,        label: '1–5 reps' },
  { key: '6-12', min: 6,  max: 12,       label: '6–12 reps' },
  { key: '13-20',min: 13, max: 20,       label: '13–20 reps' },
  { key: '21-30',min: 21, max: 30,       label: '21–30 reps' },
  { key: '31+',  min: 31, max: Infinity, label: '31+ reps' },
]

function bucketForReps(reps: number): RepBucket {
  return REP_BUCKETS.find(b => reps >= b.min && reps <= b.max) ?? REP_BUCKETS[REP_BUCKETS.length - 1]
}

export interface RepBucketCount { key: string; label: string; count: number }

/** Whole-set counts per rep bucket. Warmups excluded (this file's standing
 *  convention); dropsets and failure sets ARE counted — a real dose — which
 *  does bias toward the
 *  higher buckets when a lifter uses them heavily (flagged in the UI copy).
 *  `templateFilter` narrows to one muscle group's primary-attributed exercises
 *  only — deliberately NOT the Muscles tab's fractional secondary credit
 *  (ROLE_WEIGHTS): a histogram counts whole sets, and crediting half a set to
 *  a second bar would double-count it. */
export function computeRepRangeDistribution(
  sets: ProgressSetRow[],
  templateIds?: Set<string>,
): RepBucketCount[] {
  const counts = new Map(REP_BUCKETS.map(b => [b.key, 0]))
  for (const s of sets) {
    if (s.set_type === 'warmup') continue
    if (s.reps == null || s.reps < 1) continue
    if (templateIds && !templateIds.has(s.exercise_template_id)) continue
    const bucket = bucketForReps(s.reps)
    counts.set(bucket.key, (counts.get(bucket.key) ?? 0) + 1)
  }
  return REP_BUCKETS.map(b => ({ key: b.key, label: b.label, count: counts.get(b.key) ?? 0 }))
}

// ── Weekly sets per muscle (trend, not a snapshot) ──────────────────────────
// The Muscles tab already shows weekly-equivalent sets/muscle for a single
// rolling window (30/90 days). This is the same currency — hard
// sets/muscle/week (Schoenfeld 2017; Pelland 2025) — as a per-week TREND,
// reusing muscleMap.ts's contribution()/HEVY_TO_SLUG exactly rather than a
// second, parallel volume model.
export interface MuscleWeeklyPoint { weekStart: string; sets: number }

/** Weekly credited sets for one muscle. With `range`, the series is DENSE
 *  from `range.fromWeek` to `range.untilWeek` (zeros included, weeks outside
 *  the range dropped) — so "last week" is always last week, never the last
 *  week this muscle happened to be trained, and two trained weeks either
 *  side of a gap never join into one line. Without `range`, only weeks with
 *  credit are returned. */
export function computeWeeklySetsPerMuscleTrend(
  sets: ProgressSetRow[],
  templateMuscles: Map<string, { primarySlug: string | null; secondarySlugs: string[] }>,
  slug: string,
  contributionFn: (templateId: string, slug: string, role: 'primary' | 'secondary') => number,
  range?: { fromWeek: string; untilWeek: string },
): MuscleWeeklyPoint[] {
  const byWeek = new Map<string, number>()
  for (const s of sets) {
    if (s.set_type === 'warmup') continue
    const muscles = templateMuscles.get(s.exercise_template_id)
    if (!muscles) continue
    let credit = 0
    if (muscles.primarySlug === slug) credit += contributionFn(s.exercise_template_id, slug, 'primary')
    if (muscles.secondarySlugs.includes(slug)) credit += contributionFn(s.exercise_template_id, slug, 'secondary')
    if (credit === 0) continue
    const week = mondayOf(s.date)
    byWeek.set(week, (byWeek.get(week) ?? 0) + credit)
  }
  const round = (n: number) => Math.round(n * 10) / 10
  if (range) {
    if (range.fromWeek > range.untilWeek) return []
    return weeksBetween(range.fromWeek, range.untilWeek).map(weekStart => ({ weekStart, sets: round(byWeek.get(weekStart) ?? 0) }))
  }
  return [...byWeek.entries()]
    .map(([weekStart, total]) => ({ weekStart, sets: round(total) }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}

// ── Bodyweight change (Progress overview KPI) ───────────────────────────────
// A raw latest-minus-older difference is dominated by day-to-day water
// swings, and silently read "0 kg over ~1 days" when the latest weigh-in was
// itself older than two weeks. This compares two short AVERAGES instead: the
// week ending at the latest weigh-in against the window 14–28 days before it.
export type BodyweightChange =
  | { kind: 'change'; deltaKg: number; recentAvgKg: number; priorAvgKg: number; days: number }
  | { kind: 'stale'; latestKg: number; daysAgo: number }
  | { kind: 'insufficient' }

const BW_STALE_DAYS = 14
const BW_RECENT_DAYS = 7
const BW_PRIOR_FROM_DAYS = 14
const BW_PRIOR_TO_DAYS = 28

export function bodyweightChange(anchors: readonly BodyweightAnchor[], today: string): BodyweightChange {
  const sorted = [...anchors].sort((a, b) => a.date.localeCompare(b.date))
  if (sorted.length === 0) return { kind: 'insufficient' }
  const latest = sorted[sorted.length - 1]
  const daysAgo = daysBetween(latest.date, today)
  if (daysAgo > BW_STALE_DAYS) return { kind: 'stale', latestKg: latest.kg, daysAgo }
  const ago = (a: BodyweightAnchor) => daysBetween(a.date, latest.date)
  const recent = sorted.filter(a => ago(a) >= 0 && ago(a) < BW_RECENT_DAYS)
  const prior = sorted.filter(a => ago(a) >= BW_PRIOR_FROM_DAYS && ago(a) <= BW_PRIOR_TO_DAYS)
  if (recent.length === 0 || prior.length === 0) return { kind: 'insufficient' }
  const avg = (xs: BodyweightAnchor[]) => xs.reduce((sum, a) => sum + a.kg, 0) / xs.length
  const recentAvgKg = Math.round(avg(recent) * 10) / 10
  const priorAvgKg = Math.round(avg(prior) * 10) / 10
  const recentMid = recent[Math.floor(recent.length / 2)].date
  const priorMid = prior[Math.floor(prior.length / 2)].date
  return { kind: 'change', deltaKg: Math.round((recentAvgKg - priorAvgKg) * 10) / 10, recentAvgKg, priorAvgKg, days: Math.max(1, daysBetween(priorMid, recentMid)) }
}
