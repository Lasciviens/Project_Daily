import { fetchTrainingHistory, fetchHevyRoutines, fetchHevyExerciseTemplates, fetchHevyWorkoutsInRange } from '../api/hevyApi'
import {
  fetchAthleteProfile, fetchAthleteLimitations, fetchCurrentProgramRoutines, fetchExerciseTargetOverrides,
} from '../api/athleteProfileApi'
import { fetchHealthMetricSeries, type HealthMetric } from '../../health/api/healthApi'
import { fetchBodyweightSeries } from '../../health/api/bodyweightApi'
import { fetchScheduleBlocks, fetchTrainingBlocksRange, fetchTrainingDayTasks } from '../../daily/api/scheduleApi'
import { weeklyDaysPerWeek } from '../../daily/recurrence'
import { fetchTrainingSkips } from '../api/trainingSkipsApi'
import { fetchDayTargets, type NutritionGoal } from '../../daily/api/dayTargetsApi'
import { skipsFromWeek } from '../plan/skippedRoutines'
import { buildTrainingWeek, mondayOfDay, weekMissed } from '../plan/weekInputs'
import { matchRoutineToPlan } from '../plan/nextSession'
import { buildPlansByDate } from '../components/calendar/calendarPlans'
import { computeDailySeries, computeSleepSummary } from '../../health/healthAggregate'
import { computeProgressModel } from '../progressModel'
import { sessionsFromSets, sessionsThisWeek } from '../progressAggregate'
import { coachBalance, sessionsFromHistory, weeklyMuscleDose } from './coachModel'
import { TRAINING_HISTORY_DAYS } from '../hooks/useTrainingProgress'
import { shiftDateStr, todayStr } from '../../../shared/utils/dateUtils'
import type { AthleteLimitation, AthleteProfile, CurrentProgramRoutine, ExerciseTargetOverride } from '../types.athlete'
import type { CoachData } from './coachFormat'

// Gathers the ONE AI-coach data set (coachFormat.ts renders it for the PT
// Coach tab and for Ask-AI Coach mode). A handful of reads, all in parallel;
// the progress decisions come from progressModel.computeProgressModel — the
// same function the Results tab runs — over the same 6-month history.
// Optional sources (pre-migration tables, Health data) degrade to empty.

const soft = async <T>(p: Promise<T>, fallback: T): Promise<T> => {
  try { return await p } catch { return fallback }
}

export async function gatherCoachData(): Promise<CoachData> {
  const today = todayStr()
  const historyFrom = new Date(`${shiftDateStr(today, -TRAINING_HISTORY_DAYS)}T00:00:00`).toISOString()
  const healthFrom = shiftDateStr(today, -31)
  // The program verdict's sleep signal compares the last 4 COMPLETE weeks
  // (up to ~34 days back, plus the evening before), so sleep needs a longer
  // read than the 30-day context — with 31 days its oldest week lost nights
  // and the coach's workload verdict could differ from the Results tab's.
  const sleepFrom = shiftDateStr(today, -42)
  // Balance inputs (the Plan tab's): every template and the recurring
  // training days — fetched alongside the reads below.
  const balanceInputs = Promise.all([soft(fetchHevyExerciseTemplates(), []), soft(fetchScheduleBlocks(), [])])
  // The goal's phase (cut / maintain / gain) — the training focus no longer
  // says "fat loss", so the coach reads the phase itself.
  const goalState = soft<NutritionGoal | null>(fetchDayTargets().then(s => s.targets.goal), null)

  // The plan's week (Monday − 7 to Sunday): the This week strip's own reading, for the MISSED line.
  const weekFrom = shiftDateStr(mondayOfDay(today), -7)
  const weekTo = shiftDateStr(mondayOfDay(today), 6)
  const [history, routines, profile, limitations, currentProgram, overrides, sleepPts, stepPts, energyPts, bodyweight, blocks, skips, dayTasks, weekWorkouts] = await Promise.all([
    fetchTrainingHistory(historyFrom, new Date().toISOString()),
    soft(fetchHevyRoutines(), []),
    soft<AthleteProfile | null>(fetchAthleteProfile(), null),
    soft<AthleteLimitation[]>(fetchAthleteLimitations(true), []),
    soft<CurrentProgramRoutine[]>(fetchCurrentProgramRoutines(), []),
    soft<ExerciseTargetOverride[]>(fetchExerciseTargetOverrides(), []),
    soft<HealthMetric[]>(fetchHealthMetricSeries('sleep_analysis', sleepFrom, today), []),
    soft<HealthMetric[]>(fetchHealthMetricSeries('step_count', healthFrom, today), []),
    soft<HealthMetric[]>(fetchHealthMetricSeries('active_energy', healthFrom, today), []),
    soft(fetchBodyweightSeries(shiftDateStr(today, -30), today), []),
    // Missed sessions: the plan's week as the strip reads it (213) — its plans, skips and workouts.
    soft(fetchTrainingBlocksRange(weekFrom, weekTo), []),
    soft(fetchTrainingSkips(skipsFromWeek(today)), []),
    soft(fetchTrainingDayTasks(weekFrom, weekTo), []),
    soft(fetchHevyWorkoutsInRange(weekFrom, weekTo), []),
  ])

  const progress = computeProgressModel({
    history, currentProgram, routines, targetOverrides: overrides, sleepPoints: sleepPts,
    bodyweight: bodyweight.map(p => ({ date: p.date, kg: p.kg })),
    targetDays: profile?.training_days_per_week ?? null, today,
  })
  const [templates, scheduleBlocks] = await balanceInputs
  const programIds = new Set(currentProgram.map(p => p.routine_id))
  const phase = await goalState
  const balance = coachBalance({
    history, templates, routines, programRoutineIds: currentProgram.map(p => p.routine_id),
    trainingDaysPerWeek: profile?.training_days_per_week ?? null,
    // Every N weeks counts 1/N of its days (recurrence.weeklyDaysPerWeek).
    scheduledTrainingDays: weeklyDaysPerWeek(scheduleBlocks.filter(b => b.category === 'training')),
    today,
  })

  return {
    today, profile, limitations, progress, routines,
    sessions: sessionsFromHistory(history),
    sessionsThisWeek: sessionsThisWeek(sessionsFromSets(history.sets), today),
    weeklyMuscleSets: weeklyMuscleDose(history, shiftDateStr(today, -6), limitations),
    sleep: computeSleepSummary(sleepPts).map(s => ({ date: s.date, total: s.total, deep: s.deep, rem: s.rem })),
    steps: computeDailySeries('step_count', stepPts),
    activeKcal: computeDailySeries('active_energy', energyPts),
    bodyweight: bodyweight.map(p => ({ date: p.date, kg: p.kg, fatPct: p.fatPct })),
    balance,
    phase,
    missedSessions: progress.needsCurrentProgram ? [] : weekMissed(buildTrainingWeek({
      date: today, today, workouts: weekWorkouts, skips,
      plansByDate: buildPlansByDate(weekFrom, weekTo, blocks, scheduleBlocks, dayTasks, today),
      routineOf: plan => matchRoutineToPlan({ title: plan.title, date: plan.date, startTime: plan.startHHMM ?? null, sourceId: null }, routines, programIds)?.id ?? null,
      titleOf: new Map(routines.map(r => [r.id, r.title])), templates: scheduleBlocks,
      program: currentProgram.map(p => p.routine_id),
    }).week, today),
  }
}
