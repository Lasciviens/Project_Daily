import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { fetchFirstPlanDay, type TrainingPlanRef } from '../api/trainingPlanApi'
import { useScheduleBlocks, useTrainingBlocks, useTrainingDayTasks } from '../../daily/hooks/useSchedule'
import { buildPlansByDate } from '../components/calendar/calendarPlans'
import { todayStr } from '../../../shared/utils/dateUtils'
import type { CalendarPlanItem } from '../components/calendar/calendarModel'

/** Planned training sessions per day of [from, to]: one-off training blocks +
 *  recurring training templates projected onto each day from today on, each
 *  projected day with its task when it has one; a past day shows its stored
 *  day tasks only (calendarPlans.ts). The calendar, the session popup and
 *  Personal's Training card read it, so all see the same plans. */
export function useTrainingPlansByDate(from: string, to: string): {
  data: Map<string, CalendarPlanItem[]>
  isLoading: boolean
  isError: boolean
} {
  const blocksQ = useTrainingBlocks(from, to)
  const templatesQ = useScheduleBlocks()
  const dayTasksQ = useTrainingDayTasks(from, to)
  const blocks = blocksQ.data
  const templates = templatesQ.data
  const dayTasks = dayTasksQ.data
  const today = todayStr()
  const data = useMemo(() => buildPlansByDate(from, to, blocks ?? [], templates ?? [], dayTasks ?? [], today), [from, to, blocks, templates, dayTasks, today])
  return {
    data,
    isLoading: blocksQ.isLoading || templatesQ.isLoading || dayTasksQ.isLoading,
    isError: blocksQ.isError || templatesQ.isError || dayTasksQ.isError,
  }
}

/** A session's first day (167): a weekly day not acted on yet is its own
 *  day; a session with a task reads its stored first day; an older block
 *  with no task is on its first day. */
export function useSessionFirstDay(plan: TrainingPlanRef): string | null {
  const firstDay = useFirstPlanDay(plan.target.kind === 'task' ? plan.target.taskId : null)
  if (plan.target.kind === 'weekly') return plan.target.date
  if (plan.target.kind === 'block') return plan.info.date
  return firstDay
}

/** A training task's stored first day (167), or null (no task, not read yet, before 167). */
export function useFirstPlanDay(taskId: string | null): string | null {
  const q = useQuery({
    queryKey: qk.tasks.firstPlanDay(taskId ?? ''),
    queryFn: () => fetchFirstPlanDay(taskId as string),
    enabled: !!taskId,
    staleTime: STALE.default,
  })
  return taskId ? q.data ?? null : null
}
