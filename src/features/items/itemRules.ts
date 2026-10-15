// ─────────────────────────────────────────────────────────────────────────────
//  One item (migration 155) — the PURE rules every screen and the data layer
//  share: which Google home an item gets by default, which choices can't be
//  saved, which To-Do section a day files it under, how stored rows open in
//  the sheet (itemFromRows), and what a save says (describeSaved).
//  Background: docs/features/tasks.md and planning-calendar.md → "One item
//  (155)". Imports only pure modules (sucrase verify:
//  scripts/verify-item-rules.cjs).
//
//  How an item is stored (the RPC app_save_item writes it):
//    task (always, but a repeat's rule)  title, notes (description), domain,
//        priority, section, due_date = the item's day (else its deadline's),
//        due_time = its time, deadline_date / deadline_time, google_target
//    slot (time_blocks, task_id)  when it has a time, or a day on Google
//        Calendar: date, start_time (null = all-day presence), busy (false =
//        no length), duration_minutes (nominal 15 without a length)
//    rule (schedule_blocks)  a repeat: its kind, days, start (effective_from),
//        start_time / end_time (both null = no time), busy, google_target
//    one day of a repeat  a slot marked with the rule and that day
//        (schedule_block_id + occurrence_date, 142) and its task
// ─────────────────────────────────────────────────────────────────────────────

import type { ScheduleBlock, TimeBlock } from '../daily/types'
import type { LiveTaskSection, Task, TaskSection } from '../todo/types'
import { liveSection, sectionForDay } from '../todo/taskRules'
import { repeatSummary, type RepeatRule } from '../daily/recurrence'
import { formatDate } from '../../shared/utils/dateFormat'
import { NOMINAL_EVENT_MINUTES, stripDoneMark } from '../calendar/calendarEventRules'
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

/**
 * Where an item goes on Google when the owner hasn't picked (owner,
 * 15.10.2026): a time or a repeat → Google Calendar (the iPhone shows it
 * through Apple Calendar; a repeat can only go there); otherwise → Google
 * Tasks (the iPhone's Tasks widget). Never 'both' by default.
 */
export function defaultGoogleTarget(input: Pick<ItemInput, 'date' | 'time' | 'repeat'>): GoogleTarget {
  if (input.repeat) return 'calendar'
  if (input.time) return 'calendar'
  return 'tasks'
}

/** The Google choice's problem, if any: an error can't be saved, a warning is shown in the sheet. */
export function googleTargetProblem(input: Pick<ItemInput, 'date' | 'time' | 'repeat' | 'google'>): GoogleTargetProblem | null {
  const tasks = input.google === 'tasks' || input.google === 'both'
  const calendar = input.google === 'calendar' || input.google === 'both'
  if (input.repeat && tasks) {
    return { level: 'error', message: 'Google Tasks can\'t repeat — choose Google Calendar or Not on Google' }
  }
  if (calendar && !input.repeat && !input.date) {
    return { level: 'error', message: 'Google Calendar needs a day — pick one, or choose Google Tasks' }
  }
  if (input.google === 'both') return { level: 'warning', message: 'Shows twice in Google Calendar' }
  return null
}

/** Anything else that stops a save (null = it can be saved). */
export function itemInputProblem(input: ItemInput): string | null {
  if (!input.title.trim()) return 'A title is needed'
  if (input.time && !HHMM.test(input.time)) return 'That time isn\'t HH:MM'
  if (input.date && !ISO_DAY.test(input.date)) return 'That day isn\'t a date'
  if (input.time && !input.date && !input.repeat) return 'A time needs a day'
  if (input.durationMinutes != null && (input.durationMinutes < 1 || input.durationMinutes > 1440)) return 'A length is 1 minute to 24 hours'
  if (input.scope === 'day' && (!input.scheduleBlockId || !input.occurrenceDate)) return 'Which day of the repeat?'
  const r = input.repeat
  if (r) {
    if (!ISO_DAY.test(r.startsOn)) return 'The repeat needs a start day'
    if (r.kind === 'weekly' && !(r.daysOfWeek ?? []).length) return 'Pick at least one day'
    if (r.kind === 'interval' && r.unit === 'week' && !(r.daysOfWeek ?? []).length) return 'Pick at least one day'
    if (r.kind === 'interval' && !(Number(r.interval) >= 1 && Number(r.interval) <= 99)) return 'Every 1–99'
    if (r.kind === 'dates' && !(r.dates ?? []).length) return 'Pick at least one date'
    if (r.kind === 'dates' && (r.dates ?? []).length > 366) return 'Pick at most 366 dates'
  }
  return googleTargetProblem(input)?.level === 'error' ? googleTargetProblem(input)!.message : null
}

/**
 * The To-Do section an item is filed under — not picked in the sheet (owner,
 * 15.10.2026): today → Today, another day → Backlog, no day → Inbox. A screen
 * that keeps sections (the Tasks tab) passes `input.section`; an existing item
 * with no day keeps its own section (`current`, a retired one reads Backlog).
 */
export function sectionForItem(input: Pick<ItemInput, 'date' | 'section'>, today: string, current?: TaskSection | null): LiveTaskSection {
  if (input.section) return input.section
  if (input.date) return sectionForDay(input.date, today)
  return current ? liveSection(current) : 'inbox'
}

/** The Google home an old row (google_target NULL) has today: its actual presence, never a default. */
export function googlePresenceOf(taskSync: boolean | null | undefined, eventId: string | null | undefined): GoogleTarget {
  if (taskSync && eventId) return 'both'
  if (eventId) return 'calendar'
  if (taskSync) return 'tasks'
  return 'none'
}

/** A rule's repeat (schedule_blocks) as the sheet's RepeatInput. */
export function repeatFromPlan(plan: Pick<ScheduleBlock, 'days_of_week' | 'repeat_kind' | 'repeat_interval' | 'repeat_unit' | 'repeat_dates' | 'effective_from'>): RepeatInput {
  const startsOn = plan.effective_from ?? ''
  const days = [...(plan.days_of_week ?? [])]
  switch (plan.repeat_kind ?? 'weekly') {
    case 'monthly': return { kind: 'monthly', daysOfWeek: days, startsOn }
    case 'interval': return { kind: 'interval', interval: plan.repeat_interval ?? 1, unit: plan.repeat_unit ?? 'week', daysOfWeek: days, startsOn }
    case 'dates': return { kind: 'dates', dates: [...(plan.repeat_dates ?? [])], startsOn }
    default: return { kind: 'weekly', daysOfWeek: days, startsOn }
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

const domainOfCategory = (c: string | null | undefined): ItemInput['domain'] => (c === 'work' ? 'work' : c === 'media' ? 'media' : 'personal')

/** The minutes between a rule's start and end (crossing midnight), or null without a time. */
function planMinutes(start: string | null | undefined, end: string | null | undefined): number | null {
  const s = hhmm(start)
  const e = hhmm(end)
  if (!s || !e) return null
  const m = minutesOf(e) - minutesOf(s)
  return m <= 0 ? m + 1440 : m
}

/**
 * Stored rows → the sheet's ItemInput (to open an existing item). Pass what
 * the screen has: a task (with its slot), a slot alone (an old standalone
 * one), a rule alone (a repeating item), or a day of a rule (its task + slot,
 * and the rule for its repeat). The Google choice of a row saved before 155
 * is its ACTUAL presence (googlePresenceOf) — never the default — so saving
 * an old item never moves it between Google Tasks and Calendar by itself.
 */
export function itemFromRows(task: Task | null | undefined, block: TimeBlock | null | undefined, plan: ScheduleBlock | null | undefined): ItemInput {
  const occurrence = !!block?.schedule_block_id && !!block?.occurrence_date
  if (plan && !task && !(block && occurrence)) {
    const time = hhmm(plan.start_time)
    return {
      scheduleBlockId: plan.id,
      scope: 'all',
      title: plan.title,
      notes: plan.notes ?? null,
      domain: plan.domain ?? domainOfCategory(plan.category),
      priority: plan.priority ?? 'medium',
      date: plan.effective_from ?? null,
      time,
      durationMinutes: time && plan.busy !== false ? planMinutes(plan.start_time, plan.end_time) : null,
      deadline: null,
      repeat: repeatFromPlan(plan),
      google: plan.google_target ?? (plan.google_calendar_event_id ? 'calendar' : 'none'),
    }
  }
  const timed = block ? hhmm(block.start_time) : null
  const time = block ? timed : hhmm(task?.due_time)
  const google: GoogleTarget = task
    ? (task.google_target ?? googlePresenceOf(task.google_sync_enabled, block?.google_calendar_event_id ?? null))
    : (block?.google_calendar_event_id ? 'calendar' : 'none')
  const deadline = task?.deadline_date ? { date: task.deadline_date, time: hhmm(task.deadline_time) } : null
  const source = task && task.source_type !== 'manual' && task.source_id
    ? { type: task.source_type, id: task.source_id }
    : !task && block?.source_type && block.source_id ? { type: block.source_type, id: block.source_id } : null
  return {
    taskId: task?.id ?? null,
    blockId: block?.id ?? null,
    scheduleBlockId: occurrence ? block!.schedule_block_id! : null,
    scope: occurrence ? 'day' : 'item',
    occurrenceDate: occurrence ? block!.occurrence_date! : null,
    title: stripDoneMark(task?.title ?? block?.title ?? ''),
    notes: task?.description ?? block?.notes ?? null,
    domain: task?.domain ?? domainOfCategory(block?.category),
    priority: task?.priority ?? 'medium',
    date: block?.date ?? task?.due_date ?? null,
    time,
    durationMinutes: block && timed && block.busy !== false ? block.duration_minutes : null,
    deadline,
    repeat: occurrence && plan ? repeatFromPlan(plan) : null,
    google,
    googleTaskList: task?.google_tasklist_id ?? null,
    source,
  }
}

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
  const google = GOOGLE_WORDS[input.google]
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
    case 'remove': return `${d} deleted from the repeat`
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

/** The Google card's line for the Calendar read-back (dates DD.MM.YYYY, times HH:MM). */
export function readbackStateText(s: { lastRunAt: string | null; lastCleanAt: string | null; lastError: string | null; available?: boolean }): string {
  if (s.available === false) return 'Calendar changes: not set up yet (migration 155)'
  const at = (iso: string | null) => {
    if (!iso) return ''
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return `${formatDate(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  if (!s.lastRunAt) return 'Calendar changes: not read yet'
  if (s.lastError) return `Calendar changes: last read ${at(s.lastRunAt)} failed — ${s.lastError}`
  return `Calendar changes read ${at(s.lastCleanAt ?? s.lastRunAt)}`
}
