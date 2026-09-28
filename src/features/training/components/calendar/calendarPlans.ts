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

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

type BlockLike = Pick<TimeBlock, 'id' | 'title' | 'date'> & Partial<TimeBlock>
type TemplateLike = RecurringBlockLike & Partial<ScheduleBlock>

/** `templates` may include non-training ones; only category 'training' counts. */
export function buildPlansByDate(from: string, to: string, blocks: readonly BlockLike[], templates: readonly TemplateLike[]): Map<string, CalendarPlanItem[]> {
  const m = new Map<string, CalendarPlanItem[]>()
  const push = (date: string, item: CalendarPlanItem) => m.set(date, [...(m.get(date) ?? []), item])

  for (const b of blocks) {
    if (b.date < from || b.date > to) continue
    push(b.date, { id: b.id, title: b.title, kind: 'block', timeBlock: b as TimeBlock })
  }

  const training = templates.filter(t => t.category === 'training')
  if (training.length > 0) {
    for (let cursor = new Date(`${from}T12:00:00`); ymd(cursor) <= to; cursor.setDate(cursor.getDate() + 1)) {
      const dateStr = ymd(cursor)
      for (const p of projectRecurringBlocksForDay(dateStr, cursor.getDay(), training)) {
        if (p.spillover) continue
        const scheduleBlock = training.find(s => s.id === p.canonicalId)
        if (scheduleBlock) push(dateStr, { id: `${p.canonicalId}__${dateStr}`, title: p.title, kind: 'recurring', scheduleBlock: scheduleBlock as ScheduleBlock })
      }
    }
  }
  return m
}
