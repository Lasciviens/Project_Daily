// Shared task display rules — used anywhere a "done" task list needs the
// 24h visibility rule applied consistently (Daily's DayView, Home's Today
// widgets, etc).

import { todayStr, tomorrowStr } from '../../shared/utils/dateUtils'
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
    text: new Date(task.due_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    urgent: false,
  }
}
