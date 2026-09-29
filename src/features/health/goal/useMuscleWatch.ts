import { useMemo } from 'react'
import { shiftDateStr, todayStr } from '../../../shared/utils/dateUtils'
import { useTrainingHistory } from '../../training/hooks/useTrainingProgress'
import { useAthleteProfile, useCurrentProgramRoutines } from '../../training/hooks/useAthleteProfile'
import { est1RM, metricKindForExerciseType } from '../../training/progressAggregate'
import { filterToCurrentProgram } from '../../training/progress-engine'
import { analyseComposition } from './bodyGoal'
import { neededDays } from './energyBalance'
import { useGoalReport } from './useGoalReport'
import { buildMuscleWatch, type LiftHistory, type MuscleWatch, type TrainingSession } from './muscleWatch'

/** Link target for every "Muscle watch" mention outside the Goal progress window. */
export const MUSCLE_WATCH_HREF = '/health?section=goal'

// The phase start counts as the window's start only while it is at least a
// week old and no older than the training history reaches.
const MAX_WINDOW_DAYS = 182

/** The ONE place the Muscle watch reading is assembled (muscleWatch.ts is the
 *  logic): the goal report's scale, pace and protein (the same 28-day report
 *  the Goal progress card opens on, so the cache is shared) plus the training
 *  history's current-program lifts and sessions. Health → Goal progress, the
 *  Overview insights and Training → Next / Progress all read it here. */
export function useMuscleWatch(): { watch: MuscleWatch | null; isLoading: boolean } {
  const d = useGoalReport(28)
  const { data: history, isLoading: loadingHistory } = useTrainingHistory()
  const { data: program } = useCurrentProgramRoutines()
  const { data: profile } = useAthleteProfile()
  const report = d.report
  const phaseStart = d.goals.settings.phaseStartDate
  const muscleGoal = d.goals.settings.goalMuscleMassKg
  const targetProtein = d.phase.targetProtein

  const watch = useMemo(() => {
    if (!report || !history) return null
    const today = todayStr()
    const from = phaseStart && phaseStart <= shiftDateStr(today, -7) && phaseStart >= shiftDateStr(today, -MAX_WINDOW_DAYS)
      ? phaseStart : report.compFrom

    const programIds = new Set((program ?? []).map(p => p.routine_id))
    const sets = filterToCurrentProgram(history.sets, programIds).filter(s => s.set_type !== 'warmup')
    const kindById = new Map(history.templates.map(t => [t.id, metricKindForExerciseType(t.type ?? 'weight_reps')]))
    const nameById = new Map(history.templates.map(t => [t.id, t.title]))

    // Best est. 1RM per workout, per est-1RM lift (dropsets never count).
    const best = new Map<string, Map<string, { date: string; e1rm: number }>>()
    for (const s of sets) {
      if (s.set_type === 'dropset' || kindById.get(s.exercise_template_id) !== 'est1rm' || s.weight_kg == null) continue
      const e = est1RM(s.weight_kg, s.reps)
      if (e == null || e <= 0) continue
      const byWorkout = best.get(s.exercise_template_id) ?? new Map()
      const cur = byWorkout.get(s.workout_id)
      if (!cur || e > cur.e1rm) byWorkout.set(s.workout_id, { date: s.date, e1rm: e })
      best.set(s.exercise_template_id, byWorkout)
    }
    const lifts: LiftHistory[] = [...best].map(([id, m]) => ({
      id, name: nameById.get(id) ?? id, sessions: [...m.values()].sort((a, b) => a.date.localeCompare(b.date)),
    }))

    // Every workout (not only the current program): training frequency is about the person.
    const byWorkout = new Map<string, TrainingSession>()
    for (const s of history.sets) {
      const cur = byWorkout.get(s.workout_id) ?? { date: s.date, workingSets: 0 }
      if (s.set_type !== 'warmup') cur.workingSets++
      byWorkout.set(s.workout_id, cur)
    }

    const e = report.energy
    return buildMuscleWatch({
      today, phase: report.phase, from,
      readings: report.readings,
      comp: analyseComposition(report.readings, from, today),
      ratePctPerWeek: report.rate?.pctPerWeek ?? null,
      weightKg: e.weight.currentTrendKg ?? e.weight.meanKg,
      protein: { meanG: e.intake.meanProteinG, loggedDays: e.intake.loggedDays, neededDays: neededDays(e.days), targetG: targetProtein || null },
      lifts,
      sessions: [...byWorkout.values()],
      targetSessionsPerWeek: profile?.training_days_per_week ?? null,
      muscleGoalKg: muscleGoal,
    })
  }, [report, history, program, profile, phaseStart, muscleGoal, targetProtein])

  return { watch, isLoading: !watch && (d.isLoading || loadingHistory) }
}
