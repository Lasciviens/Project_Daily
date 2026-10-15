// ─────────────────────────────────────────────────────────────────────────────
//  The Add sheet's own item helpers (one item, migration 155) — pure.
//
//  The item rules the sheet shares with the data layer — the Google default
//  and its problems, the section a date files under, saved rows read as one
//  item — live in ONE place, items/itemRules.ts, and are re-exported here so
//  the sheet's imports stay as they were. This file keeps only what the sheet
//  alone needs: the Google chip's words, the chosen target, quick add's
//  repeat, the "Read as" line and Home's quick add. Checked by
//  scripts/verify-sheet-rules.cjs (and itemRules by verify-item-rules.cjs).
// ─────────────────────────────────────────────────────────────────────────────

import type { GoogleTarget, GoogleTargetProblem, ItemInput, RepeatInput } from './itemTypes'
import type { QuickAddResult, QuickRepeat } from './quickAdd'
import { repeatSummary, weekdayOfIso } from '../daily/recurrence'
import { formatWeekdayDate } from '../../shared/utils/dateFormat'
import { formatDurationMinutes } from '../../shared/utils/formatDuration'
import { defaultGoogleTarget, googleTargetProblem, repeatInputFromColumns, type RepeatColumns } from './itemRules'

export {
  defaultGoogleTarget, googleTargetProblem, sectionForItem, itemFromRows, storedGoogleTarget, presentGoogleTarget,
  repeatInputFromColumns, type RepeatColumns,
} from './itemRules'

/** A Google choice's problem — the data layer's type (itemTypes.GoogleTargetProblem). */
export type GoogleProblem = GoogleTargetProblem

type Shape = Pick<ItemInput, 'time' | 'durationMinutes' | 'repeat'>

// ── Google (owner, 15.10.2026) ───────────────────────────────────────────────

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

// ── Repeat: the sheet's RepeatInput → schedule_blocks' columns ────────────────

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
