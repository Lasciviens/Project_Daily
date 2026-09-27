import { MUSCLE_LANDMARKS, buildTemplateMuscleMap, creditedMuscles, limitedSlugsFromLimitations, scaleLandmarksForExperience } from '../muscleMap'
import type { ProgressSetRow } from '../progressAggregate'
import { rpeSuffix } from '../setFormat'
import type { TrainingHistory } from '../api/hevyApi'
import type { AthleteLimitation, AthleteProfile } from '../types.athlete'
import type { CoachMuscleDose, CoachSession } from './coachFormat'
import { buildPlannedProgram, type RoutineLike } from '../plan/programBalance'
import { comparePlannedDone, type BalanceComparison, type BalancePair, type MuscleBalance } from '../plan/muscleBalance'
import { aggregateVolume, buildTplById, computeBalance, volumeRowsFromSets } from '../components/muscles/muscleVolumeModel'
import { shiftDateStr } from '../../../shared/utils/dateUtils'

// Pure pieces of the coach data set, derived from the one training-history
// read (scripts/verify-coach-context.cjs). coachData.ts does the fetching.

/** "4×8@60kg" when uniform, else a compact per-group list. Working sets only.
 *  When sets were rated in Hevy, the RPE of every working set follows in set
 *  order: "3×10@60kg @ RPE 8/9/10" (the shared setFormat suffix). */
export function summarizeWorkingSets(sets: readonly Pick<ProgressSetRow, 'set_type' | 'reps' | 'weight_kg' | 'duration_seconds' | 'distance_meters' | 'rpe'>[]): string {
  const groups = new Map<string, number>()
  const rpes: (number | null | undefined)[] = []
  for (const s of sets) {
    if (s.set_type === 'warmup') continue
    const key = s.reps != null || s.weight_kg != null
      ? `${s.reps ?? '?'}@${s.weight_kg ?? 0}kg`
      : s.duration_seconds != null ? `${s.duration_seconds}s`
      : s.distance_meters != null ? `${s.distance_meters}m`
      : null
    if (!key) continue
    groups.set(key, (groups.get(key) ?? 0) + 1)
    rpes.push(s.rpe)
  }
  const text = [...groups.entries()].map(([key, n]) => `${n}×${key}`).join(', ')
  return text ? text + rpeSuffix(rpes) : '—'
}

/** Sessions newest first, each exercise's working sets summarised. */
export function sessionsFromHistory(history: TrainingHistory): CoachSession[] {
  const titleById = new Map(history.templates.map(t => [t.id, t.title]))
  const byWorkout = new Map<string, { date: string; title: string | null; routineId: string | null; byExercise: Map<string, ProgressSetRow[]> }>()
  for (const s of history.sets) {
    const w = byWorkout.get(s.workout_id) ?? { date: s.date, title: s.workout_title ?? null, routineId: s.routine_id ?? null, byExercise: new Map() }
    const bucket = w.byExercise.get(s.exercise_template_id) ?? []
    bucket.push(s)
    w.byExercise.set(s.exercise_template_id, bucket)
    byWorkout.set(s.workout_id, w)
  }
  return [...byWorkout.entries()]
    .map(([workoutId, w]) => ({
      workoutId, date: w.date, title: w.title, routineId: w.routineId,
      exercises: [...w.byExercise.entries()].map(([tid, sets]) => ({
        title: titleById.get(tid) ?? 'Exercise',
        sets: summarizeWorkingSets([...sets].sort((a, b) => (a.set_index ?? 0) - (b.set_index ?? 0))),
      })),
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.workoutId.localeCompare(b.workoutId))
}

/** Credited hard sets per muscle over [from, today] (primary 1, secondary
 *  0.5 — the Muscles tab's convention), with experience-scaled landmarks and
 *  the shared limitation cross-check. */
export function weeklyMuscleDose(
  history: TrainingHistory, from: string, profile: AthleteProfile | null, limitations: readonly AthleteLimitation[],
): CoachMuscleDose[] {
  const credit = buildTemplateMuscleMap(history.templates)
  const perSlug = new Map<string, number>()
  for (const s of history.sets) {
    if (s.date < from || s.set_type === 'warmup') continue
    const c = credit.get(s.exercise_template_id)
    if (!c) continue
    for (const cr of creditedMuscles(s.exercise_template_id, c.primarySlug, c.secondarySlugs)) perSlug.set(cr.slug, (perSlug.get(cr.slug) ?? 0) + cr.weight)
  }
  const restricted = limitedSlugsFromLimitations(limitations)
  return [...perSlug.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([slug, sets]) => {
      const L0 = MUSCLE_LANDMARKS[slug]
      return {
        slug, sets,
        landmarks: L0 ? scaleLandmarksForExperience(L0, profile?.experience_level) : null,
        restriction: restricted.get(slug as Parameters<typeof restricted.get>[0]) ?? null,
      }
    })
}

export interface CoachBalance {
  windowDays: number
  /** Planned in the current program; null without one. */
  planned: MuscleBalance | null
  done: MuscleBalance
  comparison: Record<BalancePair, BalanceComparison> | null
}

/** Push:pull and quad:hamstring for the coach — the same pipeline as the
 *  Program tab (planned) and the Muscles body map (done in the last 30
 *  days), so the coach quotes the numbers the user sees. */
export function coachBalance(args: {
  history: TrainingHistory
  /** The full template list (falls back to the history's templates). */
  templates: readonly { id: string; title: string; primary_muscle_group: string | null; secondary_muscle_groups?: string[] | null }[]
  routines: readonly RoutineLike[]
  programRoutineIds: readonly string[]
  trainingDaysPerWeek: number | null
  scheduledTrainingDays: number
  today: string
  windowDays?: number
}): CoachBalance {
  const windowDays = args.windowDays ?? 30
  const templates = args.templates.length ? args.templates : args.history.templates
  const tplById = buildTplById(templates)
  const rows = volumeRowsFromSets(args.history.sets, shiftDateStr(args.today, -(windowDays - 1)), args.today)
  const done = computeBalance({ perSlug: aggregateVolume(rows, tplById).perSlug, weeks: windowDays / 7 })
  const plan = buildPlannedProgram({
    routines: args.routines, programRoutineIds: args.programRoutineIds, templates,
    trainingDaysPerWeek: args.trainingDaysPerWeek, scheduledTrainingDays: args.scheduledTrainingDays,
  })
  return {
    windowDays,
    planned: plan.current.length ? plan.balance : null,
    done,
    comparison: comparePlannedDone(plan, { rows, tplById, balance: done, windowDays }),
  }
}
