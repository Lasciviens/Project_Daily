import type { Task, TaskStatus } from '../../todo/types'
import { todayStr } from '../../../shared/utils/dateUtils'
import { PRIORITY_META } from '../../../shared/utils/priorityColors'
import { isOverdue, dueLabel } from '../../todo/taskRules'

export { todayStr, PRIORITY_META, isOverdue, dueLabel }

// Shared status/priority metadata + task helpers for the Work views
// (board, list, focus strip, header stats all read from here).

export type BoardStatus = 'open' | 'in_progress' | 'waiting' | 'done'

export interface StatusMeta {
  id:    BoardStatus
  label: string
  color: string   // hex — used via style attr for dots/accents
}

export const BOARD_COLUMNS: StatusMeta[] = [
  { id: 'open',        label: 'To-do',       color: '#D97706' },
  { id: 'in_progress', label: 'In Progress', color: '#16A34A' },
  { id: 'waiting',     label: 'Waiting',     color: '#0284C7' },
  { id: 'done',        label: 'Done today',  color: '#6B7280' },
]

export const OVERDUE_COLOR = '#DC2626'

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }

export function isCompletedToday(task: Task): boolean {
  return task.updated_at?.slice(0, 10) === todayStr()
}

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 1
    const pb = PRIORITY_ORDER[b.priority] ?? 1
    if (pa !== pb) return pa - pb
    return (a.sort_order ?? 0) - (b.sort_order ?? 0)
  })
}

export const STATUS_CYCLE: TaskStatus[] = ['open', 'in_progress', 'waiting', 'done']

// Matches a task against the header search box (title + description).
export function matchesSearch(task: Task, q: string): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  return task.title.toLowerCase().includes(needle) ||
    (task.description ?? '').toLowerCase().includes(needle)
}
