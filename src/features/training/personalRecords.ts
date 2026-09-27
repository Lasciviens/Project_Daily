// Personal records — pure and import-free apart from the one e1RM formula
// (scripts/verify-hevy-training.cjs). hevyApi.fetchHevyPRs pages every
// working set in and hands them here.
//
// ONE definition, the same as the progress engine's LOAD_PR, just all-time:
//   - Working sets only: 'normal' and 'failure' (a failure set is often the
//     heaviest real effort). Warm-ups and drop sets never count — a drop set
//     is lighter by construction.
//   - What "best" means follows how the exercise is logged
//     (metricKindForExerciseType):
//       weight × reps, weighted bodyweight → heaviest weight
//       assisted bodyweight                → LEAST assistance (the weight is
//                                            the help; less help is harder)
//       reps only / bodyweight reps        → most reps
//       duration                           → longest set
//       distance                           → longest distance
//   - Ties: more reps first, then the day it was FIRST achieved (a record is
//     set once; matching it later doesn't move the date), then set id — so
//     the same data always gives the same record.
//   - The estimated 1RM uses the shared est1RM (12-rep cap); it's reported as
//     the best estimate over all eligible sets, never a second formula.

import { est1RM, metricKindForExerciseType, type ProgressMetricKind } from './progressAggregate'

export const PR_SET_TYPES = ['normal', 'failure'] as const

export interface PRSetInput {
  id:                   string
  exercise_template_id: string
  workout_id:           string
  /** The workout's effective timestamp (start_time, else hevy_created_at). */
  performed_at:         string
  type:                 string
  weight_kg:            number | null
  reps:                 number | null
  duration_seconds:     number | null
  distance_meters:      number | null
}

export interface PRTemplateInput {
  id:                   string
  title:                string
  type:                 string
  primary_muscle_group: string | null
}

export interface PersonalRecord {
  exercise_template_id: string
  title:                string
  primary_muscle_group: string | null
  exercise_type:        string
  metric_kind:          ProgressMetricKind
  /** The record set itself. */
  weight_kg:            number | null
  reps:                 number | null
  duration_seconds:     number | null
  distance_meters:      number | null
  /** The ranked number in the metric's own unit (kg, reps, seconds, metres). */
  best_value:           number
  /** Best est. 1RM over every eligible set (≤12 reps), weight × reps only. */
  best_est_1rm:         number | null
  /** When the record was first set (the workout's effective timestamp). */
  achieved_at:          string
  /** Distinct workouts with at least one working set of this exercise. */
  times_performed:      number
}

/** Only these belong on a "heaviest lifts" leaderboard — an assisted
 *  pull-up's assistance or a plank's seconds aren't comparable to a squat. */
export function isLoadRecord(pr: Pick<PersonalRecord, 'metric_kind'>): boolean {
  return pr.metric_kind === 'est1rm'
}

function valueOf(s: PRSetInput, kind: ProgressMetricKind): number | null {
  switch (kind) {
    case 'est1rm':
      return s.weight_kg != null && s.weight_kg > 0 && s.reps != null && s.reps > 0 ? s.weight_kg : null
    case 'addedWeight':
    case 'assistedWeight':
      return s.weight_kg != null && s.weight_kg >= 0 && s.reps != null && s.reps > 0 ? s.weight_kg : null
    case 'reps':
      return s.reps != null && s.reps > 0 ? s.reps : null
    case 'duration':
      return s.duration_seconds != null && s.duration_seconds > 0 ? s.duration_seconds : null
    case 'distance':
      return s.distance_meters != null && s.distance_meters > 0 ? s.distance_meters : null
  }
}

/** Negative when `a` is the better record. */
function compare(a: { s: PRSetInput; v: number }, b: { s: PRSetInput; v: number }, kind: ProgressMetricKind): number {
  if (a.v !== b.v) {
    const lowerIsBetter = kind === 'assistedWeight'
    return lowerIsBetter ? a.v - b.v : b.v - a.v
  }
  const ra = a.s.reps ?? -1, rb = b.s.reps ?? -1
  if (ra !== rb) return rb - ra
  if (a.s.performed_at !== b.s.performed_at) return a.s.performed_at < b.s.performed_at ? -1 : 1
  return a.s.id < b.s.id ? -1 : a.s.id > b.s.id ? 1 : 0
}

export function computePersonalRecords(sets: readonly PRSetInput[], templates: readonly PRTemplateInput[]): PersonalRecord[] {
  const templateById = new Map(templates.map(t => [t.id, t]))
  const best = new Map<string, { s: PRSetInput; v: number }>()
  const bestE1rm = new Map<string, number>()
  const workouts = new Map<string, Set<string>>()
  const working = new Set<string>(PR_SET_TYPES)

  for (const s of sets) {
    if (!working.has(s.type)) continue
    const t = templateById.get(s.exercise_template_id)
    if (!t) continue
    const kind = metricKindForExerciseType(t.type)

    let ids = workouts.get(t.id)
    if (!ids) { ids = new Set(); workouts.set(t.id, ids) }
    ids.add(s.workout_id)

    if (kind === 'est1rm' && s.weight_kg != null && s.weight_kg > 0) {
      const e = est1RM(s.weight_kg, s.reps)
      if (e != null && e > (bestE1rm.get(t.id) ?? -Infinity)) bestE1rm.set(t.id, e)
    }

    const v = valueOf(s, kind)
    if (v == null) continue
    const cand = { s, v }
    const cur = best.get(t.id)
    if (!cur || compare(cand, cur, kind) < 0) best.set(t.id, cand)
  }

  const out: PersonalRecord[] = []
  for (const [templateId, { s, v }] of best) {
    const t = templateById.get(templateId) as PRTemplateInput
    out.push({
      exercise_template_id: templateId,
      title:                t.title,
      primary_muscle_group: t.primary_muscle_group,
      exercise_type:        t.type,
      metric_kind:          metricKindForExerciseType(t.type),
      weight_kg:            s.weight_kg,
      reps:                 s.reps,
      duration_seconds:     s.duration_seconds,
      distance_meters:      s.distance_meters,
      best_value:           v,
      best_est_1rm:         bestE1rm.get(templateId) ?? null,
      achieved_at:          s.performed_at,
      times_performed:      workouts.get(templateId)?.size ?? 1,
    })
  }
  return out.sort((a, b) => a.title.localeCompare(b.title) || a.exercise_template_id.localeCompare(b.exercise_template_id))
}

/** Heaviest `n` load records (weight × reps exercises only), optionally
 *  within one primary muscle group; `minTimes` drops one-off lifts. */
export function topLoadRecords(prs: readonly PersonalRecord[], n: number, opts: { muscle?: string | null; minTimes?: number } = {}): PersonalRecord[] {
  return prs
    .filter(pr => isLoadRecord(pr) && pr.times_performed >= (opts.minTimes ?? 0))
    .filter(pr => !opts.muscle || pr.primary_muscle_group === opts.muscle)
    .sort((a, b) => b.best_value - a.best_value || (b.reps ?? 0) - (a.reps ?? 0) || a.title.localeCompare(b.title))
    .slice(0, n)
}
