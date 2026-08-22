// ─────────────────────────────────────────────────────────────────────────────
//  UnifiedPlanModal — INTERNAL FORM STATE
//  The single source of truth while the modal is open, shared across all
//  three modes (title is the one field every mode has). Seeded from
//  PlanDefaults / an entity prop (task / timeBlock / scheduleBlock).
// ─────────────────────────────────────────────────────────────────────────────

import type { TimeBlock, TimeBlockCategory, ScheduleBlock } from '../../../features/daily/types'
import type { Task, TaskSection, TaskPriority, TaskDomain } from '../../../features/todo/types'
import { DOMAIN_LABEL } from '../../../features/todo/domainColors'
import {
  todayStr, nextPlanTime, DURATION_PRESETS, WEEKDAYS,
  inferRecurrenceMode, minutesBetweenWrapping, defaultScheduleCategory,
} from './planModal.config'
import type { PlanDefaults, RecurrenceMode } from './planModal.types'

export interface PlanForm {
  // Shared
  title: string

  // Schedule fields — used by mode 'schedule' AND 'recurring' (recurrence
  // controls which table a CREATE targets), and by mode 'task' when the
  // "Add to schedule" toggle is on.
  date: string
  startTime: string
  duration: number
  customMin: string
  category: TimeBlockCategory
  recurrence: RecurrenceMode
  weeklyDays: number[]
  /** Schedule-mode-only: also create a linked Task on CREATE. Never shown/
   *  used in mode 'recurring' — there is no recurring-Task concept. */
  alsoCreateTask: boolean

  // Task fields
  notes: string
  section: TaskSection
  priority: TaskPriority
  domain: TaskDomain
  /** Opening edge of a "do it between A and B" window; dueDate stays the deadline. */
  startDate: string
  dueDate: string
  dueTime: string
  /** Free-text Google Task list name — resolved (and auto-created on Google
   *  if it doesn't already exist, matched case-insensitively) at save time.
   *  Not a fixed picker over `domain`: the user can type anything. */
  googleListTitle: string
  /** Task-mode-only: is this task ALSO scheduled as a one-off time_block?
   *  Independent of dueDate/dueTime — a deadline is not a time slot. */
  scheduled: boolean

  // Shared
  gcal: boolean
}

/** Build the initial form from defaults, overlaying an editing task /
 *  timeBlock / scheduleBlock when present. A task's linked time_block (if
 *  any) is NOT available synchronously here — UnifiedPlanModal corrects
 *  `scheduled`/date/startTime/duration/category/gcal once it loads, exactly
 *  once, via a ref-guarded effect (never re-clobbering a user's own edit). */
export function buildInitialForm(
  defaults?: PlanDefaults, task?: Task, timeBlock?: TimeBlock, scheduleBlock?: ScheduleBlock,
): PlanForm {
  const today = todayStr()
  const recurringDuration = scheduleBlock
    ? minutesBetweenWrapping(scheduleBlock.start_time.slice(0, 5), scheduleBlock.end_time.slice(0, 5))
    : undefined
  const duration = recurringDuration ?? timeBlock?.duration_minutes ?? defaults?.duration ?? 60
  // Non-preset durations (e.g. a 45-min episode) go into the custom field so the
  // value is visible and used — otherwise no chip highlights and it looks empty.
  const isPreset = (DURATION_PRESETS as readonly number[]).includes(duration)
  const domain = task?.domain ?? defaults?.domain ?? 'personal'

  return {
    title: scheduleBlock?.title ?? task?.title ?? timeBlock?.title ?? defaults?.title ?? '',

    date:       timeBlock?.date ?? defaults?.date ?? today,
    startTime:  scheduleBlock?.start_time?.slice(0, 5) ?? timeBlock?.start_time?.slice(0, 5) ?? defaults?.startTime ?? nextPlanTime(),
    duration,
    customMin:  isPreset ? '' : String(duration),
    category:   scheduleBlock?.category ?? timeBlock?.category ?? defaults?.category
                ?? defaultScheduleCategory(domain, task?.source_type),
    recurrence: scheduleBlock ? inferRecurrenceMode(scheduleBlock.days_of_week) : (defaults?.recurrence ?? 'none'),
    weeklyDays: scheduleBlock?.days_of_week ?? defaults?.daysOfWeek ?? WEEKDAYS,
    // Editing an existing plan whose block already has a linked task (e.g.
    // Training's "Edit Session") must show that truthfully — previously this
    // only ever looked at `defaults`, which the edit call site never passes,
    // so the checkbox always rendered unchecked even when a To-Do already
    // existed for this plan.
    alsoCreateTask: timeBlock?.task_id != null || (defaults?.alsoCreateTask ?? false),

    notes:      task?.description ?? defaults?.notes ?? '',
    section:    task?.section ?? defaults?.section ?? 'today',
    priority:   task?.priority ?? defaults?.priority ?? 'medium',
    domain,
    startDate:  task?.start_date ?? defaults?.startDate ?? '',
    dueDate:    task?.due_date ?? defaults?.dueDate ?? '',
    dueTime:    task?.due_time ? task.due_time.slice(0, 5) : (defaults?.dueTime ?? ''),
    googleListTitle: DOMAIN_LABEL[domain],
    scheduled:  defaults?.scheduled ?? false,

    // A standalone timeBlock's own google_calendar_event_id is available
    // synchronously (unlike mode='task', where the linked block itself is
    // fetched async — see UnifiedPlanModal's hydrateLinkedBlock effect,
    // which corrects this field for that case once it loads). Without this,
    // opening an already-calendar-linked block seeded gcal=false, and
    // Save's "toggle went from checked to unchecked" branch unlinked the
    // real Google Calendar event the user never touched.
    gcal: timeBlock ? !!timeBlock.google_calendar_event_id : (defaults?.gcal ?? false),
  }
}
