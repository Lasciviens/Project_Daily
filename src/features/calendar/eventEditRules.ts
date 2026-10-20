// Editing an event made in Google Calendar itself (the agenda's Google rows,
// EditCalendarEventModal): the form's draft, its problems, the PATCH it sends
// and whether the app may change the event at all. Pure, checked by
// scripts/verify-calendar-event-edit.cjs. Google's side, checked 20.10.2026:
// docs/integrations/google-calendar.md.
//
// Owner, 16.10.2026: "Google calendar, when it's marked as all day it can't be
// edited and there are no options to mark as all day on website". The form
// only knew timed events (an all-day one opened with empty fields), and a
// PATCH never cleared the form it didn't use.
import { addDaysToIso, timePatch, type EventTimePatch } from './calendarEventRules'

export interface EditableEvent {
  start: { date?: string; dateTime?: string; timeZone?: string }
  end: { date?: string; dateTime?: string; timeZone?: string }
  eventType?: string
  organizer?: { email?: string; self?: boolean }
  guestsCanModify?: boolean
  locked?: boolean
}

/** The form: an all-day event's first and LAST day (inclusive — Google's end is the day after), or a start and end. */
export interface EventEditDraft {
  allDay: boolean
  startDate: string
  endDate: string
  startTime: string
  endTime: string
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/

/** An instant's day and clock in a zone: { date: 'YYYY-MM-DD', time: 'HH:MM' }. */
export function zonedParts(iso: string, zone: string): { date: string; time: string } {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map(x => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }
}

/** The form for an event, in the device's zone. A timed event switched to all-day keeps its days; an all-day one gets 09:00–10:00 to start from. */
export function eventEditDraft(e: EditableEvent, zone: string): EventEditDraft {
  if (e.start.date && ISO_DAY.test(e.start.date)) {
    const startDate = e.start.date
    const lastDay = e.end.date && ISO_DAY.test(e.end.date) ? addDaysToIso(e.end.date, -1) : startDate
    return { allDay: true, startDate, endDate: lastDay < startDate ? startDate : lastDay, startTime: '09:00', endTime: '10:00' }
  }
  const s = zonedParts(e.start.dateTime ?? new Date().toISOString(), zone)
  const en = zonedParts(e.end.dateTime ?? e.start.dateTime ?? new Date().toISOString(), zone)
  return { allDay: false, startDate: s.date, endDate: en.date, startTime: s.time, endTime: en.time }
}

/** Why the form can't be saved, or null. */
export function eventEditProblem(d: EventEditDraft): string | null {
  if (!ISO_DAY.test(d.startDate) || !ISO_DAY.test(d.endDate)) return 'Pick the days'
  if (d.allDay) return d.endDate < d.startDate ? 'The last day is before the first' : null
  if (!CLOCK.test(d.startTime) || !CLOCK.test(d.endTime)) return 'Pick the times'
  return `${d.endDate}T${d.endTime}` <= `${d.startDate}T${d.startTime}` ? 'It ends before it starts' : null
}

/** The start and end a save PATCHes: the form not used goes as null (calendarEventRules.timePatch). */
export function eventEditTimes(d: EventEditDraft, zone: string): { start: EventTimePatch; end: EventTimePatch } {
  if (d.allDay) {
    return { start: timePatch({ date: d.startDate }), end: timePatch({ date: addDaysToIso(d.endDate, 1) }) }
  }
  return {
    start: timePatch({ dateTime: `${d.startDate}T${d.startTime}:00`, timeZone: zone }),
    end: timePatch({ dateTime: `${d.endDate}T${d.endTime}:00`, timeZone: zone }),
  }
}

/** Whether the times changed (a title-only save sends no start or end). */
export function eventTimesChanged(before: EventEditDraft, after: EventEditDraft): boolean {
  if (before.allDay !== after.allDay || before.startDate !== after.startDate || before.endDate !== after.endDate) return true
  return !after.allDay && (before.startTime !== after.startTime || before.endTime !== after.endTime)
}

export interface EventAccess {
  /** The title, description and times can be changed here. */
  canEdit: boolean
  /** Some event types can't be all-day (Google: out-of-office and focus time). */
  allDayAllowed: boolean
  /** Why it can't be changed here (it can be in Google Calendar, where allowed). */
  reason: string | null
}

/**
 * What the app may change. Google: a reader of a calendar can't write it
 * (calendarList `accessRole`: freeBusyReader / reader); "only the organizer"
 * changes shared fields unless `guestsCanModify`; a `locked` copy allows no
 * change to "summary, description, location, start, end"; `eventType` "cannot
 * be modified" and birthday / fromGmail / working-location events have rules
 * of their own — those open in Google Calendar instead.
 */
export function eventEditAccess(e: EditableEvent, accessRole: string | null | undefined): EventAccess {
  const none = (reason: string): EventAccess => ({ canEdit: false, allDayAllowed: false, reason })
  if (accessRole === 'reader' || accessRole === 'freeBusyReader') return none('It is on a calendar you can only view.')
  if (e.eventType === 'birthday') return none('A birthday comes from your contacts.')
  if (e.eventType === 'fromGmail') return none('It was added from Gmail.')
  if (e.eventType === 'workingLocation') return none('It is a working location.')
  if (e.locked) return none('Its organizer has locked it.')
  if (e.organizer && e.organizer.self === false && !e.guestsCanModify) return none('You are a guest: only its organizer can change it.')
  return { canEdit: true, allDayAllowed: e.eventType !== 'outOfOffice' && e.eventType !== 'focusTime', reason: null }
}
