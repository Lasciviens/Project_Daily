// THE day as ONE list (owner, 15.10.2026: "one item"). A day used to be two
// panes — Schedule (slots, repeating plans, Google events) and Tasks — so a
// task with its slot showed twice and a repeat could not be ticked. Here every
// thing on a day becomes one row, split by TIME, never by the table a row
// lives in:
//   - a task with its slot on this day is ONE row (at the slot's time);
//   - a day of a repeating plan is a row with the Repeat mark — not acted on
//     yet (the plan's projection), or done / skipped (142's one-off day: a
//     task + slot that names the plan and the day);
//   - a Google event the app didn't make keeps its own row (no tick);
//   - a task with a time and no slot sits at that time as a moment; anything
//     with no time is "Anytime".
// Timed rows keep their place whatever their state (a ticked one is dimmed in
// its slot); untimed ones split into Anytime / Done / Cancelled. A day of a
// repeat that passed without a tick stays on its day as missed — never
// carried over.
//
// It reads only what the day reads already (useDayTasks' list, the one day
// schedule of daySchedule.ts, the slots' own tasks): nothing is filtered out
// of a task query (NEVER_HIDES). Pure — scripts/verify-day-items.cjs.

import { projectRecurringBlocksForDay, type RecurringBlockLike } from './components/dayAgendaProjection'
import { addDaysIso, dayNumber } from './recurrence'
import type { DayItem } from './daySchedule'
import type { Task, TaskStatus } from '../todo/types'

/** What a row can still become. null = nothing to tick (a Google event, a slot with no task). */
export type RowState = 'open' | 'missed' | 'done' | 'skipped' | 'cancelled'

/**
 * Which controls a row gets:
 *  task     — a task (with its slot on this day when it has one): the task row and its actions;
 *  repeat   — a day of a repeating plan: tick / skip / undo that day (useRepeatDay);
 *  training — a planned training session (a slot or a plan's day): the session's own actions;
 *  slot     — a one-off slot with no task (made before "Convert old items"): no tick;
 *  event    — a Google Calendar event the app didn't make: no tick.
 */
export type RowKind = 'task' | 'repeat' | 'training' | 'slot' | 'event'

export type RowTask = Pick<Task, 'id' | 'title' | 'status' | 'due_date' | 'due_time'>

export interface DayRow<T extends RowTask = Task> {
  /** Unique on this day. */
  key:       string
  kind:      RowKind
  title:     string
  /** Hours on this day; null = anytime. */
  startHour: number | null
  /** Where a span ends on this day; null for a moment ("at 14:00") or anytime. */
  endHour:   number | null
  /** Holds time (counts as planned, can overlap). */
  busy:      boolean
  /** The part after midnight of something that started the day before. */
  spillover: boolean
  /** A Google all-day event. */
  allDay:    boolean
  state:     RowState | null
  /** The task behind the row, when it has one. */
  task:      T | null
  /** The schedule item behind it (slot, plan day, Google event), when it has one. */
  item:      DayItem | null
  /** A day of a repeating plan: the plan and the day (`acted`: the day already
   *  became its own task + slot — done, skipped or moved). */
  repeat:    { scheduleBlockId: string; date: string; acted: boolean } | null
  /** Shares time with another row that holds time. */
  overlaps:  boolean
}

export interface DayRows<T extends RowTask = Task> {
  /** No time, still to do (a missed repeat day too) — and all-day events. */
  anytime:   DayRow<T>[]
  /** Everything with a time, in time order, whatever its state. */
  timed:     DayRow<T>[]
  /** No time, done on this day. */
  done:      DayRow<T>[]
  /** No time, cancelled or skipped. */
  cancelled: DayRow<T>[]
}

/** Hours on a day as HH:MM (9.5 → "09:30"). */
export function hourLabel(h: number): string {
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/** Where a span ends on its day: past midnight it ends at "midnight", never "24:00". */
export const untilLabel = (h: number) => (h >= 24 ? 'midnight' : hourLabel(h))

/**
 * The sheet for one day of a repeat: `occurrenceDate` makes it offer This day
 * | All days (the one-item sheet); `defaults.date` is the day for an older one.
 * Built as a value, not a literal, so the request also type-checks where the
 * request type doesn't list `occurrenceDate` yet.
 */
export function repeatDayRequest(scheduleBlockId: string, date: string) {
  const request = { kind: 'schedule-block' as const, id: scheduleBlockId, occurrenceDate: date, defaults: { date } }
  return request
}

const hourOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h + (m || 0) / 60
}

function taskState(status: TaskStatus | null | undefined): RowState {
  if (status === 'done') return 'done'
  if (status === 'cancelled') return 'cancelled'
  return 'open'
}

/** A repeat's day: done / skipped (its one-off task), else missed once the day is over. */
function repeatState(status: TaskStatus | null | undefined, date: string, today: string): RowState {
  if (status === 'done') return 'done'
  if (status === 'cancelled') return 'skipped'
  return date < today ? 'missed' : 'open'
}

const isTraining = (i: DayItem) => (i.block ?? i.template)?.category === 'training'

/**
 * The day's rows. `tasks`: the day list (useDayTasks — open, done, cancelled);
 * `items`: the day schedule (buildDaySchedule); `linkedTasks`: the tasks of the
 * day's slots that are not on the day list (a slot on another day than its
 * task's date) — read by id, so a slot's row can still be ticked.
 */
export function buildDayRows<T extends RowTask>(input: {
  day:         string
  today:       string
  tasks:       { open: readonly T[]; done: readonly T[]; cancelled: readonly T[] }
  items:       readonly DayItem[]
  linkedTasks?: readonly T[]
}): DayRows<T> {
  const { day, today, tasks, items } = input
  const dayList = [...tasks.open, ...tasks.done, ...tasks.cancelled]
  const onList = new Map(dayList.map(t => [t.id, t]))
  const linked = new Map((input.linkedTasks ?? []).map(t => [t.id, t]))
  const placed = new Set<string>()
  const rows: DayRow<T>[] = []

  for (const i of items) {
    const timed = !i.allDay && i.startHour >= 0
    const busy = timed && i.busy
    const base = {
      key: i.id, title: i.title,
      startHour: timed ? i.startHour : null,
      endHour: busy ? i.endHour : null,
      busy, spillover: i.spillover, allDay: i.allDay, item: i, overlaps: false,
    }
    if (i.kind === 'calendar') {
      rows.push({ ...base, kind: 'event', state: null, task: null, repeat: null })
      continue
    }
    if (i.kind === 'recurring') {
      // A plan's day nobody acted on yet (acted-on days left the plan, 142).
      rows.push({
        ...base, kind: isTraining(i) ? 'training' : 'repeat', task: null,
        state: repeatState(null, i.planDate, today),
        repeat: { scheduleBlockId: i.canonicalId, date: i.planDate, acted: false },
      })
      continue
    }
    const b = i.block
    const task = i.taskId ? onList.get(i.taskId) ?? linked.get(i.taskId) ?? null : null
    // The tail of yesterday's slot is a continuation; the task's own row is yesterday's.
    if (task && !i.spillover) placed.add(task.id)
    const status = task?.status ?? b?.task_status ?? null
    const repeat = b?.schedule_block_id && b.occurrence_date && i.taskId
      ? { scheduleBlockId: b.schedule_block_id, date: b.occurrence_date, acted: true }
      : null
    const kind: RowKind = isTraining(i) ? 'training' : repeat ? 'repeat' : i.taskId ? 'task' : 'slot'
    rows.push({
      ...base, kind, task, repeat,
      state: !i.taskId ? null : repeat ? repeatState(status, repeat.date, today) : taskState(status),
    })
  }

  // Tasks with no slot on this day: at their time as a moment, else anytime.
  for (const t of dayList) {
    if (placed.has(t.id)) continue
    const at = t.due_date === day && t.due_time ? hourOf(t.due_time) : null
    rows.push({
      key: `task:${t.id}`, kind: 'task', title: t.title, startHour: at, endHour: null, busy: false,
      spillover: false, allDay: false, state: taskState(t.status), task: t, item: null, repeat: null, overlaps: false,
    })
  }

  markOverlaps(rows)
  const timed = rows.filter(r => r.startHour !== null)
    .map((r, n) => ({ r, n }))
    .sort((a, b) => a.r.startHour! - b.r.startHour! || Number(b.r.spillover) - Number(a.r.spillover) || a.n - b.n)
    .map(x => x.r)
  const untimed = rows.filter(r => r.startHour === null)
  // All-day events first (context for the day), then the rest in their order.
  const anytime = untimed.filter(r => r.state === null || r.state === 'open' || r.state === 'missed')
    .map((r, n) => ({ r, n }))
    .sort((a, b) => Number(b.r.kind === 'event') - Number(a.r.kind === 'event') || a.n - b.n)
    .map(x => x.r)
  return {
    anytime,
    timed,
    done: untimed.filter(r => r.state === 'done'),
    cancelled: untimed.filter(r => r.state === 'skipped' || r.state === 'cancelled'),
  }
}

/** Spans that hold time share it: a skipped or cancelled one no longer takes its time. */
function markOverlaps(rows: DayRow<RowTask>[]) {
  const spans = rows.filter(r => r.busy && r.startHour !== null && r.endHour !== null && r.state !== 'skipped' && r.state !== 'cancelled')
  for (let a = 0; a < spans.length; a++) {
    for (let b = a + 1; b < spans.length; b++) {
      if (spans[a].startHour! < spans[b].endHour! && spans[a].endHour! > spans[b].startHour!) {
        spans[a].overlaps = true
        spans[b].overlaps = true
      }
    }
  }
}

/** The day's numbers for its header: open = the day list's open tasks plus the
 *  repeat days still to do on it (repeatsToDoOn); done = the day list's. */
export function dayRowCounts(taskCounts: { open: number; done: number }, repeatsToDo: number): { open: number; done: number } {
  return { open: taskCounts.open + repeatsToDo, done: taskCounts.done }
}

// ── Repeats in the week strip, the week card and the month ──────────────────

/** How many days of repeating plans start on `day` and nobody acted on yet
 *  (a day acted on is its own task and counts as a task). */
export function repeatDaysOn(templates: readonly RecurringBlockLike[], day: string): number {
  return projectRecurringBlocksForDay(day, templates).filter(p => !p.spillover).length
}

/**
 * Repeat days still to do on `day`: from today on. A day that passed without a
 * tick is missed — it stays on its day (the day view shows it), but it is no
 * longer "open": a count can't see a training day a workout already covered.
 */
export function repeatsToDoOn(templates: readonly RecurringBlockLike[], day: string, today: string): number {
  return day < today ? 0 : repeatDaysOn(templates, day)
}

/** Repeat days still to do between `from` and `to` (inclusive, yyyy-MM-dd). */
export function repeatsToDoBetween(templates: readonly RecurringBlockLike[], from: string, to: string, today: string): number {
  let n = 0
  const days = dayNumber(to) - dayNumber(from)
  for (let d = 0; d <= days; d++) n += repeatsToDoOn(templates, addDaysIso(from, d), today)
  return n
}

/** A week's open / done / % with its repeat days still to do counted as open. */
export function withRepeats(counts: { open: number; done: number }, repeatsToDo: number): { open: number; done: number; percent: number } {
  const open = counts.open + repeatsToDo
  const total = open + counts.done
  return { open, done: counts.done, percent: total ? Math.round((counts.done / total) * 100) : 0 }
}
