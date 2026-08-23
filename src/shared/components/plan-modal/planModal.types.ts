// ─────────────────────────────────────────────────────────────────────────────
//  UnifiedPlanModal — TYPES & CONFIG CONTRACT
//  See UnifiedPlanModal.tsx for the rulebook + changelog. This file holds the
//  public contract: anything a caller needs to drive the modal lives here.
// ─────────────────────────────────────────────────────────────────────────────

import type { TimeBlock, ScheduleBlock, TimeBlockCategory } from '../../../features/daily/types'
import type { Task, TaskSection, TaskPriority, TaskDomain, TaskSourceType } from '../../../features/todo/types'

// ── Mode — replaces the old Task/Schedule TAB switcher entirely ─────────────
// A caller decides which entity is being edited; the user never picks a tab.
// 'task'      — Task create/edit, with an optional "Add to schedule" section
//               for at most one linked one-off time_block.
// 'schedule'  — a plain one-off time_block create/edit (with an optional
//               "Also add to Tasks" checkbox on CREATE only).
// 'recurring' — a schedule_blocks (recurring template) create/edit.
export type PlanMode = 'task' | 'schedule' | 'recurring'

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
  /** The "do it between A and B" window control (writes startDate + dueDate). */
  | 'startDate'
  | 'dueDate'
  | 'dueTime'
  /** Free-text Google Task list picker/creator (writes google_tasklist_id). */
  | 'googleList'
  /** The "Add to schedule" toggle + its date/time/duration/category/GCal
   *  sub-fields — hide this whole section for a caller that never wants a
   *  Task schedulable (there currently is none, but the seam exists). */
  | 'scheduled'
  | 'gcal'

export type RecurrenceMode = 'none' | 'daily' | 'weekdays' | 'weekly'

// ── Config — drives layout/visibility WITHOUT touching the modal ──────────────
//  A caller hides or locks fields purely from its own file via this object.
//  Example: config={{ hideScheduleFields: ['category'] }}

export interface PlanModalConfig {
  /** Header text override. Default: derived from mode ('Task' / 'Schedule' / 'Repeat'). */
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
  /** Window opening edge (tasks.start_date). dueDate stays the deadline. */
  startDate?: string        // yyyy-MM-dd
  dueDate?: string          // yyyy-MM-dd
  dueTime?: string          // HH:MM
  /** Pre-open the Task editor's "Add to schedule" section already toggled on. */
  scheduled?: boolean

  // Shared
  gcal?: boolean
}

// ── Source linking — lets created rows point back to the originating entity ───

export interface PlanSource {
  /** time_blocks.source_type — the REAL originating entity, never 'task'
   *  (migration 077 removed that value; linkage to a Task is task_id only). */
  sourceType?: string
  /** Shared id used for both the time block and the task source link. */
  sourceId?: string
  /** tasks.source_type (enum) — defaults to 'manual' when omitted. */
  taskSourceType?: TaskSourceType
  /**
   * Only pass this when sourceType is 'tv_episode' AND exactly one specific
   * episode was planned (never for a multi-episode batch plan) — stamps
   * season/episode number onto the created time_block so a DB trigger can
   * precisely match "this episode was marked watched" back to it.
   */
  episodeInfo?: { seasonNumber: number; episodeNumber: number }
}

// ── Result handed to onSaved (post-save hook — caller-side side effects) ──────

export interface PlanResult {
  mode: PlanMode
  taskId?: string
  timeBlockCreated?: boolean
  recurringCreated?: boolean
}

// ── Component props ───────────────────────────────────────────────────────────

export interface UnifiedPlanModalProps {
  open: boolean
  onClose: () => void

  /** Required for CREATE (no task/timeBlock/scheduleBlock given) — decides
   *  which entity gets created. Ignored/inferred for EDIT: passing `task`
   *  always means mode 'task', `timeBlock` means 'schedule', `scheduleBlock`
   *  means 'recurring' — a caller editing an existing row never needs to
   *  also pass `mode` (though it's harmless if it does, as long as it
   *  agrees). */
  mode?: PlanMode

  config?: PlanModalConfig
  defaults?: PlanDefaults
  source?: PlanSource

  /** Edit mode for a Task. When set, the editor opens populated + shows Delete. */
  task?: Task

  /** Edit mode for a standalone or task-linked one-off time_block. Only pass
   *  this for a block with NO linked task (task_id null) — a task-linked
   *  block should be edited via `task` instead (loading the block itself
   *  happens inside the modal, keyed off task_id, so its Schedule section
   *  is correct without the caller re-fetching it). */
  timeBlock?: TimeBlock

  /** Edit mode for a recurring schedule_blocks row. */
  scheduleBlock?: ScheduleBlock

  /** Extra caller-owned UI injected at the bottom of the Schedule section (Yol 1). */
  scheduleExtra?: React.ReactNode
  /** Extra caller-owned UI injected at the bottom of the Task section (Yol 1). */
  taskExtra?: React.ReactNode

  /** Fires after a successful save, before close — for caller-side follow-up. */
  onSaved?: (result: PlanResult) => void
}
