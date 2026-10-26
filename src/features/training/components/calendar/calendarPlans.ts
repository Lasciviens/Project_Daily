// The planned training sessions on each day of a range — one-off training
// blocks plus the recurring training templates projected onto every day
// (never before a template's effective_from; one entry per day a session
// STARTS on, so a cross-midnight template has no second "spillover" entry).
// Pure: type-only imports plus the (also pure) projection helper
// (scripts/verify-training-log.cjs). The ONE builder for the calendar and
// the session popup, so both see the same plans with the same ids.

import { projectRecurringBlocksForDay, type RecurringBlockLike } from '../../../daily/components/dayAgendaProjection'
import type { CalendarPlanItem } from './calendarModel'
import type { ScheduleBlock, TimeBlock } from '../../../daily/types'
import type { TrainingDayTask } from '../../../daily/api/scheduleApi'

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

type BlockLike = Pick<TimeBlock, 'id' | 'title' | 'date'> & Partial<TimeBlock>
type TemplateLike = RecurringBlockLike & Partial<ScheduleBlock>

/** `templates` may include non-training ones; only category 'training' counts.
 *  `dayTasks`: the repeats' days that are tasks on their day (156) — each
 *  rides on its projection, so the day reads as its task says. */
export function buildPlansByDate(from: string, to: string, blocks: readonly BlockLike[], templates: readonly TemplateLike[],
                                 dayTasks: readonly TrainingDayTask[] = []): Map<string, CalendarPlanItem[]> {
  const m = new Map<string, CalendarPlanItem[]>()
  const dayTask = new Map(dayTasks.map(t => [`${t.schedule_block_id}:${t.occurrence_date}`, t]))
  const push = (date: string, item: CalendarPlanItem) => m.set(date, [...(m.get(date) ?? []), item])

  for (const b of blocks) {
    if (b.date < from || b.date > to) continue
    push(b.date, { id: b.id, title: b.title, kind: 'block', timeBlock: b as TimeBlock })
  }

  const training = templates.filter(t => t.category === 'training')
  if (training.length > 0) {
    for (let cursor = new Date(`${from}T12:00:00`); ymd(cursor) <= to; cursor.setDate(cursor.getDate() + 1)) {
      const dateStr = ymd(cursor)
      for (const p of projectRecurringBlocksForDay(dateStr, training)) {
        if (p.spillover) continue
        const scheduleBlock = training.find(s => s.id === p.canonicalId)
        if (!scheduleBlock) continue
        const task = dayTask.get(`${p.canonicalId}:${dateStr}`)
        push(dateStr, { id: `${p.canonicalId}__${dateStr}`, title: p.title, kind: 'recurring', scheduleBlock: scheduleBlock as ScheduleBlock, ...(task ? { dayTask: task } : {}) })
      }
    }
  }
  return m
}
