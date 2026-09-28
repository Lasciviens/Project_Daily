import { useMemo } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { useScheduleBlock, useTimeBlock } from '../../daily/hooks/useSchedule'
import { localDayOf } from '../../../shared/utils/dateUtils'
import { useHevyWorkoutDetail, useHevyWorkoutsRange } from './useHevyWorkouts'
import { useStravaActivities } from './useStravaActivities'
import { useTodayStr } from './useTrainingSessions'
import { useTrainingPlansByDate } from './useTrainingPlans'
import { localDayBoundsIso, workoutLocalDay } from '../workoutDates'
import { resolveTrainingSession, type ResolvedSession, type SessionPlanRef } from '../sessionRef'
import type { CalendarPlanItem } from '../components/calendar/calendarModel'

export interface SessionRequest {
  workoutId?: string
  plan?: SessionPlanRef
}

export interface SessionAnchor {
  /** The local day the session sits on, once known. */
  date: string | null
  /** The requested plan built from its own row (null when the row is gone). */
  planRow: CalendarPlanItem | null
  /** The read that decides the anchor — for the popup's loading / error states. */
  query: UseQueryResult<unknown>
}

/**
 * Step 1 of opening a session: which DAY it is on. A workout's day is the
 * local day it was performed; a one-off plan's day is its block's CURRENT
 * date (it may have been moved since the request was made — e.g. from this
 * popup's own ⋯ → Change plan); a recurring occurrence's day is the one
 * requested (it has no row of its own).
 */
export function useSessionAnchor(req: SessionRequest): SessionAnchor {
  const workoutQ = useHevyWorkoutDetail(req.workoutId ?? null)
  const blockQ = useTimeBlock(req.plan?.kind === 'block' ? req.plan.id : null)
  const templateQ = useScheduleBlock(req.plan?.kind === 'recurring' ? req.plan.id : null)
  const block = blockQ.data
  const template = templateQ.data
  const recurringDate = req.plan?.kind === 'recurring' ? req.plan.date : null

  const planRow = useMemo<CalendarPlanItem | null>(() => {
    if (block) return { id: block.id, title: block.title, kind: 'block', timeBlock: block }
    if (template && recurringDate) return { id: `${template.id}__${recurringDate}`, title: template.title, kind: 'recurring', scheduleBlock: template }
    return null
  }, [block, template, recurringDate])

  if (req.workoutId) {
    const w = workoutQ.data
    return { date: w ? workoutLocalDay(w) || null : null, planRow: null, query: workoutQ }
  }
  if (req.plan?.kind === 'block') return { date: block ? block.date : null, planRow, query: blockQ }
  if (req.plan?.kind === 'recurring') return { date: template ? recurringDate : null, planRow, query: templateQ as UseQueryResult<unknown> }
  return { date: null, planRow: null, query: workoutQ }
}

export interface SessionDay {
  /** null while the day (or its reads) are still loading. */
  resolved: ResolvedSession | null
  todayStr: string
}

/**
 * Step 2, once the day is known: every plan, workout and Strava activity on
 * it, and what the popup shows (sessionRef.resolveTrainingSession — a plan a
 * workout covered opens as that workout). Same reads as the Log calendar.
 * With no day yet only the plan read runs (on the requested day — it has no
 * `enabled` switch), so the popup keeps one shell while it loads.
 */
export function useSessionDay(req: SessionRequest, date: string | null, planRow: CalendarPlanItem | null): SessionDay {
  const todayStr = useTodayStr()
  const day = date ?? req.plan?.date ?? todayStr
  const workoutsQ = useHevyWorkoutsRange(day, day, { enabled: !!date })
  const plans = useTrainingPlansByDate(day, day)
  const bounds = useMemo(() => localDayBoundsIso(day, day), [day])
  const stravaQ = useStravaActivities({ from: bounds.fromISO, to: bounds.toISO, limit: 50 }, { enabled: !!date })

  // keepPreviousData would briefly pair against another day's workouts.
  const isLoading = !date || workoutsQ.isLoading || workoutsQ.isPlaceholderData || plans.isLoading || stravaQ.isLoading
  const workouts = workoutsQ.data
  const activities = stravaQ.data
  const dayPlans = plans.data.get(day)
  const resolved = useMemo<ResolvedSession | null>(() => {
    if (isLoading) return null
    return resolveTrainingSession({
      workoutId: req.workoutId,
      plan: req.plan ? { ...req.plan, date: day } : null,
      date: day,
      todayStr,
      plans: dayPlans ?? [],
      workouts: (workouts ?? []).filter(w => workoutLocalDay(w) === day),
      hasActivity: (activities ?? []).some(a => localDayOf(a.start_date) === day),
      planRow,
    })
  }, [isLoading, req.workoutId, req.plan, day, todayStr, dayPlans, workouts, activities, planRow])

  return { resolved, todayStr }
}
