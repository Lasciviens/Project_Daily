import { useMemo } from 'react'
import { shiftDateStr } from '../../../shared/utils/dateUtils'
import { useTodayStr } from '../../../shared/hooks/useToday'
import { useScheduleBlocks } from '../../daily/hooks/useSchedule'
import { useHevyWorkoutsRange } from './useHevyWorkouts'
import { useHevyRoutines } from './useHevyRoutines'
import { useTrainingPlansByDate } from './useTrainingPlans'
import { usePlanContext } from './usePlanContext'
import { useCurrentProgramRoutines } from './useAthleteProfile'
import { buildTrainingWeek } from '../plan/weekInputs'
import type { TrainingWeek } from '../plan/sessionState'

/**
 * Several weeks as THE status reads them (plan/sessionState → planWeek, through the same builder as the This week
 * strip, `buildTrainingWeek`), one read for the whole range: `mondays` (yyyy-MM-dd, oldest first). Results'
 * Consistency card reads the 4 full weeks before this one here — the strip's own model, never a count of its own.
 */
export function useTrainingWeeks(mondays: readonly string[]): { weeks: TrainingWeek[]; isLoading: boolean; isError: boolean } {
  const today = useTodayStr()
  const first = mondays[0] ?? today
  const last = mondays[mondays.length - 1] ?? today
  const from = shiftDateStr(first, -7)
  const to = shiftDateStr(last, 6)
  const plans = useTrainingPlansByDate(from, to)
  const workoutsQ = useHevyWorkoutsRange(from, to)
  const templatesQ = useScheduleBlocks()
  const routinesQ = useHevyRoutines()
  const { skips, routineOf } = usePlanContext()
  const programQ = useCurrentProgramRoutines()
  const workouts = workoutsQ.data
  const templates = templatesQ.data
  const routines = routinesQ.data
  const program = programQ.data
  const key = mondays.join()

  return useMemo(() => {
    const titleOf = new Map((routines ?? []).map(r => [r.id, r.title]))
    const weeks = key.split(',').filter(Boolean).map(monday => buildTrainingWeek({
      date: monday, today, plansByDate: plans.data, workouts: workouts ?? [], skips, routineOf, titleOf,
      templates: templates ?? [], program: program ? program.map(p => p.routine_id) : undefined,
    }).week)
    return {
      weeks,
      // A placeholder (keepPreviousData) is another range's read: never counted as these weeks' numbers.
      isLoading: plans.isLoading || workoutsQ.isLoading || workoutsQ.isPlaceholderData || templatesQ.isLoading || routinesQ.isLoading,
      isError: plans.isError || workoutsQ.isError,
    }
  }, [key, today, plans.data, plans.isLoading, plans.isError, workouts, workoutsQ.isLoading, workoutsQ.isPlaceholderData, workoutsQ.isError,
    templates, templatesQ.isLoading, routines, routinesQ.isLoading, program, skips, routineOf])
}
