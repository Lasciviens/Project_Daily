import { useMemo } from 'react'
import { mondayOfStr, shiftDateStr } from '../../../shared/utils/dateUtils'
import { useTodayStr } from '../../../shared/hooks/useToday'
import { useScheduleBlocks } from '../../daily/hooks/useSchedule'
import { useHevyWorkoutsRange } from './useHevyWorkouts'
import { useHevyRoutines } from './useHevyRoutines'
import { useTrainingPlansByDate } from './useTrainingPlans'
import { usePlanContext } from './usePlanContext'
import { useCurrentProgramRoutines } from './useAthleteProfile'
import { buildTrainingWeek } from '../plan/weekInputs'
import type { TrainingWeek } from '../plan/sessionState'
import type { CalendarPlanItem } from '../components/calendar/calendarModel'

export interface TrainingWeekView {
  week: TrainingWeek
  /** The plan behind each session (by its key) — what a chip opens. */
  planOf: ReadonlyMap<string, CalendarPlanItem>
  isLoading: boolean
  isError: boolean
}

/**
 * The week of `date` (Monday to Sunday) as THE status reads it (plan/sessionState → planWeek): every planned session
 * with its status, the day its workout was done, a swap on its day, and the one still open from last week. The
 * program's order is the weekly schedule's day order (S22). One read for every way in — the This week strip on Next,
 * Log and Daily's Training card, and "next" (useNextTrainingSession).
 */
export function useTrainingWeek(date?: string): TrainingWeekView {
  const today = useTodayStr()
  const monday = mondayOfStr(date ?? today)
  const sunday = shiftDateStr(monday, 6)
  const from = shiftDateStr(monday, -7)
  const plans = useTrainingPlansByDate(from, sunday)
  const workoutsQ = useHevyWorkoutsRange(from, sunday)
  const templatesQ = useScheduleBlocks()
  const routinesQ = useHevyRoutines()
  const { skips, routineOf } = usePlanContext()
  const programQ = useCurrentProgramRoutines()
  const program = programQ.data
  const workouts = workoutsQ.data
  const templates = templatesQ.data
  const routines = routinesQ.data

  return useMemo(() => {
    const { week, planOf } = buildTrainingWeek({
      date: monday, today, plansByDate: plans.data, workouts: workouts ?? [], skips, routineOf,
      titleOf: new Map((routines ?? []).map(r => [r.id, r.title])), templates: templates ?? [],
      program: program ? program.map(p => p.routine_id) : undefined,
    })
    return {
      week, planOf,
      isLoading: plans.isLoading || workoutsQ.isLoading || templatesQ.isLoading || routinesQ.isLoading,
      isError: plans.isError || workoutsQ.isError,
    }
  }, [plans.data, plans.isLoading, plans.isError, workouts, workoutsQ.isLoading, workoutsQ.isError, templates, templatesQ.isLoading,
    routines, routinesQ.isLoading, program, skips, routineOf, today, monday])
}
