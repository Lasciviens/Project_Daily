// Planned-training rules shared by the "next session" banner and Home (a
// plan's status lives in plan/sessionState) — pure and import-free apart from the (also pure) recurring
// projection helper and sessionState (scripts/verify-hevy-training.cjs).

import { projectRecurringBlocksForDay, type RecurringBlockLike } from '../daily/components/dayAgendaProjection'
import { sessionStatus } from './plan/sessionState'
import type { TaskStatus } from '../todo/types'

// ── Next session ─────────────────────────────────────────────────────────────
// The soonest planned training session from now: one-off training blocks
// AND recurring training templates projected day by day. The Training banner
// used to read one-off blocks only, so a Mon/Wed/Fri recurring plan showed on
// Home ("Next training: Push · Mon 16:30") but not on the Training page.

export interface OneOffTrainingBlock {
  id:         string
  title:      string
  date:       string          // yyyy-MM-dd
  start_time: string | null   // HH:MM[:SS]
  task_id?:   string | null
  /** Its linked task's status: a done or cancelled one is not a session to come. */
  task_status?: string | null
}

export interface NextTrainingSession {
  kind:      'block' | 'recurring'
  /** time_blocks id for 'block', schedule_blocks id for 'recurring'. */
  id:        string
  title:     string
  date:      string
  startTime: string | null   // HH:MM
  taskId:    string | null
  /** The routine it trains, when known (the week model's next, useNextTrainingSession). */
  routineId?: string | null
  /** The day to do it when that is not its planned day: a missed session still
   *  open this week, or one the week shifted (sessionState.planWeek); null =
   *  no day left this week (carried into next week). */
  doOn?: string | null
}

function shiftDay(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + delta)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function hhmm(hour: number): string {
  const h = Math.floor(hour)
  const m = Math.round((hour - h) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** A training repeat's day that is a task on its day (156, no slot). */
export interface TrainingDayTaskLike {
  schedule_block_id: string
  occurrence_date:   string
  status:            TaskStatus
  closed_reason?:    string | null
}

/** `templates` must already be the training ones. Today's session stays next
 *  all day (owner's sessions proposal, 27.11.2026: it used to drop once its
 *  start time passed); a block whose task is done (trained — migration 141) or
 *  cancelled is not. `nowHHMM` no longer filters (kept for the callers).
 *  `dayTasks`: a weekly day closed as its task (a Hevy workout or a Google
 *  Tasks tick, no split) is not one to come either — sessionState decides
 *  (a day closed as missed is still to do there). */
export function pickNextTrainingSession(input: {
  blocks:        readonly OneOffTrainingBlock[]
  templates:     readonly RecurringBlockLike[]
  dayTasks?:     readonly TrainingDayTaskLike[]
  today:         string
  nowHHMM:       string
  lookaheadDays: number
}): NextTrainingSession | null {
  const { blocks, templates, today, lookaheadDays } = input
  const closedDays = new Set((input.dayTasks ?? [])
    .filter(t => !sessionStatus({ date: t.occurrence_date, taskStatus: t.status, taskMissed: t.closed_reason === 'missed', today }).open)
    .map(t => `${t.schedule_block_id}:${t.occurrence_date}`))
  const candidates: NextTrainingSession[] = blocks
    .filter(b => b.task_status !== 'done' && b.task_status !== 'cancelled')
    .filter(b => b.date >= today)
    .map(b => ({ kind: 'block' as const, id: b.id, title: b.title, date: b.date, startTime: b.start_time?.slice(0, 5) ?? null, taskId: b.task_id ?? null }))

  if (templates.length > 0) {
    for (let i = 0; i <= lookaheadDays; i++) {
      const day = shiftDay(today, i)
      const hit = projectRecurringBlocksForDay(day, templates)
        .filter(p => !p.spillover && !closedDays.has(`${p.canonicalId}:${day}`))
        .sort((a, b) => a.startHour - b.startHour)[0]
      if (hit) {
        candidates.push({ kind: 'recurring', id: hit.canonicalId, title: hit.title, date: day, startTime: hhmm(hit.startHour), taskId: null })
        break
      }
    }
  }

  return candidates
    .sort((a, b) => (a.date + (a.startTime ?? '99:99')).localeCompare(b.date + (b.startTime ?? '99:99')) || a.id.localeCompare(b.id))[0] ?? null
}
