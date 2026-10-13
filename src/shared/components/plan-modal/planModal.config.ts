// ─────────────────────────────────────────────────────────────────────────────
//  UnifiedPlanModal — CONFIG RESOLUTION & PURE HELPERS
//  No React here. Everything is a pure function so it can be unit-tested and
//  reused. Visual/behavioural defaults live here, NOT scattered in the modal.
// ─────────────────────────────────────────────────────────────────────────────

import { format, addDays, parseISO } from 'date-fns'
import type { RepeatRow, TimeBlockCategory } from '../../../features/daily/types'
import type { TaskSection, TaskSourceType } from '../../../features/todo/types'
import type { TimeBlockCalendarStatus } from '../../../features/daily/api/scheduleSyncRules'
import { sectionForDay } from '../../../features/todo/taskRules'
import {
  MAX_REPEAT_DATES, MAX_REPEAT_INTERVAL, nextOccurrences, repeatSummary, type RepeatUnit,
} from '../../../features/daily/recurrence'
import { todayStr, tomorrowStr } from '../../utils/dateUtils'
import { formatWeekdayDate } from '../../utils/dateFormat'
import type {
  PlanModalConfig, ScheduleField, TaskField, RecurrenceMode, CustomRepeatKind,
} from './planModal.types'

export { todayStr, tomorrowStr }

// ── Static presets ────────────────────────────────────────────────────────────

export const DURATION_PRESETS = [30, 60, 90, 120, 180] as const

// A one-off time_blocks row has no multi-day model anywhere downstream —
// dayAgendaProjection.ts clips every block onto ONLY the day it starts on
// plus a single-day spillover tail into the NEXT day (never further),
// TrainingCalendar/HomePage next-session logic assumes a same-day slot, and
// the DB column itself carries no day-count. A raw custom-duration input
// (min=1, no upper bound, no DB constraint) could save 0/negative/25h+
// values that silently broke that model — the input's own `min` attribute
// doesn't block a form submit, and nothing downstream re-validated it.
// 1440 = 24h, the largest value the single-spillover-day model can still
// represent correctly.
export const MIN_DURATION_MINUTES = 1
export const MAX_DURATION_MINUTES = 1440

export function clampDurationMinutes(raw: number): number {
  if (!Number.isFinite(raw)) return 60
  return Math.min(MAX_DURATION_MINUTES, Math.max(MIN_DURATION_MINUTES, Math.round(raw)))
}

export const CATEGORY_LABELS: Record<TimeBlockCategory, string> = {
  daily:    'Daily',
  training: 'Training',
  media:    'Media',
  games:    'Games',
  work:     'Work',
  projects: 'Projects',
  other:    'Other',
}

// One line at every width (a select, not a chip row — owner, 13.10.2026).
export const RECURRENCE_OPTIONS: { value: RecurrenceMode; label: string }[] = [
  { value: 'none',     label: 'No repeat' },
  { value: 'daily',    label: 'Every day' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly',   label: 'Weekly' },
  { value: 'monthly',  label: 'Monthly' },
  { value: 'custom',   label: 'Custom' },
]

// RecurringTab (editing an EXISTING schedule_blocks row) must never offer
// "No repeat" — a recurring template converting itself to a one-off block
// mid-edit is a real storage-migration UX this refactor deliberately does
// not build (see UnifiedPlanModal's own comment on the reverse case). The
// ScheduleTab CREATE flow keeps the full list — there, 'none' genuinely
// means "make a plain one-off time_block instead".
export const RECURRING_EDIT_OPTIONS = RECURRENCE_OPTIONS.filter(o => o.value !== 'none')

export const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const   // 0=Sun … 6=Sat
export const DAY_NAMES  = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
/** The day circles' order: Monday first. The stored numbering (0 = Sunday) never changes. */
export const DAY_ORDER  = [1, 2, 3, 4, 5, 6, 0] as const
export const WEEKDAYS   = [1, 2, 3, 4, 5]
export const EVERY_DAY  = [0, 1, 2, 3, 4, 5, 6]

export const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone


/** "Fri 26.06.2026" — the app-wide date format, weekday first. */
export function displayDate(iso: string): string {
  return formatWeekdayDate(iso) || iso
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

/** The To-Do section of a task planned for `iso` — taskRules.sectionForDay's
 *  one rule (today → Today, any other day → Backlog; never the retired
 *  Tomorrow / This week). */
export function sectionForDate(iso: string): TaskSection {
  return sectionForDay(iso, todayStr())
}

/** Resolve a weekly-style recurrence mode + explicit weekly days into the
 *  days_of_week array ([] for none / monthly / custom — repeatRowFromForm
 *  builds those). Deliberately does NOT fall back to Mon-Fri when weeklyDays is
 *  empty — that silent substitution used to let "uncheck every day, hit
 *  Save" quietly become "every weekday" instead of being rejected.
 *  hasValidRecurrenceSelection is the gate that must run BEFORE this. */
export function daysForRecurrence(mode: RecurrenceMode, weeklyDays: number[]): number[] {
  if (mode === 'daily')    return EVERY_DAY
  if (mode === 'weekdays') return WEEKDAYS
  if (mode === 'weekly')   return weeklyDays
  return []
}

/** Whether a weekly-style selection is complete enough to save. Only 'weekly'
 *  needs at least one day checked — 'daily'/'weekdays' are fully determined
 *  by their mode alone, and 'none' (one-off CREATE only — never valid while
 *  editing an existing recurring template) has no days concept at all. The
 *  monthly / custom checks are recurrenceProblem's, which runs this first. */
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

// ── Repeat: monthly, every N, picked dates (migration 146) ───────────────────
//  The planner's Repeat state (PlanForm's repeat fields) ⇄ schedule_blocks'
//  repeat columns. What a stored row MEANS is recurrence.ts's job (occursOn,
//  repeatSummary); these helpers only translate and validate the form.

export interface RepeatFormFields {
  recurrence:   RecurrenceMode
  /** Weekly-style days, and "every N weeks" days (0 = Sunday). */
  weeklyDays:   number[]
  /** Monthly (and every N months): the weekday nearest the start's date, or none = that date. */
  monthWeekday: number | null
  customKind:   CustomRepeatKind
  /** "Every [N]" as typed (validated by recurrenceProblem). */
  repeatEvery:  string
  repeatUnit:   RepeatUnit
  repeatDates:  string[]
}

export const REPEAT_UNIT_OPTIONS: { value: RepeatUnit; one: string; many: string }[] = [
  { value: 'day',   one: 'day',   many: 'days'   },
  { value: 'week',  one: 'week',  many: 'weeks'  },
  { value: 'month', one: 'month', many: 'months' },
]

/** Which day circles a choice shows: several days, one weekday (optional), or none. */
export function dayPickerFor(f: Pick<RepeatFormFields, 'recurrence' | 'customKind' | 'repeatUnit'>): 'multi' | 'single' | null {
  switch (f.recurrence) {
    case 'daily': case 'weekdays': case 'weekly': return 'multi'
    case 'monthly': return 'single'
    case 'custom':
      if (f.customKind === 'dates') return null
      return f.repeatUnit === 'week' ? 'multi' : f.repeatUnit === 'month' ? 'single' : null
    default: return null
  }
}

/** The circles lit for the current choice (Every day lights all seven, Weekdays Mon–Fri). */
export function litDays(f: RepeatFormFields): number[] {
  const picker = dayPickerFor(f)
  if (picker === 'single') return f.monthWeekday == null ? [] : [f.monthWeekday]
  if (picker === 'multi') return f.recurrence === 'custom' ? f.weeklyDays : daysForRecurrence(f.recurrence, f.weeklyDays)
  return []
}

/** A tap on a day circle. Weekly-style choices follow the days (all seven =
 *  Every day, Mon–Fri = Weekdays, any other set = Weekly — the same reading as
 *  opening a saved plan, inferRecurrenceMode); a monthly-style choice takes
 *  one weekday, and a second tap clears it (back to "the same date"). */
export function toggleRepeatDay(f: RepeatFormFields, day: number): Partial<RepeatFormFields> {
  const picker = dayPickerFor(f)
  if (picker === 'single') return { monthWeekday: f.monthWeekday === day ? null : day }
  if (picker !== 'multi') return {}
  const current = litDays(f)
  const next = current.includes(day) ? current.filter(d => d !== day) : [...current, day].sort((a, b) => a - b)
  if (f.recurrence === 'custom') return { weeklyDays: next }
  return { recurrence: next.length === 0 ? 'weekly' : inferRecurrenceMode(next), weeklyDays: next }
}

/** Picking a choice in the Repeat select. Weekly (and Custom's "every N
 *  weeks") keep a set of days of their own; when the days on hand are every
 *  day or Mon–Fri (or none) they start from the plan's own weekday
 *  (`startWeekday`), so "Weekly" never shows the same circles as Weekdays. */
export function pickRecurrence(f: RepeatFormFields, mode: RecurrenceMode, startWeekday: number): Partial<RepeatFormFields> {
  if (mode !== 'weekly' && mode !== 'custom') return { recurrence: mode }
  const own = f.weeklyDays.length > 0 && inferRecurrenceMode(f.weeklyDays) === 'weekly'
  return { recurrence: mode, weeklyDays: own ? f.weeklyDays : [startWeekday] }
}

/** Why the Repeat choice can't be saved yet, or null when it can. */
export function recurrenceProblem(f: RepeatFormFields): string | null {
  if (!hasValidRecurrenceSelection(f.recurrence, f.weeklyDays)) return 'Pick at least one day.'
  if (f.recurrence !== 'custom') return null
  if (f.customKind === 'dates') {
    const n = new Set(f.repeatDates).size
    if (n === 0) return 'Pick at least one date.'
    // The database keeps at most 366 (146's CHECK) — say so before saving.
    return n > MAX_REPEAT_DATES ? `Pick at most ${MAX_REPEAT_DATES} dates (${n} picked).` : null
  }
  const n = Number(f.repeatEvery)
  if (!Number.isInteger(n) || n < 1 || n > MAX_REPEAT_INTERVAL) return `Repeat every 1 to ${MAX_REPEAT_INTERVAL} ${f.repeatUnit}s.`
  if (f.repeatUnit === 'week' && f.weeklyDays.length === 0) return 'Pick at least one day.'
  return null
}

const sortedDays = (days: number[]) => [...new Set(days)].sort((a, b) => a - b)

/** The repeat columns a save writes. One meaning, one shape: "every 1 week"
 *  is stored as weekly, "every 1 month" as monthly, "every 1 day" as every
 *  day. Call only for a choice recurrenceProblem accepts and that repeats. */
export function repeatRowFromForm(f: RepeatFormFields): RepeatRow {
  const weekly = (days: number[]): RepeatRow =>
    ({ days_of_week: sortedDays(days), repeat_kind: 'weekly', repeat_interval: null, repeat_unit: null, repeat_dates: null })
  const monthly = (every: number): RepeatRow => {
    const days = f.monthWeekday == null ? [] : [f.monthWeekday]
    return every === 1
      ? { days_of_week: days, repeat_kind: 'monthly', repeat_interval: null, repeat_unit: null, repeat_dates: null }
      : { days_of_week: days, repeat_kind: 'interval', repeat_interval: every, repeat_unit: 'month', repeat_dates: null }
  }
  if (f.recurrence === 'monthly') return monthly(1)
  if (f.recurrence !== 'custom') return weekly(daysForRecurrence(f.recurrence, f.weeklyDays))
  if (f.customKind === 'dates') {
    return { days_of_week: [], repeat_kind: 'dates', repeat_interval: null, repeat_unit: null, repeat_dates: [...new Set(f.repeatDates)].sort() }
  }
  const every = Math.min(MAX_REPEAT_INTERVAL, Math.max(1, Math.floor(Number(f.repeatEvery)) || 1))
  if (f.repeatUnit === 'month') return monthly(every)
  if (f.repeatUnit === 'day') {
    return every === 1 ? weekly(EVERY_DAY) : { days_of_week: [], repeat_kind: 'interval', repeat_interval: every, repeat_unit: 'day', repeat_dates: null }
  }
  return every === 1 ? weekly(f.weeklyDays)
    : { days_of_week: sortedDays(f.weeklyDays), repeat_kind: 'interval', repeat_interval: every, repeat_unit: 'week', repeat_dates: null }
}

/** A saved plan's repeat columns as the planner's Repeat state (the inverse of repeatRowFromForm). */
export function repeatFormFromRow(row: {
  days_of_week: number[]; repeat_kind?: string | null; repeat_interval?: number | null
  repeat_unit?: RepeatUnit | null; repeat_dates?: string[] | null
}): Partial<RepeatFormFields> {
  const days = sortedDays(row.days_of_week ?? [])
  if (row.repeat_kind === 'monthly') return { recurrence: 'monthly', monthWeekday: days[0] ?? null }
  if (row.repeat_kind === 'dates') return { recurrence: 'custom', customKind: 'dates', repeatDates: [...(row.repeat_dates ?? [])].sort() }
  if (row.repeat_kind === 'interval') {
    const unit = row.repeat_unit ?? 'week'
    return {
      recurrence: 'custom', customKind: 'every', repeatEvery: String(row.repeat_interval ?? 2), repeatUnit: unit,
      ...(unit === 'month' ? { monthWeekday: days[0] ?? null } : unit === 'week' ? { weeklyDays: days } : {}),
    }
  }
  return { recurrence: inferRecurrenceMode(days), weeklyDays: days }
}

/** The first day a repeat may occur on (schedule_blocks.effective_from): the
 *  planner's start date — or, for picked dates, the earliest of the start and
 *  the first pick, so no picked day is hidden behind the start. */
export function repeatStart(row: RepeatRow, start: string): string {
  const first = row.repeat_kind === 'dates' ? row.repeat_dates?.[0] : undefined
  return first && first < start ? first : start
}

/** What a choice counts from (its start, effective_from): the day of the month
 *  for Monthly and every N months, the first day for every N days / weeks.
 *  null for Every day / Weekdays / Weekly and picked dates, whose start only
 *  bounds them. */
export type RepeatAnchor = 'month' | 'week' | 'day'

export function repeatAnchorOf(f: Pick<RepeatFormFields, 'recurrence' | 'customKind' | 'repeatUnit'>): RepeatAnchor | null {
  if (f.recurrence === 'monthly') return 'month'
  if (f.recurrence === 'custom' && f.customKind === 'every') return f.repeatUnit
  return null
}

/** The same for a saved plan's columns. */
export function repeatAnchorOfRow(row: { repeat_kind?: string | null; repeat_unit?: RepeatUnit | null }): RepeatAnchor | null {
  if (row.repeat_kind === 'monthly') return 'month'
  if (row.repeat_kind === 'interval') return row.repeat_unit ?? null
  return null
}

/**
 * Editing a saved plan: a Repeat change that changes what the plan counts
 * from moves "Starts" — to today for a new anchor (a weekly plan turned
 * monthly must not count from the day it was first saved: "the Saturday
 * nearest the 5th" when the owner meant the 13th), back to the saved start
 * when the choice returns to the saved anchor or to one without an anchor.
 * Returns the patch with `date` added when it moves.
 */
export function withStartForRepeatChange<P extends Partial<RepeatFormFields>>(
  form: RepeatFormFields, p: P, saved: { start: string; anchor: RepeatAnchor | null }, today: string,
): P & { date?: string } {
  const before = repeatAnchorOf(form)
  const after = repeatAnchorOf({ ...form, ...p })
  if (after === before) return p
  return { ...p, date: after === null || after === saved.anchor ? saved.start : today }
}

/** effective_from when a saved plan is saved again: the "Starts" shown for a
 *  choice that counts from it; otherwise the saved start stays (moving it
 *  would rewrite the plan's history) — only picked dates before it move it
 *  earlier, so none is hidden. */
export function editedRepeatStart(f: RepeatFormFields & { date: string }, row: RepeatRow, savedStart: string | null | undefined): string | undefined {
  if (repeatAnchorOf(f)) return repeatStart(row, f.date)
  return savedStart ? repeatStart(row, savedStart) : undefined
}

/** The one-line summary and the next three days of the current choice, as the
 *  saved plan will have them (recurrence.ts); null while it can't be saved. */
export function repeatPreview(f: RepeatFormFields, start: string, today: string, exceptDates: readonly string[] = []): { summary: string; next: string[] } | null {
  if (f.recurrence === 'none' || recurrenceProblem(f)) return null
  const row = repeatRowFromForm(f)
  const rule = { ...row, effective_from: repeatStart(row, start), except_dates: exceptDates }
  return { summary: repeatSummary(rule), next: nextOccurrences(rule, today, 3) }
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
