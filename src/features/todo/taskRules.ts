// Shared task display rules — used anywhere a "done" task list needs the
// 24h visibility rule applied consistently (Daily's DayView, Home's Today
// widgets, etc).

import { todayStr, tomorrowStr } from '../../shared/utils/dateUtils'
import type { Task } from './types'
import { formatDate } from '../../shared/utils/dateFormat'

/**
 * When a task was closed (done or cancelled). `completed_at` is stamped by
 * the database for every writer (migration 129); `updated_at` is only the
 * fallback for a row from before it — it moves on ANY write (a Google sync,
 * a reorder), which is how an old finished task used to come back as
 * "finished today".
 */
export function closedAt(task: Pick<Task, 'completed_at' | 'updated_at'>): string {
  return task.completed_at ?? task.updated_at
}

/** A "Done" task only stays visible for 24h after completion. */
export function completedWithinLast24h(task: Pick<Task, 'completed_at' | 'updated_at'>): boolean {
  return Date.now() - new Date(closedAt(task)).getTime() < 24 * 60 * 60 * 1000
}

/** Closed on this local calendar day (yyyy-MM-dd) — what "finished today" means. */
export function closedOn(task: Pick<Task, 'completed_at' | 'updated_at'>, dateStr: string): boolean {
  const d = new Date(closedAt(task))
  if (Number.isNaN(d.getTime())) return false
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return local === dateStr
}

/** An open task is overdue once its due_date has passed. */
export function isOverdue(task: Task): boolean {
  if (!task.due_date) return false
  if (task.status === 'done' || task.status === 'cancelled') return false
  return task.due_date < todayStr()
}

// Smart due label: "3d overdue" / "Today" / "Tomorrow" / "12 Aug"
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
