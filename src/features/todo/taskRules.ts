// THE task rules — what is open, when a task was closed, which day it belongs
// to and how it counts. Pure (date-fns + type imports only), checked by
// scripts/verify-task-model.cjs.
//
// Before this (owner, 12.10.2026: "the same thing reads differently on every
// page") Daily, Home and Work each counted on their own: Daily's day pane left
// Waiting tasks out of "open" and showed Done for 24 hours, Daily's rail
// counted every done task ever, Home counted what was closed today, and Work
// read "done today" off updated_at, which any sync or reorder moves. Every
// surface now asks this module.

import { localDayOf, todayStr, tomorrowStr } from '../../shared/utils/dateUtils'
import { formatDate } from '../../shared/utils/dateFormat'
import type { Task, TaskSection, TaskStatus } from './types'

/** Still to do: open, in progress or waiting. */
export const OPEN_STATUSES: readonly TaskStatus[] = ['open', 'in_progress', 'waiting']

export function isOpenTask(task: Pick<Task, 'status'>): boolean {
  return OPEN_STATUSES.includes(task.status)
}

/** Done or cancelled. */
export function isClosedTask(task: Pick<Task, 'status'>): boolean {
  return task.status === 'done' || task.status === 'cancelled'
}

/**
 * The local day a task was closed (done or cancelled), or null while it is
 * open. `completed_at` is stamped by the database for every writer (migration
 * 129), never `updated_at`: any write moves that one (a Google sync, a
 * reorder), which is how an old finished task used to come back as
 * "finished today".
 */
export function closedDay(task: Pick<Task, 'status' | 'completed_at'>): string | null {
  return isClosedTask(task) ? localDayOf(task.completed_at) : null
}

/** Closed on this local calendar day (yyyy-MM-dd) — what "done today" means everywhere. */
export function closedOn(task: Pick<Task, 'status' | 'completed_at'>, day: string): boolean {
  return closedDay(task) === day
}

/** An open task is overdue once its due_date has passed (`today` given, for pure callers). */
export function isOverdueOn(task: Pick<Task, 'status' | 'due_date'>, today: string): boolean {
  return !!task.due_date && isOpenTask(task) && task.due_date < today
}

/** isOverdueOn against the clock — safe to pass to `.filter` (one argument). */
export function isOverdue(task: Pick<Task, 'status' | 'due_date'>): boolean {
  return isOverdueOn(task, todayStr())
}

type DayFields = Pick<Task, 'status' | 'completed_at' | 'due_date' | 'section'>

/**
 * Is this task part of `day`'s list (Daily's day pane, Home's tasks card and
 * brief, the week strip's count)?
 * - due that day;
 * - closed that day (done or cancelled — so what you finished shows where you
 *   finished it, whatever its section or due date);
 * - on today only, every open task that is overdue, whatever its section,
 *   and an undated task parked in the Today section (it IS today's work).
 */
export function onDay(task: DayFields, day: string, today: string): boolean {
  if (task.due_date === day) return true
  if (closedDay(task) === day) return true
  if (day === today && isOpenTask(task)) {
    if (!task.due_date) return task.section === 'today'
    return task.due_date < today
  }
  return false
}

export interface TaskCounts {
  /** Open, in progress and waiting. */
  open:       number
  todo:       number
  inProgress: number
  waiting:    number
  overdue:    number
  /** Closed as done on the day. */
  done:       number
  /** Closed as cancelled on the day (never part of a total). */
  cancelled:  number
}

/** Counts over any list: open ones by status, closed ones only when closed on `day`. */
export function countTasks(tasks: readonly DayFields[], day: string, today: string): TaskCounts {
  const c: TaskCounts = { open: 0, todo: 0, inProgress: 0, waiting: 0, overdue: 0, done: 0, cancelled: 0 }
  for (const t of tasks) {
    if (isOpenTask(t)) {
      c.open++
      if (t.status === 'open') c.todo++
      else if (t.status === 'in_progress') c.inProgress++
      else c.waiting++
      if (isOverdueOn(t, today)) c.overdue++
    } else if (closedDay(t) === day) {
      if (t.status === 'done') c.done++
      else c.cancelled++
    }
  }
  return c
}

export interface DayTasks<T extends DayFields = Task> {
  /** Still to do, overdue first (otherwise in the order given). */
  open:      T[]
  done:      T[]
  cancelled: T[]
  counts:    TaskCounts
}

/** One day's list, split the one way every surface shows it. */
export function dayTasks<T extends DayFields>(tasks: readonly T[], day: string, today: string): DayTasks<T> {
  const mine = tasks.filter(t => onDay(t, day, today))
  const open = mine.filter(isOpenTask)
    .map((t, i) => ({ t, i, late: isOverdueOn(t, today) ? 0 : 1 }))
    .sort((a, b) => a.late - b.late || a.i - b.i)
    .map(x => x.t)
  return {
    open,
    done: mine.filter(t => t.status === 'done' && closedDay(t) === day),
    cancelled: mine.filter(t => t.status === 'cancelled' && closedDay(t) === day),
    counts: countTasks(mine, day, today),
  }
}

export interface TaskGroups<T> {
  overdue:  T[]
  /** A live window: started, deadline still ahead (migration 069). */
  openNow:  T[]
  today:    T[]
  upcoming: T[]
  noDate:   T[]
  done:     T[]
}

/**
 * Daily's Tasks tab: every open task in one group, and what was done today.
 * Today is the day pane's own list (onDay) — an undated task in the Today
 * section is today's, not "No date". The last day of a window is Today (on
 * its due date the deadline is what matters), so Open now only ever takes
 * rows from Upcoming and nothing shows twice.
 */
export function taskGroups<T extends DayFields & Pick<Task, 'start_date'>>(tasks: readonly T[], today: string): TaskGroups<T> {
  const open = tasks.filter(isOpenTask)
  const openNow = (t: T) => !!t.start_date && !!t.due_date && t.start_date <= today && t.due_date > today
  return {
    overdue:  open.filter(t => isOverdueOn(t, today)),
    openNow:  open.filter(openNow),
    today:    open.filter(t => onDay(t, today, today) && !isOverdueOn(t, today)),
    upcoming: open.filter(t => !!t.due_date && t.due_date > today && !openNow(t)),
    noDate:   open.filter(t => !t.due_date && !onDay(t, today, today)),
    done:     tasks.filter(t => t.status === 'done' && closedOn(t, today)),
  }
}

/**
 * The section a task added on `day` goes to: today, tomorrow, this week
 * (2–7 days ahead) or the backlog. Only Today's undated rows belong to a day
 * (onDay); the other sections are just where a new task is filed.
 */
export function sectionForDay(day: string, today: string): TaskSection {
  const diff = Math.round((Date.parse(`${day}T12:00:00`) - Date.parse(`${today}T12:00:00`)) / 86_400_000)
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff > 1 && diff <= 7) return 'this_week'
  return 'backlog'
}

/** Open tasks on `day` — the number the week strips put under a day. */
export function openOnDay(tasks: readonly DayFields[], day: string, today: string): number {
  return tasks.filter(t => isOpenTask(t) && onDay(t, day, today)).length
}

/**
 * A week's numbers (Daily's week card), counted the day lists' way: open =
 * every open task on one of its days (today's list brings the overdue and
 * undated Today ones), plus — in the current week — the undated This-week
 * ones; done = closed during the week. `todayTasks` is today's day list (only
 * read when today is in the week); `weekTasks` the week read.
 */
export function weekCounts(input: {
  weekTasks:  readonly (DayFields & Pick<Task, 'id'>)[]
  todayTasks: readonly (DayFields & Pick<Task, 'id'>)[]
  from: string
  to:   string
  today: string
}): { open: number; done: number; percent: number } {
  const { weekTasks, todayTasks, from, to, today } = input
  const open = new Set<string>()
  const done = new Set<string>()
  const current = today >= from && today <= to
  for (const t of weekTasks) {
    if (isOpenTask(t)) {
      if (t.due_date ? t.due_date >= from && t.due_date <= to : current) open.add(t.id)
    } else if (t.status === 'done') {
      const c = closedDay(t)
      if (c && c >= from && c <= to) done.add(t.id)
    }
  }
  if (current) {
    for (const t of todayTasks) {
      if (isOpenTask(t) && onDay(t, today, today)) open.add(t.id)
      else if (t.status === 'done' && closedDay(t) === today) done.add(t.id)
    }
  }
  const total = open.size + done.size
  return { open: open.size, done: done.size, percent: total ? Math.round((done.size / total) * 100) : 0 }
}

/** Focus (Work's strip) is for work still to do; a closed task leaves it. */
export function isFocusedOpen(task: Pick<Task, 'status' | 'is_focused'>): boolean {
  return task.is_focused && isOpenTask(task)
}

// Smart due label: "3d overdue" / "Today" / "Tomorrow" / "12.08.2026"
export function dueLabel(task: Task): { text: string; urgent: boolean } | null {
  if (!task.due_date) return null
  const today = todayStr()
  if (task.due_date < today) {
    const days = Math.round((new Date(today).getTime() - new Date(task.due_date).getTime()) / 86_400_000)
    return { text: days === 1 ? '1d overdue' : `${days}d overdue`, urgent: true }
  }
  if (task.due_date === today) return { text: 'Today', urgent: true }
  if (task.due_date === tomorrowStr()) return { text: 'Tomorrow', urgent: false }
  return {
    text: formatDate(task.due_date),
    urgent: false,
  }
}

/** A planned training session: linked to a Hevy routine (migration 141) or planned from one. */
export function isTrainingTask(task: Pick<Task, 'source_type' | 'hevy_routine_id'>): boolean {
  return !!task.hevy_routine_id || task.source_type === 'training_session'
}
