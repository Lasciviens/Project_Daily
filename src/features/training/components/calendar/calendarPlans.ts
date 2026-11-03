// The planned training sessions on each day of a range — one-off training
// blocks plus the recurring training templates projected onto every day from
// today on (never before a template's effective_from; one entry per day a
// session STARTS on, so a cross-midnight template has no second "spillover"
// entry). A day before today shows what was stored for it — its day tasks
// (156) — never today's rule drawn back onto it (owner, 03.11.2026: a
// schedule changed from Mon/Tue/Thu/Fri to Tue/Wed/Fri/Sat put sessions on
// every past Wednesday, which never had one, and they read as skipped).
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
 *  rides on its projection, so the day reads as its task says. `today`: from
 *  this day on the templates' rules draw the days; before it only the stored
 *  day tasks do (null: the rules draw every day — older callers). */
export function buildPlansByDate(from: string, to: string, blocks: readonly BlockLike[], templates: readonly TemplateLike[],
                                 dayTasks: readonly TrainingDayTask[] = [], today: string | null = null): Map<string, CalendarPlanItem[]> {
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
      if (today && dateStr < today) {
        // A past day: the sessions it really had — its day tasks, whatever weekday today's rule names (a template that
        // is gone, or no longer training, has nothing to show them by). A day acted on (skipped, moved, ticked) was
        // split into its own slot — the date is in except_dates and the slot carries the task — so the slot shows it,
        // never the day task a second time (on the old day of a moved session either). Before 156 (15.10.2026) days
        // have no day tasks, so such a day shows only its workouts.
        for (const task of dayTasks) {
          if (task.occurrence_date !== dateStr) continue
          const scheduleBlock = training.find(s => s.id === task.schedule_block_id)
          if (!scheduleBlock || scheduleBlock.except_dates?.includes(dateStr) || blocks.some(b => b.task_id === task.id)) continue
          push(dateStr, { id: `${scheduleBlock.id}__${dateStr}`, title: task.title ?? scheduleBlock.title, kind: 'recurring', scheduleBlock: scheduleBlock as ScheduleBlock, dayTask: task })
        }
        continue
      }
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
