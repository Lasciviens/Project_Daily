import { useMemo } from 'react'
import { shiftDateStr, todayStr } from '../../../shared/utils/dateUtils'
import { useTrainingHistory } from '../../training/hooks/useTrainingProgress'
import { useAthleteProfile, useCurrentProgramRoutines } from '../../training/hooks/useAthleteProfile'
import { computeLiftChanges, mainLifts } from '../../training/plan/improvement'
import { filterToCurrentProgram } from '../../training/progress-engine'
import { analyseComposition } from './bodyGoal'
import { neededDays } from './energyBalance'
import { useGoalReport } from './useGoalReport'
import { buildMuscleWatch, type LiftTrend, type MuscleWatch, type TrainingSession } from './muscleWatch'

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

  const watch = useMemo(() => {
    if (!report || !history) return null
    const today = todayStr()
    const from = phaseStart && phaseStart <= shiftDateStr(today, -7) && phaseStart >= shiftDateStr(today, -MAX_WINDOW_DAYS)
      ? phaseStart : report.compFrom

    // The current program's main lifts over the last 4 weeks — the same
    // per-lift change as Training → Progress's Improvement card.
    const programIds = new Set((program ?? []).map(p => p.routine_id))
    const programSets = filterToCurrentProgram(history.sets, programIds)
    const templates = history.templates.map(t => ({ id: t.id, title: t.title, type: t.type ?? 'weight_reps' }))
    const lifts: LiftTrend[] = mainLifts(computeLiftChanges(programSets, templates, today, 4), 5)
      .flatMap(c => (c.changePct == null ? [] : [{ name: c.title, changePct: c.changePct }]))

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
      protein: { meanG: e.intake.meanProteinG, loggedDays: e.intake.loggedDays, neededDays: neededDays(e.days) },
      lifts,
      sessions: [...byWorkout.values()],
      targetSessionsPerWeek: profile?.training_days_per_week ?? null,
      muscleGoalKg: muscleGoal,
    })
  }, [report, history, program, profile, phaseStart, muscleGoal])

  return { watch, isLoading: !watch && (d.isLoading || loadingHistory) }
}
