// Checks editing an event made in Google Calendar itself
// (src/features/calendar/eventEditRules.ts): the form for an all-day and a
// timed event, its problems, the PATCH it sends (the unused date form as
// null) and who may change it (docs/integrations/google-calendar.md).
//   node scripts/verify-calendar-event-edit.cjs
require('sucrase/register')
const assert = require('assert')
const E = require('../src/features/calendar/eventEditRules.ts')

let n = 0
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++ }
const Z = 'Europe/Oslo'

// ── The form ──
eq(E.eventEditDraft({ start: { date: '2026-10-21' }, end: { date: '2026-10-22' } }, Z),
  { allDay: true, startDate: '2026-10-21', endDate: '2026-10-21', startTime: '09:00', endTime: '10:00' },
  'a one-day all-day event: first and last day the same (Google\'s end is the day after)')
eq(E.eventEditDraft({ start: { date: '2026-10-21' }, end: { date: '2026-10-24' } }, Z).endDate, '2026-10-23', 'three days: the last day is shown, not Google\'s exclusive end')
eq(E.eventEditDraft({ start: { dateTime: '2026-10-21T16:45:00Z' }, end: { dateTime: '2026-10-21T18:45:00Z' } }, Z),
  { allDay: false, startDate: '2026-10-21', endDate: '2026-10-21', startTime: '18:45', endTime: '20:45' }, 'a timed event in the device\'s zone')
eq(E.eventEditDraft({ start: { dateTime: '2026-10-21T22:30:00Z' }, end: { dateTime: '2026-10-21T23:30:00Z' } }, Z).startDate, '2026-10-22', 'after midnight in Oslo is the next day')

// ── Problems ──
const d = { allDay: false, startDate: '2026-10-21', endDate: '2026-10-21', startTime: '18:45', endTime: '20:45' }
eq(E.eventEditProblem(d), null, 'a good timed event')
eq(E.eventEditProblem({ ...d, endTime: '18:00' }), 'It ends before it starts', 'an end before the start')
eq(E.eventEditProblem({ ...d, endTime: '18:45' }), 'It ends before it starts', 'no length is refused too (Google: timeRangeEmpty)')
eq(E.eventEditProblem({ ...d, endDate: '2026-10-22', endTime: '01:00' }), null, 'across midnight is fine')
eq(E.eventEditProblem({ ...d, allDay: true, endDate: '2026-10-20' }), 'The last day is before the first', 'all-day: the last day before the first')
eq(E.eventEditProblem({ ...d, allDay: true, endTime: 'xx' }), null, 'all-day ignores the times')
eq(E.eventEditProblem({ ...d, startDate: '' }), 'Pick the days', 'no day')

// ── The PATCH ──
eq(E.eventEditTimes({ ...d, allDay: true, endDate: '2026-10-23' }, Z), {
  start: { date: '2026-10-21', dateTime: null, timeZone: null },
  end: { date: '2026-10-24', dateTime: null, timeZone: null },
}, 'all-day: dates (end = the day after the last), dateTime and timeZone null — a timed event turned all-day')
eq(E.eventEditTimes(d, Z), {
  start: { dateTime: '2026-10-21T18:45:00', timeZone: Z, date: null },
  end: { dateTime: '2026-10-21T20:45:00', timeZone: Z, date: null },
}, 'timed: wall clock + zone, date null — an all-day event given a time')
eq(E.eventTimesChanged(d, { ...d }), false, 'nothing changed: a title-only save sends no times')
eq(E.eventTimesChanged(d, { ...d, allDay: true }), true, 'switched to all-day')
eq(E.eventTimesChanged({ ...d, allDay: true }, { ...d, allDay: true, startTime: '07:00' }), false, 'an all-day event\'s hidden times don\'t count')

// ── Who may change it ──
const own = { start: {}, end: {}, organizer: { self: true } }
eq(E.eventEditAccess(own, 'owner'), { canEdit: true, allDayAllowed: true, reason: null }, 'your own event')
eq(E.eventEditAccess({ start: {}, end: {} }, undefined).canEdit, true, 'no organizer or role known: editable (Google says no when it isn\'t)')
eq(E.eventEditAccess(own, 'reader').canEdit, false, 'a calendar you can only view (holidays)')
eq(E.eventEditAccess(own, 'freeBusyReader').canEdit, false, 'free/busy only')
eq(E.eventEditAccess({ ...own, eventType: 'birthday' }, 'owner').canEdit, false, 'a birthday')
eq(E.eventEditAccess({ ...own, eventType: 'fromGmail' }, 'owner').canEdit, false, 'from Gmail')
eq(E.eventEditAccess({ ...own, locked: true }, 'owner').canEdit, false, 'a locked copy')
eq(E.eventEditAccess({ start: {}, end: {}, organizer: { self: false } }, 'owner').canEdit, false, 'an invitation: only the organizer changes it')
eq(E.eventEditAccess({ start: {}, end: {}, organizer: { self: false }, guestsCanModify: true }, 'owner').canEdit, true, '…unless guests may')
eq(E.eventEditAccess({ ...own, eventType: 'outOfOffice' }, 'owner'), { canEdit: true, allDayAllowed: false, reason: null }, 'out of office: editable, never all-day')

console.log(`verify-calendar-event-edit: ${n} checks passed`)
