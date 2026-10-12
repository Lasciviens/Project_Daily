import { useMemo } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { linkedTimeBlockQuery, useScheduleBlock, useTimeBlock } from '../../daily/hooks/useSchedule'
import { useTaskById } from '../../todo/hooks/useTodos'
import type { Task } from '../../todo/types'
import { localDayOf } from '../../../shared/utils/dateUtils'
import { qk, STALE } from '../../../shared/query'
import { fetchOccurrenceBlockId } from '../api/trainingPlanApi'
import { useHevyWorkoutDetail, useHevyWorkoutsRange } from './useHevyWorkouts'
import { useStravaActivities } from './useStravaActivities'
import { useTodayStr } from './useTrainingSessions'
import { useTrainingPlansByDate } from './useTrainingPlans'
import { localDayBoundsIso, workoutLocalDay } from '../workoutDates'
import { resolveTrainingSession, sessionForTask, type ResolvedSession, type SessionPlanRef } from '../sessionRef'
import type { CalendarPlanItem } from '../components/calendar/calendarModel'

export interface SessionRequest {
  workoutId?: string
  plan?: SessionPlanRef
  /** A planned-training task (Home's and Daily's task lists): opens as its
   *  workout once trained, else as its planned block (migration 141). */
  taskId?: string
}

export interface SessionAnchor {
  /** The local day the session sits on, once known. */
  date: string | null
  /** The requested plan built from its own row (null when the row is gone). */
  planRow: CalendarPlanItem | null
  /** The read that decides the anchor — for the popup's loading / error states. */
  query: UseQueryResult<unknown>
  /** What is shown: the request, with a task resolved to its workout or plan. */
  request: SessionRequest
  /** A training task with neither a workout nor a block on the calendar. */
  orphanTask: Task | null
  /** The plan's task, however the popup was opened (from the task, or from
   *  its block on the calendar) — the truth for its status (sessionState). */
  task: Task | null
}

/**
 * Step 1 of opening a session: which DAY it is on. A workout's day is the
 * local day it was performed; a one-off plan's day is its block's CURRENT
 * date (it may have been moved since the request was made — e.g. from this
 * popup's own Move); a recurring occurrence's day is the one requested (it
 * has no row of its own) — unless that day became a plan of its own (142),
 * which is then shown instead. Opened from the task or from its block, a
 * plan reads the same task, and once a workout is linked to it (141) the
 * popup shows that workout, whatever day it was done.
 */
export function useSessionAnchor(asked: SessionRequest): SessionAnchor {
  const taskQ = useTaskById(asked.taskId ?? null)
  const taskBlockQ = useQuery({ ...linkedTimeBlockQuery(asked.taskId ?? ''), enabled: !!asked.taskId })
  const askedTask = taskQ.data ?? null
  const taskBlock = taskBlockQ.data ?? null
  const taskReady = !!askedTask && taskBlockQ.isSuccess

  // A day of a weekly plan that became a block of its own: show the block.
  const recurring = !asked.taskId && asked.plan?.kind === 'recurring' ? asked.plan : null
  const occurrenceQ = useQuery({
    queryKey: qk.schedule.occurrence(recurring?.id ?? '', recurring?.date ?? ''),
    queryFn: () => fetchOccurrenceBlockId(recurring!.id, recurring!.date),
    enabled: !!recurring,
    staleTime: STALE.default,
  })
  const occurrenceBlockId = occurrenceQ.data ?? null

  const base = useMemo<SessionRequest>(() => {
    if (asked.taskId) {
      if (!taskReady || !askedTask) return {}
      return sessionForTask(askedTask, taskBlock) ?? {}
    }
    if (recurring && occurrenceBlockId) return { plan: { kind: 'block', id: occurrenceBlockId, date: recurring.date } }
    return asked
  }, [asked, taskReady, askedTask, taskBlock, recurring, occurrenceBlockId])
  const orphanTask = asked.taskId && taskReady && !base.workoutId && !base.plan ? askedTask : null

  const blockQ = useTimeBlock(base.plan?.kind === 'block' ? base.plan.id : null)
  const block = blockQ.data
  const blockTaskQ = useTaskById(!asked.taskId ? block?.task_id ?? null : null)
  const task = asked.taskId ? askedTask : blockTaskQ.data ?? null
  const req = useMemo<SessionRequest>(
    () => (!base.workoutId && task?.hevy_workout_id ? { workoutId: task.hevy_workout_id } : base),
    [base, task],
  )

  const workoutQ = useHevyWorkoutDetail(req.workoutId ?? null)
  const templateQ = useScheduleBlock(req.plan?.kind === 'recurring' ? req.plan.id : null)
  const template = templateQ.data
  const recurringDate = req.plan?.kind === 'recurring' ? req.plan.date : null

  const planRow = useMemo<CalendarPlanItem | null>(() => {
    if (req.plan?.kind === 'block' && block) return { id: block.id, title: block.title, kind: 'block', timeBlock: block }
    if (template && recurringDate) return { id: `${template.id}__${recurringDate}`, title: template.title, kind: 'recurring', scheduleBlock: template }
    return null
  }, [req.plan?.kind, block, template, recurringDate])

  const out = { request: req, orphanTask, task }
  if (req.workoutId) {
    const w = workoutQ.data
    return { ...out, date: w ? workoutLocalDay(w) || null : null, planRow: null, query: workoutQ }
  }
  // Waiting for the block's own task (it decides whether a workout is shown).
  if (req.plan?.kind === 'block') {
    const waiting = !!block?.task_id && !asked.taskId && blockTaskQ.isLoading
    return { ...out, date: block && !waiting ? block.date : null, planRow, query: blockQ }
  }
  if (req.plan?.kind === 'recurring') {
    return { ...out, date: template && !occurrenceQ.isLoading ? recurringDate : null, planRow, query: templateQ as UseQueryResult<unknown> }
  }
  // A task still resolving: its own read until it is there, then its block's
  // (so a finished task read alone never reads as "no longer exists").
  if (asked.taskId) return { ...out, date: null, planRow: null, query: (!askedTask || taskQ.isError ? taskQ : taskBlockQ) as UseQueryResult<unknown> }
  return { ...out, date: null, planRow: null, query: workoutQ }
}

export interface SessionDay {
  /** null while the day (or its reads) are still loading. */
  resolved: ResolvedSession | null
  todayStr: string
  /** A Strava activity that day (sessionState: it stands in for a plan with no task). */
  hasActivity: boolean
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
  const hasActivity = (activities ?? []).some(a => localDayOf(a.start_date) === day)
  const resolved = useMemo<ResolvedSession | null>(() => {
    if (isLoading) return null
    return resolveTrainingSession({
      workoutId: req.workoutId,
      plan: req.plan ? { ...req.plan, date: day } : null,
      date: day,
      todayStr,
      plans: dayPlans ?? [],
      workouts: (workouts ?? []).filter(w => workoutLocalDay(w) === day),
      hasActivity,
      planRow,
    })
  }, [isLoading, req.workoutId, req.plan, day, todayStr, dayPlans, workouts, hasActivity, planRow])

  return { resolved, todayStr, hasActivity }
}
