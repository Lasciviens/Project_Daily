// Shared task display rules — used anywhere a "done" task list needs the
// 24h visibility rule applied consistently (Daily's DayView, Home's Today
// widgets, etc).

import { todayStr } from '../../shared/utils/dateUtils'
import type { Task } from './types'

/** A "Done" task only stays visible for 24h after completion. */
export function completedWithinLast24h(updatedAt: string): boolean {
  return Date.now() - new Date(updatedAt).getTime() < 24 * 60 * 60 * 1000
}

/** An open task is overdue once its due_date has passed. */
export function isOverdue(task: Task): boolean {
  if (!task.due_date) return false
  if (task.status === 'done' || task.status === 'cancelled') return false
  return task.due_date < todayStr()
}
