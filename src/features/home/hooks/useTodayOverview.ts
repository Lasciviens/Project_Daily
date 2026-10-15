import { useMemo } from 'react'
import { useDayTasks } from '../../todo/hooks/useTodos'
import { useTimeBlocks, useTrainingBlocks, useScheduleBlocks } from '../../daily/hooks/useSchedule'
import { useCalendarEventsForDay } from '../../calendar/hooks/useCalendar'
import { aheadOnDay, buildDaySchedule, plannedMinutes } from '../../daily/daySchedule'
import type { TaskCounts } from '../../todo/taskRules'
import { shiftDateStr, todayStr } from '../../../shared/utils/dateUtils'
import { useNow } from './useNow'
import { pickNextTrainingSession, type NextTrainingSession } from '../../training/trainingPlanModel'
import { NEXT_SESSION_LOOKAHEAD_DAYS } from '../../training/hooks/useTrainingSessions'
import type { ScheduleBlock } from '../../daily/types'

// ─────────────────────────────────────────────────────────────────────────────
//  One source for "what does a day look like": its task counts (the one day
//  list, taskRules.dayTasks), what's next and how much time it holds (the one
//  day schedule, daily/daySchedule) and the next training session. The Home
//  hero and Daily's rail read this; Daily's agenda builds the same schedule.
// ─────────────────────────────────────────────────────────────────────────────

export interface NextUpItem {
  /** Unique on the day (a weekly plan can show twice: yesterday's tail and today's). */
  key: string
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
  tasks: TaskCounts
  nextUp: NextUpItem | null
  /** Everything left on the viewed day's schedule, in order (in-progress first). */
  upcoming: NextUpItem[]
  /** Minutes the day's schedule holds (every timed item, its own portion). */
  plannedMinutes: number
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

export function useTodayOverview(date: string = todayStr()): TodayOverview {
  const prevDay = shiftDateStr(date, -1)
  const trainingTo = shiftDateStr(date, NEXT_SESSION_LOOKAHEAD_DAYS)

  const dayTasks = useDayTasks(date)
  const blocksQ = useTimeBlocks(date)
  const prevBlocksQ = useTimeBlocks(prevDay)
  const templatesQ = useScheduleBlocks()
  const calendarQ = useCalendarEventsForDay(date)
  const trainingQ = useTrainingBlocks(date, trainingTo)
  // The clock ticks on today, so "Now" / "Next up" move on without a refetch.
  const nowMs = useNow(date === todayStr(), 60_000)

  return useMemo(() => {
    const isToday = date === todayStr()
    const now = new Date(nowMs)
    const nowHour = now.getHours() + now.getMinutes() / 60

    const templates: ScheduleBlock[] = templatesQ.data ?? []
    // A repeat's day that is a task (156) carries its state: a ticked one is never "next".
    const items = buildDaySchedule({
      date, blocks: blocksQ.data ?? [], prevBlocks: prevBlocksQ.data ?? [], templates, events: calendarQ.data ?? [],
      dayTasks: [...dayTasks.open, ...dayTasks.done, ...dayTasks.cancelled],
    })
    const upcoming: NextUpItem[] = aheadOnDay(items, isToday, nowHour).map(i => ({
      key: i.id, kind: i.kind, id: i.canonicalId, title: i.title, startHour: i.startHour, endHour: i.endHour,
      inProgress: i.inProgress, startLabel: hourLabel(i.startHour), taskId: i.taskId,
      category: i.block?.category ?? i.template?.category ?? null, planDate: i.planDate,
    }))

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
      tasks: dayTasks.counts,
      nextUp: upcoming[0] ?? null,
      upcoming,
      plannedMinutes: plannedMinutes(items),
      nextTraining,
      trainingAfterNext,
      isLoading: dayTasks.isLoading || blocksQ.isLoading || templatesQ.isLoading,
    }
  }, [date, nowMs, dayTasks.open, dayTasks.done, dayTasks.cancelled, dayTasks.counts, dayTasks.isLoading, blocksQ.data, blocksQ.isLoading, prevBlocksQ.data, templatesQ.data, templatesQ.isLoading, calendarQ.data, trainingQ.data])
}
