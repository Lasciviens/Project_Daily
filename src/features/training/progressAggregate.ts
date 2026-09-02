// Pure aggregation functions for the Training "Progress" tab (exercise
// progression, weekly volume trend, training consistency) — kept import-free
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
   *  routine) session. Used by progressDecisions.ts to scope "current
   *  program" history; unused by every function in this file. */
  routine_id?:      string | null
  /** hevy_sets.rpe — optional effort rating (0-10), null when not logged.
   *  100% null in this app's real data as of 2026-09-01, but the schema
   *  supports it and progressDecisions.ts uses it as bonus evidence once
   *  the athlete starts logging it — never a required field. */
  rpe?:             number | null
}

export interface ProgressTemplateRow {
  id:   string
  type: string // Hevy's CustomExerciseType — kept as string, see HevyExerciseTemplate
}

// ── Est. 1RM (Epley) ────────────────────────────────────────────────────────
// Matches the existing Personal Records feature's formula EXACTLY (same
// number must never appear as two different "1RM"s on two screens).
// Epley/Brzycki both carry material error above ~12 reps (commonly cited
// ~±10% even at ≤10 reps) — sets outside that range are not eligible.
const EST_1RM_MAX_REPS = 12

export function est1RM(weightKg: number, reps: number): number | null {
  if (reps <= 0 || reps > EST_1RM_MAX_REPS) return null
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

export interface ExerciseSessionPoint {
  date:   string
  /** The metric this session's "top set" produced, per metricKindForExerciseType
   *  — null when no eligible set exists that session (e.g. every set was >12
   *  reps for an est1rm-type exercise). */
  topValue: number | null
  /** Total volume (Σ weight_kg × reps) across included working sets this
   *  session — meaningful only when weight_kg is populated; null otherwise
   *  (bodyweight_reps/duration/distance types have no weight-based volume). */
  volume: number | null
  /** The literal best set's own weight/reps, for tooltips regardless of
   *  which derived metric is plotted. */
  topWeightKg: number | null
  topReps:     number | null
}

/** One exercise's progression across every session it appears in, within the
 *  rows already fetched. `warmup` sets are excluded entirely (matches the
 *  Muscles feature's own convention); `dropset`/`failure` are included — a
 *  dropset structurally can't win the "best set" selection (it follows a
 *  heavier set by construction), and a failure set is a real top effort that
 *  must stay eligible. */
export function computeExerciseProgression(
  sets: ProgressSetRow[],
  templateId: string,
  metricKind: ProgressMetricKind,
): ExerciseSessionPoint[] {
  const bySession = new Map<string, ProgressSetRow[]>()
  for (const s of sets) {
    if (s.exercise_template_id !== templateId) continue
    if (s.set_type === 'warmup') continue
    const key = `${s.date}|${s.workout_id}`
    const arr = bySession.get(key)
    if (arr) arr.push(s)
    else bySession.set(key, [s])
  }

  const out: ExerciseSessionPoint[] = []
  for (const [key, rows] of bySession) {
    const date = key.split('|')[0]

    // "Best set" selection per metric kind — never an average (see the
    // strength-coach review: averaging a top set with backoff sets is
    // volume-of-sets-dependent and misleading).
    let best: ProgressSetRow | null = null
    let bestScore = -Infinity
    for (const r of rows) {
      let score: number | null = null
      if (metricKind === 'est1rm' && r.weight_kg != null && r.reps != null) {
        score = est1RM(r.weight_kg, r.reps)
      } else if (metricKind === 'reps' && r.reps != null) {
        score = r.reps
      } else if (metricKind === 'addedWeight' && r.weight_kg != null) {
        score = r.weight_kg
      } else if (metricKind === 'assistedWeight' && r.weight_kg != null) {
        // Inverted: LESS assistance is the improvement — see progress-tab
        // guardrail copy. Selection still picks the "best" (least assisted)
        // set of the session by negating for comparison.
        score = -r.weight_kg
      } else if (metricKind === 'duration' && r.duration_seconds != null) {
        score = r.duration_seconds
      } else if (metricKind === 'distance' && r.distance_meters != null) {
        score = r.distance_meters
      }
      if (score != null && score > bestScore) { bestScore = score; best = r }
    }

    let topValue: number | null = null
    if (best) {
      if (metricKind === 'est1rm') topValue = best.weight_kg != null && best.reps != null ? est1RM(best.weight_kg, best.reps) : null
      else if (metricKind === 'reps') topValue = best.reps
      else if (metricKind === 'addedWeight') topValue = best.weight_kg
      else if (metricKind === 'assistedWeight') topValue = best.weight_kg
      else if (metricKind === 'duration') topValue = best.duration_seconds
      else if (metricKind === 'distance') topValue = best.distance_meters
    }

    // Volume is always Σ weight×reps across the session's included sets,
    // regardless of which metric is being plotted — only meaningful (non-null)
    // when at least one set has both fields.
    let volume: number | null = null
    for (const r of rows) {
      if (r.weight_kg != null && r.reps != null) volume = (volume ?? 0) + r.weight_kg * r.reps
    }

    out.push({
      date, topValue, volume,
      topWeightKg: best?.weight_kg ?? null,
      topReps: best?.reps ?? null,
    })
  }

  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/** Whether the plotted exercise's rep range varied enough across the period
 *  to warrant the rep-range-change caveat (strength-coach spec: ±4 reps). */
export function repRangeVariedSignificantly(points: ExerciseSessionPoint[]): boolean {
  const reps = points.map(p => p.topReps).filter((r): r is number => r != null)
  if (reps.length < 2) return false
  return Math.max(...reps) - Math.min(...reps) >= 4
}

// ── Weekly volume trend ─────────────────────────────────────────────────────
// Only exercise types where weight×reps is a real "load" quantity contribute
// — duration/distance/reps-only types have no weight-based tonnage and would
// otherwise silently mix apples and oranges into one number.
const TONNAGE_TYPES = new Set(['weight_reps', 'short_distance_weight', 'bodyweight_weighted'])

/** Monday date ('yyyy-MM-dd') of the week a given date falls in — used as the
 *  chart's x-axis label instead of the raw ISO week string. Exported so
 *  recoveryAggregate.ts (sleep/resting-HR weekly grouping) and the
 *  weekly-change-flags helper below key their own weeks identically to this
 *  file's — one definition of "a week" for the whole Progress tab. */
export function mondayOf(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface WeeklyVolumePoint {
  weekStart: string // Monday, 'yyyy-MM-dd'
  tonnageKg: number
}

export function computeWeeklyVolumeTrend(
  sets: ProgressSetRow[],
  templates: ProgressTemplateRow[],
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
  if (byWeek.size === 0) return []

  // DENSE series — every week from the first tonnage week to the last,
  // untrained-for-tonnage weeks included as an explicit zero. Real bug this
  // fixes (sports-scientist review, 2026-09-01): a sparse series (only weeks
  // with tonnage) meant `rollingAverage` silently averaged the last N ARRAY
  // ENTRIES rather than the last N CALENDAR weeks — after a break, a
  // "4-week average" could quietly span 7+ real weeks — and the chart's own
  // x-axis spacing didn't correspond to elapsed time. Same technique as
  // computeConsistencyByWeek; this is also what lets trainingInsights.ts's
  // calendar-anchored `shiftWeek` lookups and this chart agree on the exact
  // same number for the same week.
  const weeks = [...byWeek.keys()].sort()
  const out: WeeklyVolumePoint[] = []
  let cursor = new Date(weeks[0] + 'T00:00:00')
  const last = new Date(weeks[weeks.length - 1] + 'T00:00:00')
  while (cursor <= last) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
    out.push({ weekStart: key, tonnageKg: Math.round(byWeek.get(key) ?? 0) })
    cursor.setDate(cursor.getDate() + 7)
  }
  return out
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

// ── Training consistency ────────────────────────────────────────────────────
export interface ConsistencyWeek {
  weekStart: string // Monday
  sessionCount: number
}

export function computeConsistencyByWeek(sets: ProgressSetRow[]): ConsistencyWeek[] {
  const workoutsByMonday = new Map<string, Set<string>>()
  for (const s of sets) {
    const monday = mondayOf(s.date)
    const set = workoutsByMonday.get(monday) ?? new Set<string>()
    set.add(s.workout_id)
    workoutsByMonday.set(monday, set)
  }
  if (workoutsByMonday.size === 0) return []

  // DENSE series — every calendar week from first to last, INCLUDING weeks
  // with zero sessions. Real bug this fixes: a sparse map (only weeks that
  // have at least one row) makes a genuine gap week invisible to
  // currentStreakWeeks below — two weeks with sessions either side of a
  // completely untrained week would read as one unbroken streak instead of
  // a streak of 1, because there was no zero-session entry between them to
  // stop the scan at.
  const mondays = [...workoutsByMonday.keys()].sort()
  const out: ConsistencyWeek[] = []
  let cursor = new Date(mondays[0] + 'T00:00:00')
  const last = new Date(mondays[mondays.length - 1] + 'T00:00:00')
  while (cursor <= last) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
    out.push({ weekStart: key, sessionCount: workoutsByMonday.get(key)?.size ?? 0 })
    cursor.setDate(cursor.getDate() + 7)
  }
  return out
}

/** Current streak of consecutive weeks (most recent first) with at least
 *  `minSessions` logged sessions — stops at the first gap. */
export function currentStreakWeeks(weeks: ConsistencyWeek[], minSessions = 1): number {
  let streak = 0
  for (let i = weeks.length - 1; i >= 0; i--) {
    if (weeks[i].sessionCount >= minSessions) streak++
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

/** Combines one exercise's own session points (from computeExerciseProgression
 *  with metricKind='est1rm') with resolved bodyweight to produce a
 *  strength-per-bodyweight trend. Sessions with no usable bodyweight nearby
 *  are dropped rather than guessed — see resolveBodyweightForDate. */
export function computeRelativeStrengthTrend(
  points: ExerciseSessionPoint[],
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
 *  convention); dropsets and failure sets ARE counted — a real dose, matching
 *  computeExerciseProgression's own eligibility — which does bias toward the
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

// ── Weekly change flags ("Big changes this week") ───────────────────────────
// Ships INSTEAD OF an acute:chronic workload ratio (ACWR) — a strength-coach
// review explicitly advised against ACWR here: its injury-prediction evidence
// is team-sport running/GPS load, it has drawn sustained statistical
// criticism (mathematical coupling between the acute and chronic windows,
// unstable "sweet spot" thresholds), and this app's OWN Weekly Volume
// guardrail already tells the user tonnage conflates load and reps — you
// can't build a risk flag on a quantity already documented as ambiguous, and
// a solo lifter's log has none of the sample size the original research
// relied on. This mechanical, per-exercise, no-score, no-colour alternative
// only ever asks "did this go up sharply versus your OWN last month" — never
// "is this risky".
export type WeeklyChangeKind = 'new' | 'load' | 'volume'
export interface WeeklyChangeFlag {
  templateId: string
  kind: WeeklyChangeKind
  /** Present for 'load'/'volume' — fraction, e.g. 0.12 for +12%. */
  pct?: number
  thisWeekValue?: number
  priorMedian?: number
}

const LOAD_JUMP_PCT = 0.10
const SET_JUMP_PCT = 0.30
const MIN_PRIOR_WEEKS = 3
const NOVEL_GAP_WEEKS = 8

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Per-exercise week-over-week change detection for the exercises trained in
 *  the week containing `anchorDate`. Compares this week's top-set metric and
 *  working-set count against the MEDIAN of up to the 4 preceding weeks this
 *  exercise appears in (median, not mean, so one deload week can't manufacture
 *  a flag on the return). An exercise with no appearance in the last
 *  NOVEL_GAP_WEEKS weeks (or ever) is flagged 'new' unconditionally — no
 *  threshold needed, since unfamiliar-movement soreness is a real, common,
 *  and otherwise-invisible pattern in this data. */
export function computeWeeklyChangeFlags(
  sets: ProgressSetRow[],
  templates: ProgressTemplateRow[],
  anchorDate: string,
): WeeklyChangeFlag[] {
  const typeById = new Map(templates.map(t => [t.id, t.type]))
  const currentWeek = mondayOf(anchorDate)

  interface WeekEntry { best: number | null; setCount: number }
  const weeklyByTemplate = new Map<string, Map<string, WeekEntry>>()

  for (const s of sets) {
    if (s.set_type === 'warmup') continue
    const type = typeById.get(s.exercise_template_id)
    if (!type) continue
    const metricKind = metricKindForExerciseType(type)
    const week = mondayOf(s.date)

    let byWeek = weeklyByTemplate.get(s.exercise_template_id)
    if (!byWeek) { byWeek = new Map(); weeklyByTemplate.set(s.exercise_template_id, byWeek) }
    let entry = byWeek.get(week)
    if (!entry) { entry = { best: null, setCount: 0 }; byWeek.set(week, entry) }
    entry.setCount++

    let score: number | null = null
    if (metricKind === 'est1rm' && s.weight_kg != null && s.reps != null) score = est1RM(s.weight_kg, s.reps)
    else if (metricKind === 'reps' && s.reps != null) score = s.reps
    else if (metricKind === 'addedWeight' && s.weight_kg != null) score = s.weight_kg
    else if (metricKind === 'assistedWeight' && s.weight_kg != null) score = -s.weight_kg
    else if (metricKind === 'duration' && s.duration_seconds != null) score = s.duration_seconds
    else if (metricKind === 'distance' && s.distance_meters != null) score = s.distance_meters
    if (score != null && (entry.best == null || score > entry.best)) entry.best = score
  }

  const out: WeeklyChangeFlag[] = []
  for (const [templateId, byWeek] of weeklyByTemplate) {
    const thisWeek = byWeek.get(currentWeek)
    if (!thisWeek) continue

    const priorWeekKeys = [...byWeek.keys()].filter(w => w < currentWeek).sort()
    const lastTrainedWeek = priorWeekKeys[priorWeekKeys.length - 1]
    const weeksSinceLast = lastTrainedWeek
      ? Math.round(daysBetween(lastTrainedWeek, currentWeek) / 7)
      : Infinity

    if (!lastTrainedWeek || weeksSinceLast >= NOVEL_GAP_WEEKS) {
      out.push({ templateId, kind: 'new' })
      continue
    }

    const window = priorWeekKeys.slice(-4)
    if (window.length < MIN_PRIOR_WEEKS) continue

    const priorBests = window.map(w => byWeek.get(w)!.best).filter((v): v is number => v != null)
    if (priorBests.length > 0 && thisWeek.best != null) {
      const medianBest = median(priorBests)
      if (medianBest > 0) {
        const pct = thisWeek.best / medianBest - 1
        if (pct >= LOAD_JUMP_PCT) out.push({ templateId, kind: 'load', pct, thisWeekValue: thisWeek.best, priorMedian: medianBest })
      }
    }

    const priorSetCounts = window.map(w => byWeek.get(w)!.setCount)
    const medianSets = median(priorSetCounts)
    if (medianSets > 0) {
      const pct = thisWeek.setCount / medianSets - 1
      if (pct >= SET_JUMP_PCT) out.push({ templateId, kind: 'volume', pct, thisWeekValue: thisWeek.setCount, priorMedian: medianSets })
    }
  }

  return out
}

// ── Weekly sets per muscle (trend, not a snapshot) ──────────────────────────
// The Muscles tab already shows weekly-equivalent sets/muscle for a single
// rolling window (30/90 days). This is the sports-scientist review's top
// pick for "what else": the SAME currency — hard sets/muscle/week, the one
// training measure in this app with an actual dose-response meta-analysis
// behind it (Schoenfeld 2017; Pelland 2025) — but as a per-week TREND, reusing
// muscleMap.ts's contribution()/HEVY_TO_SLUG exactly rather than a second,
// parallel volume model.
export interface MuscleWeekEntry { templateId: string; primarySlug: string | null; secondarySlugs: string[] }
export interface MuscleWeeklyPoint { weekStart: string; sets: number }

export function computeWeeklySetsPerMuscleTrend(
  sets: ProgressSetRow[],
  templateMuscles: Map<string, { primarySlug: string | null; secondarySlugs: string[] }>,
  slug: string,
  contributionFn: (templateId: string, slug: string, role: 'primary' | 'secondary') => number,
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
  return [...byWeek.entries()]
    .map(([weekStart, total]) => ({ weekStart, sets: Math.round(total * 10) / 10 }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}

export interface CurrentWeekMuscleDose {
  completedSets: number
  remainingPlannedSets: number
  workoutsCompleted: number
  workoutsPlanned: number
  /** A soft read only — "have I kept pace with what's already happened this
   *  week", never "am I behind for the week" (the week isn't over yet). */
  status: 'on_track' | 'behind_pace' | null
}

/** The in-progress current week is judged SEPARATELY from complete weeks —
 *  a real bug, reported live: a Wednesday with 2 of 4 workouts done showed a
 *  "-7.5 sets" deficit against the FULL week's plan, before the week had
 *  even happened. This never returns a deficit/gap for the current week —
 *  only an informational completed/remaining breakdown plus a soft
 *  "on_track"/"behind_pace" read of whether the sets actually logged keep
 *  pace with the routines actually done so far (never with the whole week's
 *  plan, which by definition can't be met until the week is over).
 *  `remainingPlannedSets` must be computed from the REAL structure of
 *  whichever routines haven't been trained yet this week (not a
 *  proportional guess) — different routines can load a given muscle very
 *  differently, so an even split across remaining workouts would misstate
 *  it. `status` is null once nothing has been trained yet this week (too
 *  early to say anything) or there's no plan to compare against at all. */
export function computeCurrentWeekMuscleDose(params: {
  routineExpectation: number | null
  completedSets: number
  remainingPlannedSets: number
  workoutsCompleted: number
  workoutsPlanned: number
}): CurrentWeekMuscleDose | null {
  const { routineExpectation, completedSets, remainingPlannedSets, workoutsCompleted, workoutsPlanned } = params
  if (workoutsPlanned <= 0 || routineExpectation == null) return null
  const expectedFromRoutinesDoneSoFar = Math.max(0, routineExpectation - remainingPlannedSets)
  const status: CurrentWeekMuscleDose['status'] =
    workoutsCompleted === 0 ? null : completedSets >= expectedFromRoutinesDoneSoFar * 0.85 ? 'on_track' : 'behind_pace'
  return { completedSets, remainingPlannedSets, workoutsCompleted, workoutsPlanned, status }
}
