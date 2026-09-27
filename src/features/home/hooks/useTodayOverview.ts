import { useMemo } from 'react'
import { useTasksForDay } from '../../todo/hooks/useTodos'
import { useTimeBlocks, useTrainingBlocks, useScheduleBlocks } from '../../daily/hooks/useSchedule'
import { useCalendarEventsForDay } from '../../calendar/hooks/useCalendar'
import {
  projectOneOffBlocksForDay, projectRecurringBlocksForDay, projectCalendarEventForDay,
} from '../../daily/components/dayAgendaProjection'
import { completedWithinLast24h, isOverdue } from '../../todo/taskRules'
import { shiftDateStr, todayStr } from '../../../shared/utils/dateUtils'
import { pickNextTrainingSession, type NextTrainingSession } from '../../training/trainingPlanModel'
import { NEXT_SESSION_LOOKAHEAD_DAYS } from '../../training/hooks/useTrainingSessions'
import type { ScheduleBlock } from '../../daily/types'

// ─────────────────────────────────────────────────────────────────────────────
//  One source for "what does today look like": task counts, what's next on
//  the schedule and the next training session. The Home hero, Daily's quick
//  rail and the training card should all read this instead of re-deriving it
//  (each copy used to disagree — cancelled tasks in one denominator and not
//  another, recurring templates and calendar events missing from "next up").
// ─────────────────────────────────────────────────────────────────────────────

export interface NextUpItem {
  kind: 'block' | 'recurring' | 'calendar'
  /** Real time_blocks / schedule_blocks id or Google event id (edit routing). */
  id: string
  title: string
  startHour: number
  endHour: number
  /** Already started, not yet over (only meaningful for today). */
  inProgress: boolean
  /** 'HH:mm' of the start on the viewed day. */
  startLabel: string
  taskId?: string | null
}

/** The ONE next-training definition (trainingPlanModel.pickNextTrainingSession),
 *  shared with the Training banner and Daily. */
export type NextTrainingItem = NextTrainingSession

export interface TodayOverview {
  tasks: { open: number; done: number; overdue: number; total: number }
  nextUp: NextUpItem | null
  /** Everything left on the viewed day's schedule, in order (in-progress first). */
  upcoming: NextUpItem[]
  nextTraining: NextTrainingItem | null
  isLoading: boolean
}

const hourLabel = (h: number) => {
  const whole = Math.floor(h)
  const min = Math.round((h - whole) * 60)
  return `${String(whole + Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

const dayOfWeekOf = (dateStr: string) => new Date(`${dateStr}T00:00:00`).getDay()

export function useTodayOverview(date: string = todayStr()): TodayOverview {
  const prevDay = shiftDateStr(date, -1)
  const trainingTo = shiftDateStr(date, NEXT_SESSION_LOOKAHEAD_DAYS)

  const tasksQ = useTasksForDay(new Date(`${date}T00:00:00`), 'today')
  const blocksQ = useTimeBlocks(date)
  const prevBlocksQ = useTimeBlocks(prevDay)
  const templatesQ = useScheduleBlocks()
  const calendarQ = useCalendarEventsForDay(date)
  const trainingQ = useTrainingBlocks(date, trainingTo)

  return useMemo(() => {
    const isToday = date === todayStr()
    const now = new Date()
    const nowHour = now.getHours() + now.getMinutes() / 60

    // Counts: the Daily/Home rule — done only while <24h old, cancelled never counts.
    const tasks = (tasksQ.data ?? []).filter(t =>
      t.status !== 'cancelled' && (t.status !== 'done' || completedWithinLast24h(t.updated_at)))
    const taskCounts = {
      open: tasks.filter(t => t.status !== 'done').length,
      done: tasks.filter(t => t.status === 'done').length,
      overdue: tasks.filter(isOverdue).length,
      total: tasks.length,
    }

    const blocks = blocksQ.data ?? []
    const templates: ScheduleBlock[] = templatesQ.data ?? []
    const linkedEventIds = new Set(
      [...blocks, ...(prevBlocksQ.data ?? [])].map(b => b.google_calendar_event_id).filter(Boolean) as string[],
    )

    const items: NextUpItem[] = []
    for (const p of projectOneOffBlocksForDay(blocks, prevBlocksQ.data ?? [])) {
      if (p.startHour < 0) continue // unscheduled — no place in a timeline
      items.push({ kind: 'block', id: p.canonicalId, title: p.title, startHour: p.startHour, endHour: p.endHour, inProgress: false, startLabel: hourLabel(p.startHour), taskId: p.taskId })
    }
    for (const p of projectRecurringBlocksForDay(date, dayOfWeekOf(date), templates)) {
      items.push({ kind: 'recurring', id: p.canonicalId, title: p.title, startHour: p.startHour, endHour: p.endHour, inProgress: false, startLabel: hourLabel(p.startHour) })
    }
    for (const e of calendarQ.data ?? []) {
      if (linkedEventIds.has(e.id)) continue // already shown as its block
      const p = projectCalendarEventForDay(date, e)
      if (!p) continue
      items.push({ kind: 'calendar', id: e.id, title: e.summary || '(No title)', startHour: p.startHour, endHour: p.endHour, inProgress: false, startLabel: hourLabel(p.startHour) })
    }

    const upcoming = items
      .filter(i => !isToday || i.endHour > nowHour)
      .map(i => ({ ...i, inProgress: isToday && i.startHour <= nowHour && i.endHour > nowHour }))
      .sort((a, b) => a.startHour - b.startHour)

    // Next training from the viewed day on: one-off training blocks plus
    // recurring training templates — the same pure rule the Training banner
    // uses (useNextTrainingSession). Only today filters out passed times.
    const nextTraining = pickNextTrainingSession({
      blocks:        trainingQ.data ?? [],
      templates:     templates.filter(t => t.category === 'training'),
      today:         date,
      nowHHMM:       isToday ? hourLabel(nowHour) : '00:00',
      lookaheadDays: NEXT_SESSION_LOOKAHEAD_DAYS,
    })

    return {
      tasks: taskCounts,
      nextUp: upcoming[0] ?? null,
      upcoming,
      nextTraining,
      isLoading: tasksQ.isLoading || blocksQ.isLoading || templatesQ.isLoading,
    }
  }, [date, tasksQ.data, tasksQ.isLoading, blocksQ.data, blocksQ.isLoading, prevBlocksQ.data, templatesQ.data, templatesQ.isLoading, calendarQ.data, trainingQ.data])
}
