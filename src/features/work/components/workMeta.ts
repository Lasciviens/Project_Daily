import type { Task, TaskPriority, TaskStatus } from '../../todo/types'
import type { Tone } from '../../../shared/ui'
import { todayStr } from '../../../shared/utils/dateUtils'
import { isOverdue, dueLabel } from '../../todo/taskRules'
import { PRIORITY_TONE, PRIORITY_LABEL, STATUS_TONE } from '../../todo/taskTones'

export { todayStr, isOverdue, dueLabel, PRIORITY_TONE, PRIORITY_LABEL }

// Shared status/priority metadata + task helpers for the Work views
// (board, list, focus strip, header stats all read from here). Colours come
// from the task tone maps — Work never picks a colour of its own.

export type BoardStatus = 'open' | 'in_progress' | 'waiting' | 'done'

export interface StatusMeta {
  id:    BoardStatus
  label: string
  tone:  Tone
}

export const BOARD_COLUMNS: StatusMeta[] = [
  { id: 'open',        label: 'To-do',       tone: STATUS_TONE.open },
  { id: 'in_progress', label: 'In progress', tone: STATUS_TONE.in_progress },
  { id: 'waiting',     label: 'Waiting',     tone: STATUS_TONE.waiting },
  { id: 'done',        label: 'Done today',  tone: STATUS_TONE.done },
]

export const OVERDUE_TONE: Tone = 'danger'

/** Glyph that pairs with the priority tone, so colour is never the only signal. */
export const PRIORITY_ICON: Record<TaskPriority, string> = { high: '▲', medium: '●', low: '▼' }

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

/** Status shown for a task in the list view: overdue outranks its column. */
export function taskStatusMeta(task: Task): { label: string; tone: Tone } {
  if (isOverdue(task)) return { label: 'Overdue', tone: OVERDUE_TONE }
  const col = BOARD_COLUMNS.find(c => c.id === task.status)
  return col ? { label: col.label, tone: col.tone } : { label: task.status, tone: 'neutral' }
}

// Matches a task against the header search box (title + description).
export function matchesSearch(task: Task, q: string): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  return task.title.toLowerCase().includes(needle) ||
    (task.description ?? '').toLowerCase().includes(needle)
}
