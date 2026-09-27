// The headline numbers of one logged Hevy workout — pure, type-only imports
// plus the (import-free) tonnage rule (scripts/verify-training-log.cjs).
// Warm-ups never count; volume uses the same exercise types as the weekly
// volume chart (progressAggregate TONNAGE_TYPES), so the two agree.

import { TONNAGE_TYPES } from './progressAggregate'
import type { HevySet, HevyWorkoutExercise } from './types.hevy'

export interface TopSet {
  exerciseId: string
  title: string
  /** Hevy exercise type, for the set formatter. */
  type: string | null
  set: HevySet
}

export interface WorkoutSessionStats {
  exercises: number
  workingSets: number
  warmupSets: number
  /** Σ weight × reps of working sets on weighted exercises, kg; null when none. */
  volumeKg: number | null
  /** Mean RPE of the working sets that carry one; null when none do. */
  avgRpe: number | null
  ratedSets: number
  topSets: TopSet[]
}

const num = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

const WEIGHT_FIRST = new Set(['weight_reps', 'short_distance_weight', 'weight_distance', 'weight_duration', 'bodyweight_weighted'])
const REPS_ONLY = new Set(['reps_only', 'bodyweight_reps'])
const DURATION = new Set(['duration', 'floors_duration', 'steps_duration'])

/** Positive when `a` is the better (top) set for this exercise type. */
export function compareSets(a: HevySet, b: HevySet, type: string | null | undefined): number {
  const t = type ?? ''
  if (t === 'bodyweight_assisted') {
    // The weight is ASSISTANCE: less of it is harder, then more reps.
    return (num(b.weight_kg) - num(a.weight_kg)) || (num(a.reps) - num(b.reps))
  }
  if (REPS_ONLY.has(t)) return (num(a.reps) - num(b.reps)) || (num(a.weight_kg) - num(b.weight_kg))
  if (DURATION.has(t)) return (num(a.duration_seconds) - num(b.duration_seconds)) || (num(a.custom_metric) - num(b.custom_metric))
  if (t === 'distance_duration') {
    // Farther, then faster.
    return (num(a.distance_meters) - num(b.distance_meters)) || (num(b.duration_seconds) - num(a.duration_seconds))
  }
  if (WEIGHT_FIRST.has(t) || !t) {
    return (num(a.weight_kg) - num(b.weight_kg)) || (num(a.reps) - num(b.reps))
      || (num(a.duration_seconds) - num(b.duration_seconds)) || (num(a.distance_meters) - num(b.distance_meters))
  }
  return (num(a.weight_kg) - num(b.weight_kg)) || (num(a.reps) - num(b.reps))
}

export function summarizeWorkout(exercises: readonly HevyWorkoutExercise[]): WorkoutSessionStats {
  let workingSets = 0
  let warmupSets = 0
  let volume = 0
  let volumeSets = 0
  let rpeSum = 0
  let ratedSets = 0
  const topSets: TopSet[] = []

  const ordered = [...exercises].sort((a, b) => a.index - b.index)
  for (const ex of ordered) {
    const type = ex.template?.type ?? null
    const working = (ex.sets ?? []).filter(s => s.type !== 'warmup')
    warmupSets += (ex.sets ?? []).length - working.length
    workingSets += working.length
    for (const s of working) {
      if (type && TONNAGE_TYPES.has(type) && s.weight_kg != null && s.reps != null) {
        volume += s.weight_kg * s.reps
        volumeSets++
      }
      if (typeof s.rpe === 'number' && Number.isFinite(s.rpe)) { rpeSum += s.rpe; ratedSets++ }
    }
    if (working.length === 0) continue
    const best = working.reduce((top, s) => (compareSets(s, top, type) > 0 ? s : top))
    topSets.push({ exerciseId: ex.id, title: ex.title, type, set: best })
  }

  return {
    exercises: ordered.length,
    workingSets,
    warmupSets,
    volumeKg: volumeSets > 0 ? Math.round(volume) : null,
    avgRpe: ratedSets > 0 ? Math.round((rpeSum / ratedSets) * 10) / 10 : null,
    ratedSets,
    topSets,
  }
}
