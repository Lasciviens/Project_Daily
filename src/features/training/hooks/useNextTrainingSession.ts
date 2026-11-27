import { useMemo } from 'react'
import { shiftDateStr } from '../../../shared/utils/dateUtils'
import { useTodayStr } from '../../../shared/hooks/useToday'
import { useTrainingBlocks, useScheduleBlocks, useTrainingDayTasks } from '../../daily/hooks/useSchedule'
import { pickNextTrainingSession, type NextTrainingSession } from '../trainingPlanModel'
import { planStartHHMM } from '../components/calendar/calendarSessions'
import { NEXT_SESSION_LOOKAHEAD_DAYS } from './useTrainingSessions'
import { useTrainingWeek } from './useTrainingWeek'
import type { TrainingWeek } from '../plan/sessionState'
import type { CalendarPlanItem } from '../components/calendar/calendarModel'

// Its own module: the week model (useTrainingWeek and the calendar's pairing) stays out of the pages that only read
// Strava or the lookahead from useTrainingSessions (Settings, Developer).

/**
 * The next planned training session: this week's first session still to do in
 * the program's order (sessionState.planWeek — a missed one comes first, today's
 * stays next all day; owner, 27.11.2026), else the soonest one-off training block
 * or recurring training template (trainingPlanModel.pickNextTrainingSession). The
 * ONE "next session" for the Training banner and Home. A 'block' opens with
 * `{ kind: 'time-block', id }`, a 'recurring' one with
 * `{ kind: 'schedule-block', id }`.
 */
export function useNextTrainingSession(): { data: NextTrainingSession | null; isLoading: boolean } {
  const today = useTodayStr()
  const to = shiftDateStr(today, NEXT_SESSION_LOOKAHEAD_DAYS)
  const blocksQ = useTrainingBlocks(today, to)
  const templatesQ = useScheduleBlocks()
  const dayTasksQ = useTrainingDayTasks(today, to)
  const { week, planOf, isLoading: weekLoading } = useTrainingWeek()
  const soonest = useMemo(() => pickNextTrainingSession({
    blocks:        blocksQ.data ?? [],
    templates:     (templatesQ.data ?? []).filter(t => t.category === 'training'),
    dayTasks:      dayTasksQ.data ?? [],
    today,
    lookaheadDays: NEXT_SESSION_LOOKAHEAD_DAYS,
  }), [blocksQ.data, templatesQ.data, dayTasksQ.data, today])
  const data = useMemo(() => weekNextSession(week, planOf) ?? soonest, [week, planOf, soonest])
  return { data, isLoading: blocksQ.isLoading || templatesQ.isLoading || dayTasksQ.isLoading || weekLoading }
}

/** The week's next session (sessionState.planWeek) as a next session: its plan's own day and ids. null when the week
 *  has none. */
export function weekNextSession(week: TrainingWeek, planOf: ReadonlyMap<string, CalendarPlanItem>): NextTrainingSession | null {
  const next = week.next
  const plan = next ? planOf.get(next.key) : undefined
  if (!next || !plan) return null
  const startTime = planStartHHMM(plan)
  if (plan.kind === 'block' && plan.timeBlock) {
    return { kind: 'block', id: plan.timeBlock.id, title: plan.title, date: next.date, startTime, taskId: plan.timeBlock.task_id ?? null, routineId: next.routineId }
  }
  if (plan.scheduleBlock) {
    return { kind: 'recurring', id: plan.scheduleBlock.id, title: plan.title, date: next.date, startTime, taskId: plan.dayTask?.id ?? null, routineId: next.routineId }
  }
  return null
}
