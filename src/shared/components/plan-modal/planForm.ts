// ─────────────────────────────────────────────────────────────────────────────
//  UnifiedPlanModal — INTERNAL FORM STATE
//  The single source of truth for both tabs while the modal is open. Title is
//  shared (Plan title === Task title). Seeded from PlanDefaults / `task`.
// ─────────────────────────────────────────────────────────────────────────────

import type { TimeBlock, TimeBlockCategory } from '../../../features/daily/types'
import type { Task, TaskSection, TaskPriority, TaskDomain } from '../../../features/todo/types'
import { todayStr, nextPlanTime, DURATION_PRESETS, WEEKDAYS } from './planModal.config'
import type { PlanDefaults, RecurrenceMode } from './planModal.types'

export interface PlanForm {
  // Shared
  title: string

  // Schedule tab
  date: string
  startTime: string
  duration: number
  customMin: string
  category: TimeBlockCategory
  recurrence: RecurrenceMode
  weeklyDays: number[]
  alsoCreateTask: boolean

  // Task tab
  notes: string
  section: TaskSection
  priority: TaskPriority
  domain: TaskDomain
  /** Opening edge of a "do it between A and B" window; dueDate stays the deadline. */
  startDate: string
  dueDate: string
  dueTime: string

  // Shared
  gcal: boolean
}

/** Build the initial form from defaults, overlaying an editing task or time block when present. */
export function buildInitialForm(defaults?: PlanDefaults, task?: Task, timeBlock?: TimeBlock): PlanForm {
  const today    = todayStr()
  const duration = timeBlock?.duration_minutes ?? defaults?.duration ?? 60
  // Non-preset durations (e.g. a 45-min episode) go into the custom field so the
  // value is visible and used — otherwise no chip highlights and it looks empty.
  const isPreset = (DURATION_PRESETS as readonly number[]).includes(duration)
  return {
    title:          task?.title ?? timeBlock?.title ?? defaults?.title ?? '',

    date:           timeBlock?.date ?? defaults?.date ?? today,
    startTime:      timeBlock?.start_time?.slice(0, 5) ?? defaults?.startTime ?? nextPlanTime(),
    duration,
    customMin:      isPreset ? '' : String(duration),
    category:       timeBlock?.category ?? defaults?.category ?? 'other',
    recurrence:     defaults?.recurrence ?? 'none',
    weeklyDays:     defaults?.daysOfWeek ?? WEEKDAYS,
    // Editing an existing plan whose block already has a linked task (e.g.
    // Training's "Edit Session") must show that truthfully — previously this
    // only ever looked at `defaults`, which the edit call site never passes,
    // so the checkbox always rendered unchecked even when a To-Do already
    // existed for this plan.
    alsoCreateTask: timeBlock?.source_type === 'task' || (defaults?.alsoCreateTask ?? false),

    notes:          task?.description ?? defaults?.notes ?? '',
    section:        task?.section ?? defaults?.section ?? 'today',
    priority:       task?.priority ?? defaults?.priority ?? 'medium',
    domain:         task?.domain ?? defaults?.domain ?? 'personal',
    startDate:      task?.start_date ?? defaults?.startDate ?? '',
    dueDate:        task?.due_date ?? defaults?.dueDate ?? '',
    dueTime:        task?.due_time ? task.due_time.slice(0, 5) : (defaults?.dueTime ?? ''),

    gcal:           defaults?.gcal ?? false,
  }
}
