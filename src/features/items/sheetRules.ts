// ─────────────────────────────────────────────────────────────────────────────
//  The Add sheet's item rules (one item, migration 155) — pure.
//
//  Where an item goes on Google, which section its date files it under, and
//  how saved rows (task, slot, repeat rule) read as one item. The data layer's
//  itemRules.ts carries the same rules for the save; the functions named like
//  the contract's (defaultGoogleTarget, googleTargetProblem, sectionForItem,
//  itemFromRows) are this sheet's copies until that module lands — swap the
//  import, keep the call. Checked by scripts/verify-sheet-rules.cjs.
// ─────────────────────────────────────────────────────────────────────────────

import type { GoogleTarget, ItemInput, RepeatInput } from './itemTypes'
import type { QuickAddResult, QuickRepeat } from './quickAdd'
import type { LiveTaskSection, Task, TaskDomain } from '../todo/types'
import type { ScheduleBlock, TimeBlock, TimeBlockCategory } from '../daily/types'
import { sectionForDay } from '../todo/taskRules'
import { repeatSummary, weekdayOfIso, type RepeatKind, type RepeatUnit } from '../daily/recurrence'
import { formatWeekdayDate } from '../../shared/utils/dateFormat'
import { formatDurationMinutes } from '../../shared/utils/formatDuration'

type Shape = Pick<ItemInput, 'time' | 'durationMinutes' | 'repeat'>

// ── Google (owner, 15.10.2026) ───────────────────────────────────────────────
//  The owner reads to-dos in the Google Tasks widget on the iPhone and sees
//  Google Calendar through Apple Calendar, which doesn't show Google Tasks.

/** Where an item goes when nobody picked: a time or a repeat → Google
 *  Calendar (a repeat without a time is an all-day series); no time → Google
 *  Tasks. Never both by default. */
export function defaultGoogleTarget(input: Pick<ItemInput, 'time' | 'repeat'>): GoogleTarget {
  return input.time || input.repeat ? 'calendar' : 'tasks'
}

export interface GoogleProblem {
  /** 'blocked': this choice can't be saved for this item; 'warning': it can, said in the sheet. */
  level: 'blocked' | 'warning'
  message: string
}

/** Why a Google choice doesn't fit the item, or null. Google Tasks can't
 *  repeat through its API; Both shows the item twice in Google Calendar
 *  (which lists Google Tasks too). */
export function googleTargetProblem(input: Pick<ItemInput, 'repeat' | 'google'>): GoogleProblem | null {
  if (input.repeat && (input.google === 'tasks' || input.google === 'both')) {
    return { level: 'blocked', message: "Google Tasks can't repeat" }
  }
  if (input.google === 'both') return { level: 'warning', message: 'Shows twice in Google Calendar' }
  return null
}

/** The choice the item saves with: the one picked while it fits, else the default. */
export function effectiveGoogleTarget(input: Pick<ItemInput, 'time' | 'repeat'>, picked: GoogleTarget | null): GoogleTarget {
  if (picked && googleTargetProblem({ repeat: input.repeat, google: picked })?.level !== 'blocked') return picked
  return defaultGoogleTarget(input)
}

/** How the item sits on Google Calendar: busy with a length, free at a time, all day without one. */
function calendarKind(input: Shape): string {
  if (!input.time) return 'all day'
  return input.durationMinutes ? 'busy' : 'free'
}

/** The chip's text — the actual target, never "Auto". */
export function googleTargetLabel(input: Shape, target: GoogleTarget): string {
  switch (target) {
    case 'calendar': return `Google Calendar · ${calendarKind(input)}`
    case 'tasks':    return 'Google Tasks'
    case 'both':     return 'Google Tasks + Calendar'
    case 'none':     return 'Not on Google'
  }
}

export interface GoogleChoice {
  target: GoogleTarget
  label: string
  /** One line under the label. */
  hint: string
  /** Why it can't be picked for this item. */
  disabled?: string
}

/** The four choices of the Google chip, each saying what it does for this item. */
export function googleChoices(input: Shape): GoogleChoice[] {
  const cal = calendarKind(input)
  const repeat = input.repeat ? googleTargetProblem({ repeat: input.repeat, google: 'tasks' })?.message : undefined
  return [
    {
      target: 'calendar', label: 'Google Calendar',
      hint: cal === 'all day' ? (input.repeat ? 'An all-day repeating event' : 'An all-day event')
        : cal === 'busy' ? 'Busy for its length' : "Free — at its time, doesn't block",
    },
    { target: 'tasks', label: 'Google Tasks', hint: 'A to-do in the Google Tasks widget', disabled: repeat },
    { target: 'both', label: 'Tasks and Calendar', hint: 'Shows twice in Google Calendar', disabled: repeat },
    { target: 'none', label: 'Not on Google', hint: 'Only in this app' },
  ]
}

/** Lists a Google Tasks list may be picked for. */
export const hasGoogleTasks = (target: GoogleTarget) => target === 'tasks' || target === 'both'

// ── Section ──────────────────────────────────────────────────────────────────

/** Inbox / Today / Backlog are not picked in the sheet: they follow the date
 *  (owner, 15.10.2026) — no date → Inbox, today → Today, another day → Backlog. */
export function sectionForItem(input: Pick<ItemInput, 'date'>, today: string): LiveTaskSection {
  return input.date == null ? 'inbox' : sectionForDay(input.date, today)
}

// ── Repeat: the contract's RepeatInput ⇄ schedule_blocks' columns ─────────────

export interface RepeatColumns {
  days_of_week: number[]
  repeat_kind?: RepeatKind | null
  repeat_interval?: number | null
  repeat_unit?: RepeatUnit | null
  repeat_dates?: string[] | null
}

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

export function columnsFromRepeatInput(r: Pick<RepeatInput, 'kind' | 'daysOfWeek' | 'interval' | 'unit' | 'dates'>): RepeatColumns {
  return {
    days_of_week: r.daysOfWeek ?? [],
    repeat_kind: r.kind,
    repeat_interval: r.kind === 'interval' ? r.interval ?? 2 : null,
    repeat_unit: r.kind === 'interval' ? r.unit ?? 'week' : null,
    repeat_dates: r.kind === 'dates' ? r.dates ?? [] : null,
  }
}

/** A repeat read by quick add, completed for a start: a weekly one that named
 *  no day repeats on the start's weekday; a monthly one counts from the start's date. */
export function repeatFromQuick(q: QuickRepeat, start: string): RepeatColumns {
  const weekish = q.kind === 'weekly' || (q.kind === 'interval' && q.unit === 'week')
  const days = q.daysOfWeek?.length ? q.daysOfWeek : weekish ? [weekdayOfIso(start)] : []
  return columnsFromRepeatInput({ kind: q.kind, daysOfWeek: days, interval: q.interval, unit: q.unit })
}

// ── Saved rows → one item ────────────────────────────────────────────────────

type TaskRow = Pick<Task, 'id' | 'title' | 'description' | 'domain' | 'priority' | 'due_date' | 'due_time'
  | 'source_type' | 'source_id' | 'google_tasklist_id' | 'google_sync_enabled'> & { google_target?: GoogleTarget | null }
type BlockRow = Pick<TimeBlock, 'id' | 'date' | 'title' | 'start_time' | 'duration_minutes' | 'category' | 'notes'
  | 'source_type' | 'source_id' | 'google_calendar_event_id'> & { busy?: boolean | null; google_target?: GoogleTarget | null }
/** A repeat rule; since 155 it may have no time (an all-day repeat). */
type PlanRow = Pick<ScheduleBlock, 'id' | 'title' | 'category' | 'days_of_week' | 'effective_from'
  | 'repeat_kind' | 'repeat_interval' | 'repeat_unit' | 'repeat_dates' | 'google_calendar_event_id'>
  & { google_target?: GoogleTarget | null; start_time: string | null; end_time: string | null }

const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : null)

function minutesBetween(start: string, end: string): number {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const diff = toMin(end) - toMin(start)
  return diff > 0 ? diff : diff + 1440
}

/** The Google choice saved on the item (migration 155), or null on a row from before it. */
export function storedGoogleTarget(task?: TaskRow | null, block?: BlockRow | null, plan?: PlanRow | null): GoogleTarget | null {
  return task?.google_target ?? plan?.google_target ?? block?.google_target ?? null
}

/** Where a row from before 155 actually is on Google: a Calendar event on its
 *  slot or repeat, a Google Task while the task syncs, both, or neither. */
export function presentGoogleTarget(task?: TaskRow | null, block?: BlockRow | null, plan?: PlanRow | null): GoogleTarget {
  const calendar = !!(block?.google_calendar_event_id || plan?.google_calendar_event_id)
  const tasks = !!task?.google_sync_enabled
  return calendar && tasks ? 'both' : calendar ? 'calendar' : tasks ? 'tasks' : 'none'
}

const domainOfCategory = (c: TimeBlockCategory | undefined): TaskDomain =>
  c === 'work' ? 'work' : c === 'media' ? 'media' : 'personal'

/**
 * A saved item as the sheet's input: its task, its slot (a task's one-off
 * time_block, or a block of its own) and its repeat rule, as one thing. The
 * slot's day and time are the item's; the task's due date is a deadline only
 * when it differs from the slot's day (before 155 they were two facts, 077).
 * A slot without a start time, or one that doesn't block (busy = false), has
 * no length.
 */
export function itemFromRows(task?: TaskRow | null, block?: BlockRow | null, plan?: PlanRow | null): ItemInput {
  const time = plan ? hhmm(plan.start_time) : block ? hhmm(block.start_time) : hhmm(task?.due_time)
  const durationMinutes = plan
    ? (plan.start_time && plan.end_time ? minutesBetween(plan.start_time, plan.end_time) : null)
    : block && block.start_time && block.busy !== false ? block.duration_minutes : null
  const slotDate = plan ? plan.effective_from ?? null : block ? block.date : null
  const date = slotDate ?? task?.due_date ?? null
  const deadline = (block || plan) && task?.due_date && task.due_date !== slotDate
    ? { date: task.due_date, time: hhmm(task.due_time) }
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
    notes: task?.description ?? block?.notes ?? null,
    domain: task?.domain ?? domainOfCategory(block?.category ?? plan?.category),
    priority: task?.priority ?? 'medium',
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

// ── What the sheet says ──────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0')

/** "17:30–18:30" with a length, "17:30" without one. */
export function slotLabel(time: string, durationMinutes: number | null): string {
  if (!durationMinutes) return time
  const end = (Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + durationMinutes) % 1440
  return `${time}–${pad(Math.floor(end / 60))}:${pad(end % 60)}`
}

/** The "Read as" line: what quick add took from the text, as the chips will show it. */
export function readAsParts(parse: QuickAddResult, start: string): string[] {
  const parts: string[] = []
  if (parse.date) parts.push(formatWeekdayDate(parse.date))
  if (parse.time) parts.push(slotLabel(parse.time, parse.durationMinutes ?? null))
  else if (parse.durationMinutes) parts.push(formatDurationMinutes(parse.durationMinutes))
  if (parse.repeat) {
    const from = parse.date ?? start
    parts.push(repeatSummary({ ...repeatFromQuick(parse.repeat, from), effective_from: from }))
  }
  return parts
}

// ── Home's quick add ─────────────────────────────────────────────────────────

/**
 * One line typed into Home's quick add, as an item: what quick add read
 * (unless "Keep text"), on today when it names no day — Home's card is
 * today's list, and today files under Today. Google takes the default (none
 * while this device has no Google connection). Null when there is no title.
 */
export function itemFromQuickAdd(text: string, parse: QuickAddResult | null, today: string, googleConnected: boolean): ItemInput | null {
  const title = (parse ? parse.title : text).trim()
  if (!title) return null
  const date = parse?.date ?? today
  const time = parse?.time ?? null
  const repeat = parse?.repeat ? repeatInputFromColumns(repeatFromQuick(parse.repeat, date), date) : null
  return {
    title,
    domain: 'personal',
    priority: 'medium',
    date,
    time,
    durationMinutes: time ? parse?.durationMinutes ?? null : null,
    repeat,
    google: googleConnected ? defaultGoogleTarget({ time, repeat }) : 'none',
  }
}
