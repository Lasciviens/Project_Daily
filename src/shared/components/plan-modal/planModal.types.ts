// ─────────────────────────────────────────────────────────────────────────────
//  UnifiedPlanModal (the Add sheet) — TYPES & CONFIG CONTRACT
//  See UnifiedPlanModal.tsx for the rulebook + changelog. This file holds the
//  public contract: anything a caller needs to drive the sheet lives here.
// ─────────────────────────────────────────────────────────────────────────────

import type { TimeBlock, ScheduleBlock, TimeBlockCategory } from '../../../features/daily/types'
import type { Task, LiveTaskSection, TaskPriority, TaskDomain, TaskSourceType } from '../../../features/todo/types'

// ── Mode — which alias opened a NEW item ──────────────────────────────────────
// One item since migration 155: a task, its slot and its repeat are parts of
// one form, so mode only decides what a new item starts with —
// 'task'      — no time (Daily's / Work's Add, a wish, a purchase)
// 'schedule'  — a time and a length (planning a session, an episode)
// 'recurring' — a weekly repeat
// An edit ignores it: the saved rows say what the item has.
export type PlanMode = 'task' | 'schedule' | 'recurring'

// ── Field keys a caller may hide ─────────────────────────────────────────────

/** 'recurrence': no "+ Repeat"; 'gcal': no Google chip. */
export type ScheduleField = 'recurrence' | 'gcal' | 'category'

/** Each hides its "+" chip and row. 'startDate' is the "do it between" window
 *  under "+ Deadline"; 'dueDate' / 'dueTime' hide the deadline itself. */
export type TaskField = 'notes' | 'priority' | 'domain' | 'startDate' | 'dueDate' | 'dueTime' | 'googleList'

/** The planner's Repeat choice. 'custom' is "every N days / weeks / months"
 *  or "picked dates" (CustomRepeatKind). Stored as schedule_blocks' repeat
 *  columns by planModal.config's repeatRowFromForm (migration 146). */
export type RecurrenceMode = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'custom'
export type CustomRepeatKind = 'every' | 'dates'

// ── Config — shapes the sheet from the caller's file ─────────────────────────
//  Example: config={{ heading: 'Plan to watch' }}. A hidden field's row and
//  its "+" chip don't show (a training session hides the deadline: its day is
//  the session's, 142).

export interface PlanModalConfig {
  /** Header text. Default: "Add" for a new item, "Edit" for a saved one. */
  heading?: string
  hideScheduleFields?: ScheduleField[]
  hideTaskFields?: TaskField[]
}

// ── Defaults — prefilled values ───────────────────────────────────────────────

export interface PlanDefaults {
  title?: string

  // When: the item's day and time (dueDate counts as the day when date is missing)
  date?: string             // yyyy-MM-dd
  startTime?: string        // HH:MM (24h)
  duration?: number         // minutes
  category?: TimeBlockCategory
  color?: string
  recurrence?: RecurrenceMode
  daysOfWeek?: number[]     // 0=Sun … 6=Sat (only used when recurrence='weekly')
  /** Before one item (155) a slot could come without a task; now every item
   *  is one — kept so older callers still type-check, it changes nothing. */
  alsoCreateTask?: boolean

  notes?: string
  /** Only 'inbox' still matters: a new item with no date of its own starts undated. The section follows the date. */
  section?: LiveTaskSection
  priority?: TaskPriority
  domain?: TaskDomain
  /** Window opening edge (tasks.start_date). dueDate stays the deadline. */
  startDate?: string        // yyyy-MM-dd
  dueDate?: string          // yyyy-MM-dd
  dueTime?: string          // HH:MM
  /** A 'task' item that starts with a time and a length (startTime / duration). */
  scheduled?: boolean

  /** Start on Google Calendar whatever the default says. */
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

  /** A new item: what it starts with (see PlanMode). Ignored for an edit. */
  mode?: PlanMode

  config?: PlanModalConfig
  defaults?: PlanDefaults
  source?: PlanSource

  /** Editing: the item's task, its slot (a task's one-off time_block, or a
   *  block of its own) and its repeat rule — whichever it has, loaded by id
   *  (PlanEntityModals). */
  task?: Task
  timeBlock?: TimeBlock | null
  scheduleBlock?: ScheduleBlock
  /** A repeating item opened on one of its days: offers This day | All days. */
  occurrenceDate?: string | null
  /** Which of the two it starts on (default All days); 'day' when the sheet
   *  opens a repeat's day from its task (156). */
  startScope?: 'day' | 'all'

  /** Fires after a successful save, before close — for caller-side follow-up. */
  onSaved?: (result: PlanResult) => void

  /** The rows are still loading by id: the shell shows a skeleton and Save stays disabled. */
  loading?: boolean
  /** The rows couldn't be loaded: the shell shows this message (+ retry). */
  loadError?: { message: string; onRetry?: () => void }
  /** Replaces the footer's Delete (a training session's: it asks, deletes the
   *  session and offers Undo — training/useTrainingPlanActions). Resolves true
   *  when it was deleted; the sheet then closes. */
  onDeleteOverride?: () => Promise<boolean>
}
