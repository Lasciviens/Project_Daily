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

function isoWeekKey(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  // ISO week: Thursday of the current week determines the week-year.
  const day = (d.getDay() + 6) % 7 // Mon=0..Sun=6
  d.setDate(d.getDate() - day + 3)
  const firstThursday = new Date(d.getFullYear(), 0, 4)
  const weekNum = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7)
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

/** Monday date ('yyyy-MM-dd') of the week a given date falls in — used as the
 *  chart's x-axis label instead of the raw ISO week string. */
function mondayOf(dateStr: string): string {
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
    const wk = isoWeekKey(s.date)
    byWeek.set(wk, (byWeek.get(wk) ?? 0) + s.weight_kg * s.reps)
  }
  // Re-key by Monday date for display, carrying the ISO week's total.
  const byMonday = new Map<string, number>()
  const mondayForIsoWeek = new Map<string, string>()
  for (const s of sets) {
    const wk = isoWeekKey(s.date)
    if (!mondayForIsoWeek.has(wk)) mondayForIsoWeek.set(wk, mondayOf(s.date))
  }
  for (const [wk, total] of byWeek) {
    const monday = mondayForIsoWeek.get(wk) ?? wk
    byMonday.set(monday, total)
  }
  return [...byMonday.entries()]
    .map(([weekStart, tonnageKg]) => ({ weekStart, tonnageKg: Math.round(tonnageKg) }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
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
