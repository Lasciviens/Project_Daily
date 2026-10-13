// THE schedule of one day — what is on it, what is next and how much time it
// holds. Pure (type imports + the pure projection helpers), checked by
// scripts/verify-task-model.cjs.
//
// Three places used to answer "what's next" on their own (owner, 12.10.2026):
// Daily's agenda (the first row starting after now — a block whose task was
// already done included), Daily's rail (one-off blocks only, from now on, no
// weekly plans or calendar events, a block under way dropped) and Home (all
// three kinds, a block under way first, a closed task's block left out). The
// rail and the agenda also summed "planned" time differently. Every surface
// now builds the day with buildDaySchedule and asks aheadOnDay / plannedMinutes.

import {
  projectCalendarEventForDay, projectOneOffBlocksForDay, projectRecurringBlocksForDay,
} from './components/dayAgendaProjection'
import type { ScheduleBlock, TimeBlock } from './types'
import type { CalendarEvent } from '../calendar/types'

export interface DayItem {
  /** Unique on this day (the tail of yesterday's block has its own). */
  id:          string
  /** The real time_blocks / schedule_blocks id, or the Google event id. */
  canonicalId: string
  kind:        'block' | 'recurring' | 'calendar'
  title:       string
  /** Hours on this day, clipped to [0, 24); -1 for no time (a block without
   *  a start, an all-day event). */
  startHour:   number
  endHour:     number
  /** The tail of something that started the day before. */
  spillover:   boolean
  allDay:      boolean
  /** The day this occurrence starts on — a recurring occurrence's identity. */
  planDate:    string
  taskId:      string | null
  /** Its task is done or cancelled: over, never "next" (it stays on the agenda). */
  closed:      boolean
  block?:      TimeBlock
  template?:   ScheduleBlock
  event?:      CalendarEvent
}

function shiftDay(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const closedStatus = (s: TimeBlock['task_status']) => s === 'done' || s === 'cancelled'

/** Every item on `date`: one-off blocks (and yesterday's tails), weekly plans,
 *  and Google events not already shown as their own block. */
export function buildDaySchedule(input: {
  date:       string
  blocks:     readonly TimeBlock[]
  prevBlocks: readonly TimeBlock[]
  templates:  readonly ScheduleBlock[]
  events:     readonly CalendarEvent[]
}): DayItem[] {
  const { date, blocks, prevBlocks, templates, events } = input
  const prevDay = shiftDay(date, -1)
  const items: DayItem[] = []

  const templateById = new Map(templates.map(t => [t.id, t]))
  for (const p of projectRecurringBlocksForDay(date, templates)) {
    items.push({
      id: p.id, canonicalId: p.canonicalId, kind: 'recurring', title: p.title,
      startHour: p.startHour, endHour: p.endHour, spillover: p.spillover, allDay: false,
      planDate: p.spillover ? prevDay : date, taskId: null, closed: false,
      template: templateById.get(p.canonicalId),
    })
  }

  const blockById = new Map([...prevBlocks, ...blocks].map(b => [b.id, b]))
  for (const p of projectOneOffBlocksForDay([...blocks], [...prevBlocks])) {
    const b = blockById.get(p.canonicalId)
    items.push({
      id: p.id, canonicalId: p.canonicalId, kind: 'block', title: p.title,
      startHour: p.startHour, endHour: p.endHour, spillover: p.spillover, allDay: false,
      planDate: b?.date ?? date, taskId: p.taskId ?? null, closed: closedStatus(b?.task_status),
      block: b,
    })
  }

  // A block's own event is that block; Google returns yesterday's
  // cross-midnight event for today too, so yesterday's blocks count here.
  const linked = new Set([...blocks, ...prevBlocks].map(b => b.google_calendar_event_id).filter(Boolean))
  for (const e of events) {
    if (linked.has(e.id)) continue
    if (e.start.dateTime) {
      const p = projectCalendarEventForDay(date, e)
      if (!p) continue
      items.push({
        id: e.id, canonicalId: e.id, kind: 'calendar', title: e.summary || '(No title)',
        startHour: p.startHour, endHour: p.endHour, spillover: p.spillover, allDay: false,
        planDate: p.spillover ? prevDay : date, taskId: null, closed: false, event: e,
      })
    } else if (e.start.date) {
      items.push({
        id: e.id, canonicalId: e.id, kind: 'calendar', title: e.summary || '(No title)',
        startHour: -1, endHour: -1, spillover: false, allDay: true,
        planDate: date, taskId: null, closed: false, event: e,
      })
    }
  }
  return items
}

/** Items with a time, in start order. */
export function timedItems<T extends Pick<DayItem, 'startHour' | 'allDay'>>(items: readonly T[]): T[] {
  return items.filter(i => !i.allDay && i.startHour >= 0).sort((a, b) => a.startHour - b.startHour)
}

/** Minutes the day holds — every timed item, its own day's portion only. */
export function plannedMinutes(items: readonly Pick<DayItem, 'startHour' | 'endHour' | 'allDay'>[]): number {
  return Math.round(timedItems(items).reduce((s, i) => s + Math.max(0, (i.endHour - i.startHour) * 60), 0))
}

/**
 * What is still ahead: timed items not yet over (on today; every one on
 * another day), never one whose task is closed, in start order. The first is
 * "Next up" — "Now" while it is under way (`inProgress`).
 */
export function aheadOnDay<T extends Pick<DayItem, 'startHour' | 'endHour' | 'allDay' | 'closed'>>(
  items: readonly T[], isToday: boolean, nowHour: number,
): (T & { inProgress: boolean })[] {
  return timedItems(items)
    .filter(i => !i.closed && (!isToday || i.endHour > nowHour))
    .map(i => ({ ...i, inProgress: isToday && i.startHour <= nowHour && i.endHour > nowHour }))
}
