import type { Tone } from '../../shared/ui'
import { stageTones, type Stage } from '../../shared/theme/stage'
import type { TaskDomain, TaskPriority, TaskStatus } from './types'

// The one enum → tone map for tasks (THEME.md §2.4). Every task surface
// imports these instead of picking colours of its own.

export const PRIORITY_TONE: Record<TaskPriority, Tone> = {
  low:    'neutral',
  medium: 'warn',
  high:   'danger',
}

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low:    'Low',
  medium: 'Medium',
  high:   'High',
}

export const STATUS_STAGE: Record<TaskStatus, Stage> = {
  open:        'idle',
  in_progress: 'active',
  waiting:     'paused',
  done:        'done',
  cancelled:   'dropped',
}

export const STATUS_TONE: Record<TaskStatus, Tone> = stageTones(STATUS_STAGE)

export const STATUS_LABEL: Record<TaskStatus, string> = {
  open:        'Open',
  in_progress: 'In progress',
  waiting:     'Waiting',
  done:        'Done',
  cancelled:   'Cancelled',
}

// Domain is a category, not a status — neutral/info/highlight keep the three
// apart without borrowing the accent (reserved for "actionable / selected").
export const DOMAIN_TONE: Record<TaskDomain, Tone> = {
  personal: 'neutral',
  work:     'info',
  media:    'highlight',
}

/** Due chip tone: overdue → danger, today/tomorrow → warn, else neutral. */
export function dueTone(dueDate: string, isDone: boolean, today: string, tomorrow: string): Tone {
  if (isDone) return 'neutral'
  if (dueDate < today) return 'danger'
  if (dueDate === today || dueDate === tomorrow) return 'warn'
  return 'neutral'
}
