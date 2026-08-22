// ─────────────────────────────────────────────────────────────────────────────
//  UnifiedPlanModal — CONFIG RESOLUTION & PURE HELPERS
//  No React here. Everything is a pure function so it can be unit-tested and
//  reused. Visual/behavioural defaults live here, NOT scattered in the modal.
// ─────────────────────────────────────────────────────────────────────────────

import { format, addDays, parseISO, isToday, isTomorrow } from 'date-fns'
import type { TimeBlockCategory } from '../../../features/daily/types'
import type { TaskSection, TaskSourceType } from '../../../features/todo/types'
import type { TimeBlockCalendarStatus } from '../../../features/daily/api/scheduleSyncRules'
import { todayStr, tomorrowStr } from '../../utils/dateUtils'
import type {
  PlanModalConfig, ScheduleField, TaskField, RecurrenceMode,
} from './planModal.types'

export { todayStr, tomorrowStr }

// ── Static presets ────────────────────────────────────────────────────────────

export const DURATION_PRESETS = [30, 60, 90, 120, 180] as const

export const CATEGORY_LABELS: Record<TimeBlockCategory, string> = {
  daily:    'Daily',
  training: 'Training',
  media:    'Media',
  games:    'Games',
  work:     'Work',
  projects: 'Projects',
  other:    'Other',
}

export const RECURRENCE_OPTIONS: { value: RecurrenceMode; label: string }[] = [
  { value: 'none',     label: 'No repeat' },
  { value: 'daily',    label: 'Every day' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly',   label: 'Weekly' },
]

// RecurringTab (editing an EXISTING schedule_blocks row) must never offer
// "No repeat" — a recurring template converting itself to a one-off block
// mid-edit is a real storage-migration UX this refactor deliberately does
// not build (see UnifiedPlanModal's own comment on the reverse case). The
// ScheduleTab CREATE flow keeps the full list — there, 'none' genuinely
// means "make a plain one-off time_block instead".
export const RECURRING_EDIT_OPTIONS = RECURRENCE_OPTIONS.filter(o => o.value !== 'none')

export const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const   // 0=Sun … 6=Sat
export const WEEKDAYS   = [1, 2, 3, 4, 5]
export const EVERY_DAY  = [0, 1, 2, 3, 4, 5, 6]

export const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone


/** "26.06.2026 Fri" — the app-wide compact date format for this modal. */
export function displayDate(iso: string): string {
  try {
    return format(parseISO(iso), 'dd.MM.yyyy EEE')
  } catch {
    return iso
  }
}

export function stepDate(iso: string, dir: 1 | -1): string {
  try {
    return format(addDays(parseISO(iso), dir), 'yyyy-MM-dd')
  } catch {
    return iso
  }
}

/** Shift an HH:MM time by a signed number of minutes, wrapping within a day. */
export function shiftTime(hhmm: string, deltaMin: number): string {
  const [h, m] = hhmm.split(':').map(Number)
  const total  = ((h * 60 + m + deltaMin) % 1440 + 1440) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/**
 * Default plan time: now + 30 min, rounded up to the next half-hour grid point.
 * e.g. 15:56 → 16:30, 15:30 → 16:00, 15:01 → 15:30.
 */
export function nextPlanTime(): string {
  const d = new Date()
  let total = d.getHours() * 60 + d.getMinutes() + 30
  total = (Math.ceil(total / 30) * 30) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Round minutes UP to the next 15-min quarter (min 15). 44→45, 31→45, 90→90. */
export function ceilToQuarter(min: number): number {
  return Math.max(15, Math.ceil(min / 15) * 15)
}

/** End time = start + duration, used when creating recurring schedule blocks. */
export function endTimeFrom(startHHMM: string, durationMin: number): string {
  return shiftTime(startHHMM, durationMin)
}

/** Map an arbitrary date to the right To-Do section. */
export function sectionForDate(iso: string): TaskSection {
  try {
    const d = parseISO(iso)
    if (isToday(d))    return 'today'
    if (isTomorrow(d)) return 'tomorrow'
    return 'this_week'
  } catch {
    return 'today'
  }
}

/** Resolve a recurrence mode + explicit weekly days into the days_of_week
 *  array. Deliberately does NOT fall back to Mon-Fri when weeklyDays is
 *  empty — that silent substitution used to let "uncheck every day, hit
 *  Save" quietly become "every weekday" instead of being rejected.
 *  hasValidRecurrenceSelection is the gate that must run BEFORE this. */
export function daysForRecurrence(mode: RecurrenceMode, weeklyDays: number[]): number[] {
  if (mode === 'daily')    return EVERY_DAY
  if (mode === 'weekdays') return WEEKDAYS
  if (mode === 'weekly')   return weeklyDays
  return []
}

/** Whether a recurrence selection is complete enough to save. Only 'weekly'
 *  needs at least one day checked — 'daily'/'weekdays' are fully determined
 *  by their mode alone, and 'none' (one-off CREATE only — never valid while
 *  editing an existing recurring template) has no days concept at all. */
export function hasValidRecurrenceSelection(mode: RecurrenceMode, weeklyDays: number[]): boolean {
  return mode !== 'weekly' || weeklyDays.length > 0
}

/** The inverse of daysForRecurrence — needed to EDIT an existing recurring
 *  schedule_blocks row, which stores only days_of_week, never the mode the
 *  user originally picked. [0..6] -> daily, [1..5] -> weekdays, any other
 *  non-empty set -> weekly (with those exact days pre-checked). */
export function inferRecurrenceMode(daysOfWeek: number[]): RecurrenceMode {
  const sorted = [...new Set(daysOfWeek)].sort((a, b) => a - b)
  if (sorted.length === 7 && EVERY_DAY.every(d => sorted.includes(d))) return 'daily'
  if (sorted.length === 5 && WEEKDAYS.every(d => sorted.includes(d)))  return 'weekdays'
  return 'weekly'
}

/** Minutes between two HH:MM times, wrapping past midnight (23:30-00:30 =
 *  60 minutes, never negative) — schedule_blocks stores start_time/end_time,
 *  not a duration, so this is how the editor derives one to show/edit. */
export function minutesBetweenWrapping(startHHMM: string, endHHMM: string): number {
  const [sh, sm] = startHHMM.split(':').map(Number)
  const [eh, em] = endHHMM.split(':').map(Number)
  const diff = (eh * 60 + em) - (sh * 60 + sm)
  return diff > 0 ? diff : diff + 1440
}

/** Sensible default schedule category for a Task, derived from its real
 *  origin (when it has one) before falling back to its domain. Mirrors what
 *  the Training/Projects/Media planning flows already picked by hand at
 *  their own call sites — this just makes the SAME defaulting available
 *  inside the Task editor's own "Add to schedule" section, since any task
 *  (not just ones planned from a contextual entity) can now be scheduled. */
export function defaultScheduleCategory(domain: string, taskSourceType?: string | null): TimeBlockCategory {
  if (taskSourceType === 'training_session') return 'training'
  if (taskSourceType === 'project_item')      return 'projects'
  if (taskSourceType === 'movie' || taskSourceType === 'tv_series') return 'media'
  if (domain === 'work')  return 'work'
  if (domain === 'media') return 'media'
  return 'other'
}

// The two source_type vocabularies overlap but aren't identical:
// tasks.source_type has 'tv_series'/'media'/'ai' and no 'tv_episode';
// time_blocks.source_type (migration 077) has 'tv_episode' and no
// 'tv_series'/'media'/'ai' (and never 'task' — that's task_id's job).
// A caller that already has ONE side's real entity but no explicit
// PlanSource (e.g. editing an existing task/block with no `source` prop)
// should carry that entity across rather than silently dropping it — these
// are the two directions of that translation.
const BLOCK_SOURCE_TYPES = ['training_session', 'movie', 'project_item', 'calendar', 'manual'] as const

/** tasks.source_type -> the matching time_blocks.source_type (or undefined
 *  when there's no valid equivalent, e.g. 'media'/'ai'). Deliberately does
 *  NOT map 'tv_series' -> 'tv_episode': that direction would invent
 *  episode-specificity this generic fallback has no way to back up (no
 *  season/episode numbers to go with it) — a caller that actually knows
 *  the episode (e.g. via `source.episodeInfo`) sets 'tv_episode' itself,
 *  explicitly, alongside real season_number/episode_number. Falling back
 *  from a bare 'tv_series' task with no further context is safer as "no
 *  block source" than as a falsely episode-specific one. */
export function blockSourceTypeForTask(taskSourceType?: string | null): string | undefined {
  if (!taskSourceType) return undefined
  return (BLOCK_SOURCE_TYPES as readonly string[]).includes(taskSourceType) ? taskSourceType : undefined
}

/** time_blocks.source_type -> the matching tasks.source_type (or undefined
 *  when there's no valid equivalent — every block source_type but
 *  'tv_episode' maps directly). */
export function taskSourceTypeForBlock(blockSourceType?: string | null): TaskSourceType | undefined {
  if (!blockSourceType) return undefined
  if (blockSourceType === 'tv_episode') return 'tv_series'
  return (BLOCK_SOURCE_TYPES as readonly string[]).includes(blockSourceType)
    ? (blockSourceType as TaskSourceType)
    : undefined
}

/** "One task = ONE Google entry" — whether an EDIT that makes a task
 *  calendar-linked must also opt it OUT of Google Tasks.
 *  create-time dedupe (skipGoogleTasks) only runs once at INSERT; without
 *  this check, a task that was already google_sync_enabled and later gains
 *  a GCal schedule ends up on Google TWICE (a Task AND an Event) — the real
 *  bug this closes on the edit path. Deliberately does NOT require an
 *  existing `google_task_id`: a task can be google_sync_enabled=true with
 *  google_task_id still NULL (a 'create' outbox row enqueued but not yet
 *  drained) — that pending create must be cancelled too, or it silently
 *  fires later and creates the now-unwanted Google Task anyway. Call this
 *  ONLY after the calendar event is confirmed actually linked (never
 *  speculatively) — flipping the flag off before that would leave the task
 *  with NEITHER Google representation if the calendar link then fails. */
export function needsGoogleTaskDedupe(calendarStatus: TimeBlockCalendarStatus, googleSyncEnabled: boolean): boolean {
  return calendarStatus === 'linked' && googleSyncEnabled
}

/** The CREATE-side mirror of the same ordering hazard needsGoogleTaskDedupe
 *  closes on EDIT. Every create path that creates a new task ALONGSIDE a
 *  schedule (saveTask's plain create, saveSchedule's "Also add to Tasks"
 *  branches) speculatively passes `skipGoogleTasks: willBeCalendarEvent` to
 *  `useCreateTask` — deciding to suppress the Google Task BEFORE the
 *  calendar link is even attempted. If that link then fails, the task
 *  would end up with NEITHER Google representation. This is whether that
 *  speculative skip must now be reversed (re-enable google_sync_enabled,
 *  which re-fires migration 071's opt-in branch and pushes the task to
 *  Google Tasks as a fallback) once the REAL outcome is known.
 *  Deliberately requires a CONFIRMED 'not_linked', not just "not linked
 *  yet" — an 'unknown' outcome (network failure, no token, …) must never
 *  trigger a fallback either, or a task could end up with a real Calendar
 *  event AND a Google Task (a SECOND representation) the moment the
 *  calendar link turns out to have actually succeeded after all. */
export function needsGoogleTasksFallback(skippedGoogleTasks: boolean, calendarStatus: TimeBlockCalendarStatus): boolean {
  return skippedGoogleTasks && calendarStatus === 'not_linked'
}

/** saveSchedule's "Also add to Tasks" branch (mode='schedule', editing a
 *  `timeBlock`) should only ever create a NEW linked task — `timeBlock` is
 *  contractually a standalone-only prop (a task-linked block is always
 *  edited via `task` instead), so `existingTaskId` should never be set
 *  here in practice. This is the last line of defense against a caller bug
 *  (e.g. passing a task-linked block through `timeBlock`) silently minting
 *  a SECOND task and re-pointing the block at it instead of updating the
 *  one real linked task that already exists. */
export function shouldCreateLinkedTask(alsoCreateTask: boolean, existingTaskId?: string | null): boolean {
  return alsoCreateTask && !existingTaskId
}

// ── Config resolution ─────────────────────────────────────────────────────────
// Note: there is no more resolveTabs/resolveDefaultTab — `mode` (task /
// schedule / recurring) replaces the old tab switcher entirely; a caller
// decides which entity it wants edited, not the user via a tab click.

export function isScheduleFieldHidden(field: ScheduleField, config?: PlanModalConfig): boolean {
  return !!config?.hideScheduleFields?.includes(field)
}

export function isScheduleFieldLocked(field: ScheduleField, config?: PlanModalConfig): boolean {
  return !!config?.lockScheduleFields?.includes(field)
}

export function isTaskFieldHidden(field: TaskField, config?: PlanModalConfig): boolean {
  return !!config?.hideTaskFields?.includes(field)
}

export function isTaskFieldLocked(field: TaskField, config?: PlanModalConfig): boolean {
  return !!config?.lockTaskFields?.includes(field)
}
