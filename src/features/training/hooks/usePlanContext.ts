import { useCallback, useMemo } from 'react'
import { useHevyRoutines } from './useHevyRoutines'
import { useCurrentProgramRoutines } from './useAthleteProfile'
import { useTrainingSkips } from './useTrainingSkips'
import { useStravaActivities } from './useStravaActivities'
import { matchRoutineToPlan } from '../plan/nextSession'
import { localDayBoundsIso } from '../workoutDates'
import { localDayOf } from '../../../shared/utils/dateUtils'

/**
 * What every view needs beyond a plan's own row to give it THE status
 * (plan/planFacts → sessionState): the skips, and the routine a plan with no
 * routine id trains (matched by title, preferring the current program — the
 * same match the session popup uses). Shared reads, cached.
 */
export function usePlanContext() {
  const { data: skips } = useTrainingSkips()
  const { data: routines } = useHevyRoutines()
  const { data: program } = useCurrentProgramRoutines()
  const programIds = useMemo(() => new Set((program ?? []).map(p => p.routine_id)), [program])
  const routineOf = useCallback((plan: { title: string; date: string; startHHMM?: string | null; sourceId?: string | null }) =>
    matchRoutineToPlan({ title: plan.title, date: plan.date, startTime: plan.startHHMM ?? null, sourceId: plan.sourceId ?? null }, routines ?? [], programIds)?.id ?? null,
  [routines, programIds])
  return { skips: skips ?? [], routineOf }
}

/** usePlanContext plus whether a Strava activity fell on `date` (a plan with
 *  no task counts it as trained, as the calendar always did). */
export function useDayPlanContext(date: string, enabled = true) {
  const ctx = usePlanContext()
  const bounds = useMemo(() => localDayBoundsIso(date, date), [date])
  const { data: activities } = useStravaActivities({ from: bounds.fromISO, to: bounds.toISO, limit: 20 }, { enabled })
  const hasActivity = (activities ?? []).some(a => localDayOf(a.start_date) === date)
  return { ...ctx, hasActivity }
}
