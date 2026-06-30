// ─────────────────────────────────────────────────────────────────────────────
//  UnifiedPlanModal — INTERNAL FORM STATE
//  The single source of truth for both tabs while the modal is open. Title is
//  shared (Plan title === Task title). Seeded from PlanDefaults / `task`.
// ─────────────────────────────────────────────────────────────────────────────

import type { TimeBlockCategory } from '../../../features/daily/types'
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
  dueDate: string
  dueTime: string

  // Shared
  gcal: boolean
}

/** Build the initial form from defaults, overlaying an editing task when present. */
export function buildInitialForm(defaults?: PlanDefaults, task?: Task): PlanForm {
  const today    = todayStr()
  const duration = defaults?.duration ?? 60
  // Non-preset durations (e.g. a 45-min episode) go into the custom field so the
  // value is visible and used — otherwise no chip highlights and it looks empty.
  const isPreset = (DURATION_PRESETS as readonly number[]).includes(duration)
  return {
    title:          task?.title ?? defaults?.title ?? '',

    date:           defaults?.date ?? today,
    startTime:      defaults?.startTime ?? nextPlanTime(),
    duration,
    customMin:      isPreset ? '' : String(duration),
    category:       defaults?.category ?? 'other',
    recurrence:     defaults?.recurrence ?? 'none',
    weeklyDays:     defaults?.daysOfWeek ?? WEEKDAYS,
    alsoCreateTask: defaults?.alsoCreateTask ?? false,

    notes:          task?.description ?? defaults?.notes ?? '',
    section:        task?.section ?? defaults?.section ?? 'today',
    priority:       task?.priority ?? defaults?.priority ?? 'medium',
    domain:         task?.domain ?? defaults?.domain ?? 'personal',
    dueDate:        task?.due_date ?? defaults?.dueDate ?? '',
    dueTime:        task?.due_time ? task.due_time.slice(0, 5) : (defaults?.dueTime ?? ''),

    gcal:           defaults?.gcal ?? false,
  }
}
