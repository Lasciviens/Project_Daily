// ─────────────────────────────────────────────────────────────────────────────
//  An item's calendar fields (migration 193; the one item screen, step 2 —
//  docs/features/item-screen-plan.md): End Repeat, Alert + Second Alert,
//  Show As, URL and Travel Time — what the screen offers, how it names them
//  and what it may send. Stored on the slot (time_blocks) or the repeat
//  (schedule_blocks); Apple Calendar gets them all, Google what it has
//  (calendarEventRules / calendarSeries / icloudEvents).
//
//  The allow-lists are calendarEventRules' (the database CHECKs the same —
//  verify-db-item-calendar-fields compares them); the sheet sends a link only
//  through cleanItemUrl, whose answer item_url_ok always takes
//  (verify-item-calendar-fields). Pure.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ALERT_MINUTES, ITEM_URL, ITEM_URL_MAX, MAX_ITEM_ALERTS, TRAVEL_MINUTES, allDayAlertDays, eventAlerts, eventShowAs, eventTravel, eventUrl, type ShowAs,
} from '../calendar/calendarEventRules'
import { MAX_REPEAT_COUNT, countEndDay, isIsoDay, repeatCountOf, repeatLastDay, type RepeatRule } from '../daily/recurrence'
import { formatDate } from '../../shared/utils/dateFormat'
import type { RepeatEnd } from './itemTypes'

export { ALERT_MINUTES, ITEM_URL_MAX, MAX_ITEM_ALERTS, MAX_REPEAT_COUNT, TRAVEL_MINUTES, type ShowAs }

/** The fields the sheet tracks as touched (an edit sends one only when the sheet knew it or the owner changed it). */
export type CalendarField = 'alerts' | 'showAs' | 'url' | 'travel' | 'repeatEnd'

// ── Alert and Second Alert ──────────────────────────────────────────────────

/** A timed item's choices (Apple's own list): at the time, then minutes before. */
export const ALERT_CHOICES_TIMED: readonly number[] = ALERT_MINUTES
/** An all-day item's choices: on the day, 1 day, 2 days or a week before — each at 09:00. */
export const ALERT_CHOICES_ALL_DAY: readonly number[] = [0, 1440, 2880, 10080]

export function alertChoices(allDay: boolean): readonly number[] {
  return allDay ? ALERT_CHOICES_ALL_DAY : ALERT_CHOICES_TIMED
}

const TIMED_LABEL: Record<number, string> = {
  0: 'At time of event', 5: '5 minutes before', 10: '10 minutes before', 15: '15 minutes before', 30: '30 minutes before',
  60: '1 hour before', 120: '2 hours before', 1440: '1 day before', 2880: '2 days before', 10080: '1 week before',
}

/** "30 minutes before"; an all-day item's "On the day (09:00)", "1 day before (09:00)". */
export function alertLabel(minutes: number, allDay: boolean): string {
  if (!allDay) return TIMED_LABEL[minutes] ?? `${minutes} minutes before`
  const days = minutes >= 10080 ? 'A week before' : minutes >= 2880 ? '2 days before' : minutes >= 1440 ? '1 day before' : 'On the day'
  return `${days} (09:00)`
}

/** The screen's two rows: Alert ('default' = the area's own, 'none', or minutes) and Second Alert (minutes or null). */
export interface AlertRows { alert: 'default' | 'none' | number; second: number | null }

/** A stored list as the two rows. */
export function alertRows(alerts: readonly number[] | null | undefined): AlertRows {
  const a = eventAlerts(alerts)
  if (a === null) return { alert: 'default', second: null }
  if (!a.length) return { alert: 'none', second: null }
  return { alert: a[0], second: a[1] ?? null }
}

/** The two rows as what is saved: null = the area's own, [] = none; a Second Alert only beside a real first one, never
 *  the same twice. */
export function alertsOf(rows: AlertRows): number[] | null {
  if (rows.alert === 'default') return null
  if (rows.alert === 'none') return []
  const out = [rows.alert]
  if (rows.second !== null && rows.second !== rows.alert) out.push(rows.second)
  return eventAlerts(out) ?? []
}

/**
 * An item's own alerts read for its kind. All day: each alert is the day it falls on, at 09:00 — what both calendars
 * write for it (allDayAlertDays) — so one saved while the item had a time ("30 minutes before") shows as the choice it
 * is ("On the day (09:00)"). With a time: as saved.
 */
export function alertsForKind(alerts: number[] | null, allDay: boolean): number[] | null {
  if (!allDay || !alerts) return alerts
  const days = [...new Set(alerts.map(m => allDayAlertDays(m) * 1440))]
  return days.length === alerts.length && days.every((d, i) => d === alerts[i]) ? alerts : days
}

/**
 * The alerts an item keeps when the All-day switch changes it (as the iPhone's Calendar does): only an alert a whole
 * day or more before means the same with a time and all day; one within the day ("30 minutes before", "On the day
 * (09:00)") is dropped, and none left is Default (the area's own). None stays None.
 */
export function alertsOnAllDaySwitch(alerts: number[] | null): number[] | null {
  if (!alerts || !alerts.length) return alerts
  const kept = alerts.filter(m => m >= 1440)
  return kept.length ? kept : null
}

/** What the database takes (item_alerts_ok): null, [], or one or two of the list, distinct. */
export function isStorableAlerts(v: unknown): v is number[] | null {
  return v === null || eventAlerts(v) !== null
}

// ── Show As ─────────────────────────────────────────────────────────────────

/** "Busy" / "Free"; none of its own reads as what the length gives (Busy with one, Free without and all day). */
export function showAsLabel(showAs: ShowAs | null | undefined, timedWithLength: boolean): string {
  const v = eventShowAs(showAs) ?? (timedWithLength ? 'busy' : 'free')
  return v === 'busy' ? 'Busy' : 'Free'
}

// ── Travel Time ─────────────────────────────────────────────────────────────

/** null = automatic (Apple's Time to Leave, from the place's map pin), then None and the minutes. */
export const TRAVEL_CHOICES: readonly (number | null)[] = [null, ...TRAVEL_MINUTES]

/** "Automatic" (with a map pin: Time to Leave; without one there is nothing to work from), "None", "1 hour 30 minutes". */
export function travelLabel(minutes: number | null | undefined, hasPin = true): string {
  const m = eventTravel(minutes)
  if (m === null) return hasPin ? 'Automatic' : 'Automatic (needs a place on the map)'
  if (m === 0) return 'None'
  const h = Math.floor(m / 60)
  const rest = m % 60
  return [h ? `${h} hour${h === 1 ? '' : 's'}` : '', rest ? `${rest} minutes` : ''].filter(Boolean).join(' ')
}

// ── URL ─────────────────────────────────────────────────────────────────────

/** A typed link as it is stored, or why it can't be: '' = none. */
export type UrlResult = { url: string | null } | { problem: string }

/** One character a stored link may hold as it is (a % only before two hex digits — fixed after). */
const URL_CHAR = /^[A-Za-z0-9._~!$&'()*+,;=:@/?#%-]$/

/**
 * A typed link, cleaned for the database (item_url_ok): trimmed; a bare host ("example.com/x") gets https://; only
 * https, no user name; the browser's own URL form (a host in lower case and punycode, a space as %20), then any
 * character outside the allow-list percent-encoded — and the result checked against ITEM_URL and 2048 characters.
 */
export function cleanItemUrl(text: string | null | undefined): UrlResult {
  const t = (text ?? '').trim()
  if (!t) return { url: null }
  if (t.length > ITEM_URL_MAX * 3) return { problem: `A link is at most ${ITEM_URL_MAX} characters` } // a huge paste costs nothing
  if (/[\x00-\x1F\x7F\u2028\u2029]/.test(t)) return { problem: 'A link is one line' } // eslint-disable-line no-control-regex
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`
  let u: URL
  try { u = new URL(withScheme) } catch { return { problem: "That isn't a web address" } }
  if (u.protocol !== 'https:') return { problem: 'Only https:// links' }
  if (u.username || u.password) return { problem: 'A link with a user name or password is not taken' }
  if (!u.hostname) return { problem: "That isn't a web address" }
  const href = [...u.href].map(ch => (URL_CHAR.test(ch) ? ch : encodeURIComponent(ch))).join('')
    .replace(/%(?![0-9A-Fa-f]{2})/g, '%25')
  if (href.length > ITEM_URL_MAX) return { problem: `A link is at most ${ITEM_URL_MAX} characters` }
  if (!ITEM_URL.test(href)) return { problem: "That link can't be used" }
  return { url: href }
}

/** A stored link as the screen shows it (only one the writers would use). */
export function urlOfRow(raw: unknown): string | null {
  return eventUrl(raw)
}

// ── End Repeat ──────────────────────────────────────────────────────────────

/** Why an End Repeat can't be saved for a repeat starting `startsOn`, or null. */
export function repeatEndProblem(end: RepeatEnd | null | undefined, startsOn: string | null | undefined): string | null {
  if (!end) return null
  if ('until' in end) {
    if (!isIsoDay(end.until)) return 'Pick the day it ends'
    if (isIsoDay(startsOn) && end.until < startsOn) return 'The repeat ends before it starts'
    return null
  }
  return repeatCountOf(end.count) === null ? `After 1 to ${MAX_REPEAT_COUNT} times` : null
}

/** The rule's end as stored, for the screen: a count, else a day, else never. */
export function repeatEndOfRow(row: { repeat_until?: string | null; repeat_count?: number | null }): RepeatEnd | null {
  const count = repeatCountOf(row.repeat_count)
  if (count !== null) return { count }
  return isIsoDay(row.repeat_until) ? { until: row.repeat_until } : null
}

/** "Never", "On 31.12.2026", "After 10 times · last 12.01.2027" (the Nth day as the database counts it). */
export function repeatEndLabel(end: RepeatEnd | null | undefined, rule?: RepeatRule): string {
  if (!end) return 'Never'
  if ('until' in end) return isIsoDay(end.until) ? `On ${formatDate(end.until)}` : 'On a day'
  const last = rule ? countEndDay({ ...rule, repeat_count: end.count }) : null
  return `After ${end.count} time${end.count === 1 ? '' : 's'}${last ? ` · last ${formatDate(last)}` : ''}`
}

/** A repeat's end where its days are listed (the day's agenda, Training's week): "last time" on its last day, "until
 *  31.12.2026" before it, null when it never ends (193: the last day it may occur — with a count, the Nth). */
export function repeatEndNote(rule: RepeatRule | null | undefined, day?: string): string | null {
  const last = rule ? repeatLastDay(rule) : null
  if (!last) return null
  return day === last ? 'last time' : `until ${formatDate(last)}`
}

// ── A database without 193 ──────────────────────────────────────────────────

/** Said when a save sent calendar fields to a database that doesn't know them (its answer lacks calendarFields). */
export const CALENDAR_FIELDS_NOT_MIGRATED = 'Saved without its alerts, Show As, link, travel time and End Repeat — migration 193 not applied yet.'

/** Whether the save's input carried any of the fields (then an answer without calendarFields lost them). */
export function sendsCalendarFields(input: Partial<Record<'alerts' | 'showAs' | 'url' | 'travelMinutes' | 'repeatEnd', unknown>>): boolean {
  return ['alerts', 'showAs', 'url', 'travelMinutes', 'repeatEnd'].some(k => k in input)
}
