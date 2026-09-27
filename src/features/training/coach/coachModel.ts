import { MUSCLE_LANDMARKS, buildTemplateMuscleMap, contribution, limitedSlugsFromLimitations, scaleLandmarksForExperience } from '../muscleMap'
import type { ProgressSetRow } from '../progressAggregate'
import { rpeSuffix } from '../setFormat'
import type { TrainingHistory } from '../api/hevyApi'
import type { AthleteLimitation, AthleteProfile } from '../types.athlete'
import type { CoachMuscleDose, CoachSession } from './coachFormat'

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
    if (c.primarySlug) perSlug.set(c.primarySlug, (perSlug.get(c.primarySlug) ?? 0) + contribution(s.exercise_template_id, c.primarySlug, 'primary'))
    for (const slug of c.secondarySlugs) perSlug.set(slug, (perSlug.get(slug) ?? 0) + contribution(s.exercise_template_id, slug, 'secondary'))
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
