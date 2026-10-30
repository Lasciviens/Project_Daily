// ─────────────────────────────────────────────────────────────────────────────
//  One item (migration 155) — the PURE rules every screen and the data layer
//  share, in ONE place: which Google home an item gets by default, which
//  choices can't be saved, which To-Do section a day files it under, how
//  stored rows open in the sheet (itemFromRows), and what a save says
//  (describeSaved). The sheet's helpers (items/sheetRules.ts) re-export
//  these — never a second copy. Background: docs/features/tasks.md and
//  planning-calendar.md → "One item (155)". Imports only pure modules
//  (sucrase verify: scripts/verify-item-rules.cjs, verify-sheet-rules.cjs).
//
//  How an item is stored (the RPC app_save_item writes it; itemFromRows reads
//  it back):
//    task (always, but a repeat's rule)  title, notes (description), domain,
//        priority, section (follows the day), start_date (a window's start),
//        due_date / due_time — the DEADLINE when the item has one ("+
//        Deadline", due by), otherwise the item's own day and time. Daily
//        places a task with no slot at its due_time, so a deadline never
//        lands there as a do-time: an item with a day AND a deadline always
//        has a slot holding the day.
//    slot (time_blocks, task_id) — the item's day and time ("do it at"):
//        made for a time, for a day shown on Google Calendar, and for a day
//        whose deadline is elsewhere. start_time null = a day with no time
//        (on Google Calendar: all-day); busy false = a time with no length
//        (duration_minutes then holds a nominal 15; Google: Free).
//    rule (schedule_blocks) — a repeat: kind, days, start (effective_from),
//        start_time / end_time (both null = no time), busy, google_target,
//        domain / priority / notes for the days it becomes.
//    one day of a repeat — a slot marked with the rule and that day
//        (schedule_block_id + occurrence_date, 142) and its task.
//  Reading back: the slot's day and time are the item's; the task's due is a
//  deadline only when it differs from the slot's (another day, or another
//  time); a task with no slot is on its due day and time.
// ─────────────────────────────────────────────────────────────────────────────

import type { ScheduleBlock, TimeBlock, TimeBlockCategory } from '../daily/types'
import type { LiveTaskSection, Task, TaskDomain, TaskSection } from '../todo/types'
import { liveSection, sectionForDay } from '../todo/taskRules'
import { repeatSummary, type RepeatKind, type RepeatRule, type RepeatUnit } from '../daily/recurrence'
import { formatDate } from '../../shared/utils/dateFormat'
import { NOMINAL_EVENT_MINUTES } from '../calendar/calendarEventRules'
import type {
  GoogleTarget, GoogleTargetProblem, ItemInput, RepeatDayAction, RepeatInput, SavedItem,
} from './itemTypes'

/** A time with no length is stored with this many minutes (never shown as a length). */
export const ITEM_NOMINAL_MINUTES = NOMINAL_EVENT_MINUTES

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)/

/** 'HH:MM[:SS]' → 'HH:MM', or null. */
export function hhmm(t: string | null | undefined): string | null {
  const m = HHMM.exec(t ?? '')
  return m ? `${m[1]}:${m[2]}` : null
}
const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

// ── Google (owner, 15.10.2026) ───────────────────────────────────────────────
//  The owner reads to-dos in the Google Tasks widget on the iPhone and sees
//  Google Calendar through Apple Calendar, which doesn't show Google Tasks.

/** Where an item goes when nobody picked: a time or a repeat → Google
 *  Calendar (a repeat without a time is an all-day series); no time → Google
 *  Tasks. Never both by default. */
export function defaultGoogleTarget(input: Pick<ItemInput, 'time' | 'repeat'>): GoogleTarget {
  return input.time || input.repeat ? 'calendar' : 'tasks'
}

/** Why a Google choice doesn't fit the item, or null: Both shows the item
 *  twice in Google Calendar, which lists Google Tasks too (a warning, said in
 *  the sheet). Google Tasks can't repeat through its API, but since 156 a
 *  repeat on Google Tasks is "one per day": each day's task (made on its
 *  day) is a Google Task — so nothing is blocked any more. */
export function googleTargetProblem(input: Pick<ItemInput, 'repeat' | 'google'>, app: 'google' | 'apple' = 'google'): GoogleTargetProblem | null {
  // In Apple Calendar (its area on Apple, 2b-2) the event and the Google Task are in two apps: nothing shows twice.
  if (input.google === 'both' && app === 'google') return { level: 'warning', message: 'Shows twice in Google Calendar' }
  return null
}

/** Anything that stops a save (null = it can be saved); the database refuses the same. */
export function itemInputProblem(input: ItemInput): string | null {
  if (!input.title.trim()) return 'A title is needed'
  if (input.time && !HHMM.test(input.time)) return 'That time isn\'t HH:MM'
  if (input.date && !ISO_DAY.test(input.date)) return 'That day isn\'t a date'
  if (input.time && !input.date && !input.repeat) return 'A time needs a day'
  if (input.durationMinutes != null && (input.durationMinutes < 1 || input.durationMinutes > 1440)) return 'A length is 1 minute to 24 hours'
  if (input.scope === 'day' && (!input.scheduleBlockId || !input.occurrenceDate)) return 'Which day of the repeat?'
  const r = input.repeat
  if (r && input.scope !== 'day') {
    if (!ISO_DAY.test(r.startsOn)) return 'The repeat needs a start day'
    if (r.kind === 'weekly' && !(r.daysOfWeek ?? []).length) return 'Pick at least one day'
    if (r.kind === 'interval' && r.unit === 'week' && !(r.daysOfWeek ?? []).length) return 'Pick at least one day'
    if (r.kind === 'interval' && !(Number(r.interval) >= 1 && Number(r.interval) <= 99)) return 'Every 1–99'
    if (r.kind === 'dates' && !(r.dates ?? []).length) return 'Pick at least one date'
    if (r.kind === 'dates' && (r.dates ?? []).length > 366) return 'Pick at most 366 dates'
    const problem = googleTargetProblem(input)
    if (problem?.level === 'blocked') return problem.message
  }
  if ((input.google === 'calendar' || input.google === 'both') && !input.date && !(r && input.scope !== 'day')) {
    return 'Google Calendar needs a day — pick one, or choose Google Tasks'
  }
  return null
}

// ── Section ──────────────────────────────────────────────────────────────────

/**
 * Inbox / Today / Backlog are not picked in the sheet: they follow the date
 * (owner, 15.10.2026) — no date → Inbox, today → Today, another day →
 * Backlog. A screen that keeps sections (the Tasks tab) passes
 * `input.section`; an existing item with no day keeps its own (`current`, a
 * retired one reads Backlog).
 */
export function sectionForItem(
  input: Pick<ItemInput, 'date'> & Partial<Pick<ItemInput, 'section'>>, today: string, current?: TaskSection | null,
): LiveTaskSection {
  if (input.section) return input.section
  if (input.date != null) return sectionForDay(input.date, today)
  return current ? liveSection(current) : 'inbox'
}

// ── Repeat: RepeatInput ⇄ schedule_blocks' columns ──────────────────────────

export interface RepeatColumns {
  days_of_week: number[]
  repeat_kind?: RepeatKind | null
  repeat_interval?: number | null
  repeat_unit?: RepeatUnit | null
  repeat_dates?: string[] | null
}

/** A rule's columns as the sheet's RepeatInput (days sorted, dates sorted). */
export function repeatInputFromColumns(row: RepeatColumns, startsOn: string): RepeatInput {
  const kind = row.repeat_kind ?? 'weekly'
  return {
    kind,
    ...(kind !== 'dates' ? { daysOfWeek: [...new Set(row.days_of_week ?? [])].sort((a, b) => a - b) } : {}),
    ...(kind === 'interval' ? { interval: row.repeat_interval ?? 2, unit: row.repeat_unit ?? 'week' } : {}),
    ...(kind === 'dates' ? { dates: [...(row.repeat_dates ?? [])].sort() } : {}),
    startsOn,
  }
}

/** The sheet's RepeatInput as a recurrence.ts rule (to describe or project it). */
export function repeatRuleOf(r: RepeatInput): RepeatRule {
  const kind = r.kind === 'interval' && Number(r.interval) === 1
    ? (r.unit === 'month' ? 'monthly' : 'weekly')
    : r.kind
  const days = r.kind === 'interval' && Number(r.interval) === 1 && r.unit === 'day' ? [0, 1, 2, 3, 4, 5, 6] : (r.daysOfWeek ?? [])
  return {
    days_of_week: kind === 'dates' ? [] : days,
    repeat_kind: kind,
    repeat_interval: kind === 'interval' ? r.interval ?? 1 : null,
    repeat_unit: kind === 'interval' ? r.unit ?? 'week' : null,
    repeat_dates: kind === 'dates' ? r.dates ?? [] : null,
    effective_from: r.startsOn,
  }
}

// ── Saved rows → one item ────────────────────────────────────────────────────

// The columns read — Picks, so a screen can pass the rows it has; the 155
// columns are optional (a database before it has none of them).
type TaskRow = Pick<Task, 'id' | 'title' | 'description' | 'domain' | 'priority' | 'due_date' | 'due_time'
  | 'source_type' | 'source_id' | 'google_tasklist_id' | 'google_sync_enabled'> & { google_target?: GoogleTarget | null }
type BlockRow = Pick<TimeBlock, 'id' | 'date' | 'title' | 'start_time' | 'duration_minutes' | 'category' | 'notes'
  | 'source_type' | 'source_id' | 'google_calendar_event_id'> & { busy?: boolean | null; google_target?: GoogleTarget | null; icloud_area?: string | null }
/** A repeat rule; since 155 it may have no time (an all-day repeat). */
type PlanRow = Pick<ScheduleBlock, 'id' | 'title' | 'category' | 'days_of_week' | 'effective_from'
  | 'repeat_kind' | 'repeat_interval' | 'repeat_unit' | 'repeat_dates' | 'google_calendar_event_id'>
  & {
    google_target?: GoogleTarget | null; start_time: string | null; end_time: string | null; busy?: boolean | null
    domain?: TaskDomain | null; priority?: Task['priority'] | null; notes?: string | null
    /** The area calendar its series is in, in Apple Calendar (174). */
    icloud_area?: string | null
  }

/** The minutes between a rule's start and end (crossing midnight). */
function minutesBetween(start: string, end: string): number {
  const diff = minutesOf(end) - minutesOf(start)
  return diff > 0 ? diff : diff + 1440
}

/** The Google choice saved on the item (migration 155), or null on a row from before it. */
export function storedGoogleTarget(task?: TaskRow | null, block?: BlockRow | null, plan?: PlanRow | null): GoogleTarget | null {
  return task?.google_target ?? plan?.google_target ?? block?.google_target ?? null
}

/** Where a row from before 155 actually is on Google: a Calendar event on its
 *  slot or repeat, a Google Task while the task syncs, both, or neither —
 *  never a default, so saving an old item never moves it by itself. */
export function presentGoogleTarget(task?: TaskRow | null, block?: BlockRow | null, plan?: PlanRow | null): GoogleTarget {
  // On a calendar: Google's event, or — its area on Apple (2b-2, migration 175's SQL reads the same) — Apple's.
  const calendar = !!(block?.google_calendar_event_id || plan?.google_calendar_event_id || block?.icloud_area || plan?.icloud_area)
  const tasks = !!task?.google_sync_enabled
  return calendar && tasks ? 'both' : calendar ? 'calendar' : tasks ? 'tasks' : 'none'
}

const domainOfCategory = (c: TimeBlockCategory | string | null | undefined): TaskDomain =>
  c === 'work' ? 'work' : c === 'media' ? 'media' : 'personal'

/**
 * A saved item as the sheet's input: its task, its slot (a task's one-off
 * time_block, or a block of its own) and its repeat rule, as one thing. The
 * slot's day and time are the item's; the task's due is a deadline only when
 * it differs from the slot's — another day, or another time (before 155
 * they were two facts, 077). A slot without a start time, or one that
 * doesn't block (busy = false), has no length; so has a rule with no length.
 * The day of a repeat that is an item of its own opens as that item (scope
 * 'item': its save never touches the rule).
 */
export function itemFromRows(task?: TaskRow | null, block?: BlockRow | null, plan?: PlanRow | null): ItemInput {
  const time = plan ? hhmm(plan.start_time) : block ? hhmm(block.start_time) : hhmm(task?.due_time)
  const durationMinutes = plan
    ? (plan.start_time && plan.end_time && plan.busy !== false ? minutesBetween(plan.start_time, plan.end_time) : null)
    : block && block.start_time && block.busy !== false ? block.duration_minutes : null
  const slotDate = plan ? plan.effective_from ?? null : block ? block.date : null
  const date = slotDate ?? task?.due_date ?? null
  const dueTime = hhmm(task?.due_time)
  const deadline = (block || plan) && task?.due_date && (task.due_date !== slotDate || (!!dueTime && dueTime !== time))
    ? { date: task.due_date, time: dueTime }
    : null
  const source = task?.source_type && task.source_type !== 'manual'
    ? { type: task.source_type, id: task.source_id ?? '' }
    : block?.source_type ? { type: block.source_type, id: block.source_id ?? '' } : null
  return {
    taskId: task?.id ?? null,
    blockId: block?.id ?? null,
    scheduleBlockId: plan?.id ?? null,
    scope: plan ? 'all' : 'item',
    title: plan?.title ?? task?.title ?? block?.title ?? '',
    notes: plan?.notes ?? task?.description ?? block?.notes ?? null,
    domain: task?.domain ?? plan?.domain ?? domainOfCategory(block?.category ?? plan?.category),
    priority: task?.priority ?? plan?.priority ?? 'medium',
    date,
    time,
    durationMinutes,
    deadline,
    repeat: plan ? repeatInputFromColumns(plan, plan.effective_from ?? date ?? '') : null,
    google: storedGoogleTarget(task, block, plan) ?? presentGoogleTarget(task, block, plan),
    googleTaskList: task?.google_tasklist_id ?? null,
    source,
  }
}

// ── What it says ─────────────────────────────────────────────────────────────

/** 'HH:MM' + minutes → 'HH:MM' (wrapping past midnight). */
export function endOf(time: string, minutes: number): string {
  const total = (minutesOf(time) + minutes) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

const GOOGLE_WORDS: Record<GoogleTarget, string | null> = {
  tasks: 'on Google Tasks',
  calendar: 'on Google Calendar',
  both: 'on Google Tasks and Calendar',
  none: null,
}

/** A repeat on Google Tasks is one Google Task per day (156). */
const REPEAT_GOOGLE_WORDS: Partial<Record<GoogleTarget, string>> = {
  tasks: 'on Google Tasks, one per day',
  both: 'on Google Calendar and Google Tasks, one per day',
}

/** When the item is, as the toast says it: "15.10.2026 17:30–18:30", "Every week on Sun", "No date". */
export function itemWhenText(input: Pick<ItemInput, 'date' | 'time' | 'durationMinutes' | 'repeat'>): string {
  const time = hhmm(input.time)
  const clock = time ? (input.durationMinutes ? `${time}–${endOf(time, input.durationMinutes)}` : time) : ''
  if (input.repeat) {
    const summary = repeatSummary(repeatRuleOf(input.repeat))
    return clock ? `${summary}, ${clock}` : summary
  }
  if (!input.date) return 'No date'
  return clock ? `${formatDate(input.date)} ${clock}` : formatDate(input.date)
}

/**
 * The save's one result line (every action says its result): "Added ·
 * 15.10.2026 17:30–18:30 · on Google Calendar", "Saved for 15.10.2026 only ·
 * …", "Added · Every week on Sun · on Google Calendar".
 */
export function describeSaved(input: ItemInput, saved: SavedItem): string {
  const created = saved.created ?? (!input.taskId && !input.blockId && !input.scheduleBlockId)
  const day = saved.occurrenceDate ?? (input.scope === 'day' ? input.occurrenceDate : null)
  const verb = day ? `Saved for ${formatDate(day)} only` : created ? 'Added' : 'Saved'
  const parts = [verb, itemWhenText(day ? { ...input, repeat: null } : input)]
  if (input.deadline?.date) parts.push(`due ${formatDate(input.deadline.date)}${input.deadline.time ? ` ${hhmm(input.deadline.time)}` : ''}`)
  const google = (input.repeat && !day ? REPEAT_GOOGLE_WORDS[input.google] : undefined) ?? GOOGLE_WORDS[input.google]
  if (google) parts.push(google)
  return parts.join(' · ')
}

/** One day of a repeat: "Done for 15.10.2026", "Skipped 15.10.2026", "15.10.2026 open again". */
export function describeRepeatDay(action: RepeatDayAction | 'remove' | 'restore', date: string): string {
  const d = formatDate(date)
  switch (action) {
    case 'done': return `Done for ${d}`
    case 'skip': return `Skipped ${d}`
    case 'undo': return `${d} open again`
    case 'remove': return `${d} deleted`
    case 'restore': return `${d} back in the repeat`
  }
}

/** "Convert old items"'s result line. */
export function describeConverted(converted: number): string {
  if (!converted) return 'Nothing to convert — every slot ahead is an item already'
  return `Converted ${converted} old ${converted === 1 ? 'slot' : 'slots'} into items`
}

/** Its own Undo's result line. */
export function describeConvertUndone(r: { undone: number; kept: number; already?: boolean }): string {
  if (r.already) return 'Already undone'
  const kept = r.kept ? ` · ${r.kept} kept (changed since)` : ''
  return `Conversion undone: ${r.undone} ${r.undone === 1 ? 'item is a slot' : 'items are slots'} again${kept}`
}
