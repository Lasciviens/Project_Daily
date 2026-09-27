import { fetchTrainingHistory, fetchHevyRoutines, fetchHevyExerciseTemplates } from '../api/hevyApi'
import {
  fetchAthleteProfile, fetchAthleteLimitations, fetchCurrentProgramRoutines, fetchExerciseTargetOverrides,
} from '../api/athleteProfileApi'
import { fetchHealthMetricSeries, type HealthMetric } from '../../health/api/healthApi'
import { fetchBodyweightSeries } from '../../health/api/bodyweightApi'
import { fetchScheduleBlocks, fetchTrainingBlocksRange } from '../../daily/api/scheduleApi'
import { fetchTrainingSkips } from '../api/trainingSkipsApi'
import { lastTrainedByRoutine } from '../progress-engine'
import { missedSessionsFrom, skipsFromWeek } from '../plan/skippedRoutines'
import { computeDailySeries, computeSleepSummary } from '../../health/healthAggregate'
import { computeProgressModel } from '../progressModel'
import { sessionsFromSets, sessionsThisWeek } from '../progressAggregate'
import { coachBalance, sessionsFromHistory, weeklyMuscleDose } from './coachModel'
import { TRAINING_HISTORY_DAYS } from '../hooks/useTrainingProgress'
import { NEXT_SESSION_LOOKAHEAD_DAYS } from '../hooks/useTrainingSessions'
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
  // Balance inputs (the Program tab's): every template and the recurring
  // training days — fetched alongside the reads below.
  const balanceInputs = Promise.all([soft(fetchHevyExerciseTemplates(), []), soft(fetchScheduleBlocks(), [])])

  const [history, routines, profile, limitations, currentProgram, overrides, sleepPts, stepPts, energyPts, bodyweight, blocks, skips] = await Promise.all([
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
    // Missed sessions: one-off training blocks from today on, and skips (migration 112).
    soft(fetchTrainingBlocksRange(today, shiftDateStr(today, NEXT_SESSION_LOOKAHEAD_DAYS)), []),
    soft(fetchTrainingSkips(skipsFromWeek(today)), []),
  ])

  const progress = computeProgressModel({
    history, currentProgram, routines, targetOverrides: overrides, sleepPoints: sleepPts,
    bodyweight: bodyweight.map(p => ({ date: p.date, kg: p.kg })),
    targetDays: profile?.training_days_per_week ?? null, today,
  })
  const [templates, scheduleBlocks] = await balanceInputs
  const balance = coachBalance({
    history, templates, routines, programRoutineIds: currentProgram.map(p => p.routine_id),
    trainingDaysPerWeek: profile?.training_days_per_week ?? null,
    scheduledTrainingDays: new Set(scheduleBlocks.filter(b => b.category === 'training').flatMap(b => b.days_of_week)).size,
    today,
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
    balance,
    missedSessions: progress.needsCurrentProgram ? [] : missedSessionsFrom({
      routines, program: currentProgram, lastTrained: lastTrainedByRoutine(history.sets), blocks, skips, today,
    }),
  }
}
