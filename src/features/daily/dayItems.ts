// THE day as ONE list (owner, 15.10.2026: "one item"). A day used to be two
// panes — Schedule (slots, repeating plans, Google events) and Tasks — so a
// task with its slot showed twice and a repeat could not be ticked. Here every
// thing on a day becomes one row, split by TIME, never by the table a row
// lives in:
//   - a task with its slot on this day is ONE row (at the slot's time);
//   - a day of a repeating plan is a row with the Repeat mark: the plan's
//     projection and, since 156, the day's own task (made on its day — the
//     same row, never two), or 142's one-off day (a task + slot that names
//     the plan and the day) once it was edited on its own;
//   - a Google event the app didn't make keeps its own row (no tick);
//   - a task with a time and no slot sits at that time as a moment; anything
//     with no time is "Anytime".
// Timed rows keep their place whatever their state (a ticked one is dimmed in
// its slot); untimed ones split into Anytime / Done / Cancelled. A day of a
// repeat that passed without a tick stays on its day as missed (156 closes
// its task as missed: cancelled + closed_reason) — never carried over.
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
  & Partial<Pick<Task, 'schedule_block_id' | 'occurrence_date' | 'closed_reason' | 'source_type' | 'hevy_routine_id'>>

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
  /** A day of a repeating plan: the plan and the day (`acted`: the day is an
   *  item of its own — 142's task + slot, or a day's task (156) that left the
   *  repeat's projection, e.g. moved). A projection with its day's task is not
   *  acted on: the row has `task` and opens the repeat on that day. */
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
  // Rounded as a whole, so 09:59:45 reads 10:00, never 09:60.
  const total = Math.round(h * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
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

/** A repeat's day: done / skipped / missed (its task — 156 closes a day that
 *  passed unticked as missed), else missed once the day is over. */
function repeatState(task: Pick<RowTask, 'status' | 'closed_reason'> | null | undefined, date: string, today: string): RowState {
  if (task?.status === 'done') return 'done'
  if (task?.status === 'cancelled') return task.closed_reason === 'missed' ? 'missed' : 'skipped'
  return date < today ? 'missed' : 'open'
}

/** A day of a repeat (156): `planId:yyyy-MM-dd`. */
export const repeatDayKey = (scheduleBlockId: string, date: string) => `${scheduleBlockId}:${date}`

/** The repeat days that are tasks already (156: made on their day, or ticked
 *  ahead): their projection is the same day, never counted twice. */
export function repeatDayKeys(tasks: readonly Partial<Pick<Task, 'schedule_block_id' | 'occurrence_date'>>[]): Set<string> {
  const keys = new Set<string>()
  for (const t of tasks) if (t.schedule_block_id && t.occurrence_date) keys.add(repeatDayKey(t.schedule_block_id, t.occurrence_date))
  return keys
}

const isTrainingTaskRow = (t: RowTask) => t.source_type === 'training_session' || !!t.hevy_routine_id

const isTraining = (i: DayItem) => (i.block ?? i.template)?.category === 'training'

/**
 * The day's rows. `tasks`: the day list (useDayTasks — open, done, cancelled);
 * `items`: the day schedule (buildDaySchedule); `linkedTasks`: the tasks of the
 * day's slots that are not on the day list (a slot on another day than its
 * task's date) — read by id, so a slot's row can still be ticked;
 * `repeatDays`: the repeat days the day read found (useDayTasks), whatever day
 * they closed on — a day ticked late or ahead is still its own day's state.
 */
export function buildDayRows<T extends RowTask>(input: {
  day:         string
  today:       string
  tasks:       { open: readonly T[]; done: readonly T[]; cancelled: readonly T[] }
  items:       readonly DayItem[]
  linkedTasks?: readonly T[]
  repeatDays?: readonly T[]
}): DayRows<T> {
  const { day, today, tasks, items } = input
  const dayList = [...tasks.open, ...tasks.done, ...tasks.cancelled]
  const onList = new Map(dayList.map(t => [t.id, t]))
  const linked = new Map((input.linkedTasks ?? []).map(t => [t.id, t]))
  // A repeat's day that is a task (156), by the repeat and the day.
  const byDay = new Map<string, T>()
  for (const t of [...(input.repeatDays ?? []), ...dayList, ...(input.linkedTasks ?? [])]) {
    if (t.schedule_block_id && t.occurrence_date) byDay.set(repeatDayKey(t.schedule_block_id, t.occurrence_date), t)
  }
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
      // A plan's day nobody edited on its own (those left the plan, 142) —
      // with its day's task when it has one (156): ONE row, the task's state.
      const task = (i.taskId ? onList.get(i.taskId) ?? linked.get(i.taskId) : null)
        ?? byDay.get(repeatDayKey(i.canonicalId, i.planDate)) ?? null
      if (task && !i.spillover) placed.add(task.id)
      rows.push({
        ...base, kind: isTraining(i) ? 'training' : 'repeat', task,
        state: repeatState(task, i.planDate, today),
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
    // Missed is judged from the slot's day as it is now (a day moved forward
    // isn't missed); `repeat.date` stays the plan's own day (what a tick acts on).
    rows.push({
      ...base, kind, task, repeat,
      state: !i.taskId ? null : repeat ? repeatState(task ?? (status ? { status } : null), b?.date ?? repeat.date, today) : taskState(status),
    })
  }

  // Tasks with no slot on this day: at their time as a moment, else anytime.
  // A repeat's day whose projection isn't here (moved off its day, or the
  // repeat changed since) is still that repeat's day: its row and tick
  // (a training session keeps the task row — it routes to the session).
  for (const t of dayList) {
    if (placed.has(t.id)) continue
    const at = t.due_date === day && t.due_time ? hourOf(t.due_time) : null
    const ofRepeat = t.schedule_block_id && t.occurrence_date && !isTrainingTaskRow(t)
      ? { scheduleBlockId: t.schedule_block_id, date: t.occurrence_date, acted: true } : null
    rows.push({
      key: `task:${t.id}`, kind: ofRepeat ? 'repeat' : 'task', title: t.title, startHour: at, endHour: null, busy: false,
      spillover: false, allDay: false, task: t, item: null, repeat: ofRepeat, overlaps: false,
      state: ofRepeat ? repeatState(t, t.due_date ?? t.occurrence_date!, today) : taskState(t.status),
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
 *  (a day acted on is its own task and counts as a task). `asTasks`: the
 *  repeat days that are tasks already (repeatDayKeys — 156 makes each day's
 *  task on its day): they count as tasks, never twice. */
export function repeatDaysOn(templates: readonly RecurringBlockLike[], day: string, asTasks?: ReadonlySet<string>): number {
  return projectRecurringBlocksForDay(day, templates)
    .filter(p => !p.spillover && !asTasks?.has(repeatDayKey(p.canonicalId, day))).length
}

/**
 * Repeat days still to do on `day`: from today on. A day that passed without a
 * tick is missed — it stays on its day (the day view shows it), but it is no
 * longer "open": a count can't see a training day a workout already covered.
 * A day that is a task already (`asTasks`) is counted with the tasks.
 */
export function repeatsToDoOn(templates: readonly RecurringBlockLike[], day: string, today: string, asTasks?: ReadonlySet<string>): number {
  return day < today ? 0 : repeatDaysOn(templates, day, asTasks)
}

/** Repeat days still to do between `from` and `to` (inclusive, yyyy-MM-dd). */
export function repeatsToDoBetween(templates: readonly RecurringBlockLike[], from: string, to: string, today: string, asTasks?: ReadonlySet<string>): number {
  let n = 0
  const days = dayNumber(to) - dayNumber(from)
  for (let d = 0; d <= days; d++) n += repeatsToDoOn(templates, addDaysIso(from, d), today, asTasks)
  return n
}

/** A week's open / done / % with its repeat days still to do counted as open. */
export function withRepeats(counts: { open: number; done: number }, repeatsToDo: number): { open: number; done: number; percent: number } {
  const open = counts.open + repeatsToDo
  const total = open + counts.done
  return { open, done: counts.done, percent: total ? Math.round((counts.done / total) * 100) : 0 }
}
