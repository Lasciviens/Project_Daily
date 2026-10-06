import { useMemo } from 'react'
import { useTasksForDay } from '../../todo/hooks/useTodos'
import { useTimeBlocks, useTrainingBlocks, useScheduleBlocks } from '../../daily/hooks/useSchedule'
import { useCalendarEventsForDay } from '../../calendar/hooks/useCalendar'
import {
  projectOneOffBlocksForDay, projectRecurringBlocksForDay, projectCalendarEventForDay,
} from '../../daily/components/dayAgendaProjection'
import { closedOn, isOverdue } from '../../todo/taskRules'
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
  /** The block's / template's own category ('training' opens the session
   *  popup, like Daily's agenda). */
  category?: string | null
  /** The day this occurrence starts on (the day before for the tail of one
   *  that crossed midnight) — a recurring occurrence's identity. */
  planDate?: string
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
  /** The training session after `nextTraining` — what the Home hero shows when
   *  the next training is already the "Next up" item, so one session is never
   *  shown twice side by side. */
  trainingAfterNext: NextTrainingItem | null
  isLoading: boolean
}

const hourLabel = (h: number) => {
  const whole = Math.floor(h)
  const min = Math.round((h - whole) * 60)
  return `${String(whole + Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

/** 'HH:MM' one minute later ('23:59' → '24:00', which sorts after every time that day). */
function minuteAfter(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const t = h * 60 + m + 1
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
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

    // Counts: done only when it was closed on this day (completed_at), cancelled never counts.
    const tasks = (tasksQ.data ?? []).filter(t =>
      t.status !== 'cancelled' && (t.status !== 'done' || closedOn(t, date)))
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

    const blockById = new Map([...(prevBlocksQ.data ?? []), ...blocks].map(b => [b.id, b]))
    const templateById = new Map(templates.map(t => [t.id, t]))
    const items: NextUpItem[] = []
    for (const p of projectOneOffBlocksForDay(blocks, prevBlocksQ.data ?? [])) {
      if (p.startHour < 0) continue // unscheduled — no place in a timeline
      const b = blockById.get(p.canonicalId)
      items.push({ kind: 'block', id: p.canonicalId, title: p.title, startHour: p.startHour, endHour: p.endHour, inProgress: false, startLabel: hourLabel(p.startHour), taskId: p.taskId, category: b?.category ?? null, planDate: b?.date ?? date })
    }
    for (const p of projectRecurringBlocksForDay(date, dayOfWeekOf(date), templates)) {
      items.push({ kind: 'recurring', id: p.canonicalId, title: p.title, startHour: p.startHour, endHour: p.endHour, inProgress: false, startLabel: hourLabel(p.startHour), category: templateById.get(p.canonicalId)?.category ?? null, planDate: p.spillover ? prevDay : date })
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
    const trainingTemplates = templates.filter(t => t.category === 'training')
    const nextTraining = pickNextTrainingSession({
      blocks:        trainingQ.data ?? [],
      templates:     trainingTemplates,
      today:         date,
      nowHHMM:       isToday ? hourLabel(nowHour) : '00:00',
      lookaheadDays: NEXT_SESSION_LOOKAHEAD_DAYS,
    })
    // From one minute after the next session starts (anything at the same
    // time is the same slot), so this is a genuinely later session.
    const trainingAfterNext = nextTraining ? pickNextTrainingSession({
      blocks:        (trainingQ.data ?? []).filter(b => !(nextTraining.kind === 'block' && b.id === nextTraining.id)),
      templates:     trainingTemplates,
      today:         nextTraining.date,
      nowHHMM:       nextTraining.startTime ? minuteAfter(nextTraining.startTime) : '99:99',
      lookaheadDays: NEXT_SESSION_LOOKAHEAD_DAYS,
    }) : null

    return {
      tasks: taskCounts,
      nextUp: upcoming[0] ?? null,
      upcoming,
      nextTraining,
      trainingAfterNext,
      isLoading: tasksQ.isLoading || blocksQ.isLoading || templatesQ.isLoading,
    }
  }, [date, prevDay, tasksQ.data, tasksQ.isLoading, blocksQ.data, blocksQ.isLoading, prevBlocksQ.data, templatesQ.data, templatesQ.isLoading, calendarQ.data, trainingQ.data])
}
