import { fetchTrainingHistory, fetchHevyRoutines } from '../api/hevyApi'
import {
  fetchAthleteProfile, fetchAthleteLimitations, fetchCurrentProgramRoutines, fetchExerciseTargetOverrides,
} from '../api/athleteProfileApi'
import { fetchHealthMetricSeries, type HealthMetric } from '../../health/api/healthApi'
import { fetchBodyweightSeries } from '../../health/api/bodyweightApi'
import { computeDailySeries, computeSleepSummary } from '../../health/healthAggregate'
import { computeProgressModel } from '../progressModel'
import { sessionsFromSets, sessionsThisWeek } from '../progressAggregate'
import { sessionsFromHistory, weeklyMuscleDose } from './coachModel'
import { TRAINING_HISTORY_DAYS } from '../hooks/useTrainingProgress'
import { shiftDateStr, todayStr } from '../../../shared/utils/dateUtils'
import type { AthleteLimitation, AthleteProfile, CurrentProgramRoutine, ExerciseTargetOverride } from '../types.athlete'
import type { CoachData } from './coachFormat'

// Gathers the ONE AI-coach data set (coachFormat.ts renders it for the PT
// Coach tab and for Ask-AI Coach mode). A handful of reads, all in parallel;
// the progress decisions come from progressModel.computeProgressModel — the
// same function the Progress tab runs — over the same 6-month history.
// Optional sources (pre-migration tables, Health data) degrade to empty.

const soft = async <T>(p: Promise<T>, fallback: T): Promise<T> => {
  try { return await p } catch { return fallback }
}

export async function gatherCoachData(): Promise<CoachData> {
  const today = todayStr()
  const historyFrom = new Date(`${shiftDateStr(today, -TRAINING_HISTORY_DAYS)}T00:00:00`).toISOString()
  const healthFrom = shiftDateStr(today, -31)

  const [history, routines, profile, limitations, currentProgram, overrides, sleepPts, stepPts, energyPts, bodyweight] = await Promise.all([
    fetchTrainingHistory(historyFrom, new Date().toISOString()),
    soft(fetchHevyRoutines(), []),
    soft<AthleteProfile | null>(fetchAthleteProfile(), null),
    soft<AthleteLimitation[]>(fetchAthleteLimitations(true), []),
    soft<CurrentProgramRoutine[]>(fetchCurrentProgramRoutines(), []),
    soft<ExerciseTargetOverride[]>(fetchExerciseTargetOverrides(), []),
    soft<HealthMetric[]>(fetchHealthMetricSeries('sleep_analysis', healthFrom, today), []),
    soft<HealthMetric[]>(fetchHealthMetricSeries('step_count', healthFrom, today), []),
    soft<HealthMetric[]>(fetchHealthMetricSeries('active_energy', healthFrom, today), []),
    soft(fetchBodyweightSeries(shiftDateStr(today, -30), today), []),
  ])

  const progress = computeProgressModel({
    history, currentProgram, routines, targetOverrides: overrides, sleepPoints: sleepPts,
    bodyweight: bodyweight.map(p => ({ date: p.date, kg: p.kg })),
    targetDays: profile?.training_days_per_week ?? null, today,
  })

  return {
    today, profile, limitations, progress, routines,
    sessions: sessionsFromHistory(history),
    sessionsThisWeek: sessionsThisWeek(sessionsFromSets(history.sets), today),
    weeklyMuscleSets: weeklyMuscleDose(history, shiftDateStr(today, -6), profile, limitations),
    sleep: computeSleepSummary(sleepPts).map(s => ({ date: s.date, total: s.total, deep: s.deep, rem: s.rem })),
    steps: computeDailySeries('step_count', stepPts),
    activeKcal: computeDailySeries('active_energy', energyPts),
    bodyweight: bodyweight.map(p => ({ date: p.date, kg: p.kg, fatPct: p.fatPct })),
  }
}
