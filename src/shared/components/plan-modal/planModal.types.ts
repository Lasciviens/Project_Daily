// ─────────────────────────────────────────────────────────────────────────────
//  UnifiedPlanModal — TYPES & CONFIG CONTRACT
//  See UnifiedPlanModal.tsx for the rulebook + changelog. This file holds the
//  public contract: anything a caller needs to drive the modal lives here.
// ─────────────────────────────────────────────────────────────────────────────

import type { TimeBlock, TimeBlockCategory } from '../../../features/daily/types'
import type { Task, TaskSection, TaskPriority, TaskDomain, TaskSourceType } from '../../../features/todo/types'

// ── Tabs ────────────────────────────────────────────────────────────────────

export type PlanTab = 'schedule' | 'task'

// ── Field keys (every togglable field has a stable key) ───────────────────────

export type ScheduleField =
  | 'title'
  | 'date'
  | 'time'
  | 'duration'
  | 'category'
  | 'recurrence'
  | 'alsoCreateTask'
  | 'gcal'

export type TaskField =
  | 'title'
  | 'notes'
  | 'section'
  | 'priority'
  | 'domain'
  | 'dueDate'
  | 'dueTime'
  | 'gcal'

export type RecurrenceMode = 'none' | 'daily' | 'weekdays' | 'weekly'

// ── Config — drives layout/visibility WITHOUT touching the modal ──────────────
//  A caller hides or locks fields purely from its own file via this object.
//  Example: config={{ tabs: ['schedule'], hideScheduleFields: ['category'] }}

export interface PlanModalConfig {
  /** Tabs shown, in order. Default: ['schedule', 'task']. */
  tabs?: PlanTab[]
  /** Tab selected on open. Default: first entry of `tabs`. */
  defaultTab?: PlanTab
  /** Header text override. Default: 'Plan'. */
  heading?: string
  /** Fields hidden entirely (Schedule tab). */
  hideScheduleFields?: ScheduleField[]
  /** Fields hidden entirely (Task tab). */
  hideTaskFields?: TaskField[]
  /** Fields visible but read-only (Schedule tab). */
  lockScheduleFields?: ScheduleField[]
  /** Fields visible but read-only (Task tab). */
  lockTaskFields?: TaskField[]
}

// ── Defaults — prefilled values ───────────────────────────────────────────────

export interface PlanDefaults {
  /** Shared across both tabs — Plan title === Task title. */
  title?: string

  // Schedule tab
  date?: string             // yyyy-MM-dd
  startTime?: string        // HH:MM (24h)
  duration?: number         // minutes
  category?: TimeBlockCategory
  color?: string
  recurrence?: RecurrenceMode
  daysOfWeek?: number[]     // 0=Sun … 6=Sat (only used when recurrence='weekly')
  alsoCreateTask?: boolean

  // Task tab
  notes?: string
  section?: TaskSection
  priority?: TaskPriority
  domain?: TaskDomain
  dueDate?: string          // yyyy-MM-dd
  dueTime?: string          // HH:MM

  // Shared
  gcal?: boolean
}

// ── Source linking — lets created rows point back to the originating entity ───

export interface PlanSource {
  /** time_blocks.source_type (free string, e.g. 'media' | 'routine' | 'game'). */
  sourceType?: string
  /** Shared id used for both the time block and the task source link. */
  sourceId?: string
  /** tasks.source_type (enum) — defaults to 'manual' when omitted. */
  taskSourceType?: TaskSourceType
}

// ── Result handed to onSaved (post-save hook — caller-side side effects) ──────

export interface PlanResult {
  tab: PlanTab
  taskId?: string
  timeBlockCreated?: boolean
  recurringCreated?: boolean
}

// ── Component props ───────────────────────────────────────────────────────────

export interface UnifiedPlanModalProps {
  open: boolean
  onClose: () => void

  config?: PlanModalConfig
  defaults?: PlanDefaults
  source?: PlanSource

  /** Edit mode for the Task tab. When set, Task tab opens populated + shows Delete. */
  task?: Task

  /**
   * Edit mode for the Schedule tab, for a plain time_block with no linked task
   * (e.g. a planned training session). When set, saveSchedule updates this row
   * in place instead of creating a new one, and Delete removes it. Ignored if
   * `task` is also set (task-edit takes precedence for the Task tab's own block sync).
   */
  timeBlock?: TimeBlock

  /** Extra caller-owned UI injected at the bottom of the Schedule tab (Yol 1). */
  scheduleExtra?: React.ReactNode
  /** Extra caller-owned UI injected at the bottom of the Task tab (Yol 1). */
  taskExtra?: React.ReactNode

  /** Fires after a successful save, before close — for caller-side follow-up. */
  onSaved?: (result: PlanResult) => void
}
