#!/usr/bin/env node
/*
 * Verification — one item's calendar event (migration 155; Apple Calendar's events are built from it since Google
 * Calendar went, 25.11.2026): src/features/calendar/calendarEventRules.ts, against the REAL un-mocked module via
 * sucrase.
 *   1. Google Calendar's half is gone: no mirror in google-tasks-sync, no PATCH or read-back helpers;
 *   2. "✓ " in the title of a done item, never twice, off again on reopen;
 *   3. a slot's event: all-day (end = the day after), Busy / Free, wall-clock times in a zone, a length crossing
 *      midnight, a nominal end; Show As (193) and the calendar fields' allow-lists.
 *
 *   Run:  node scripts/verify-calendar-event-rules.cjs
 */
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const R = require('../src/features/calendar/calendarEventRules')

const root = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

console.log('\n1 · Google Calendar\'s half is gone (25.11.2026)')
const fn = read('supabase/functions/google-tasks-sync/index.ts')
check('google-tasks-sync carries no calendar rules, outbox drain or read-back',
  !/calendar-event-rules|calendar-outbox-rules|calendar_outbox|google_calendar_sync_state|apply_calendar_readback|googleapis\.com\/calendar/.test(fn))
check('the rules have no Google PATCH, reminders or read-back helper',
  ['eventPatchFor', 'fullEventPatch', 'timePatch', 'withTimePatch', 'doneMarkPatch', 'googleReminders', 'readbackEvent', 'readbackPlan', 'isSyncTokenGone']
    .every(k => !(k in R)))
check('a slot\'s event carries no Google-only field (location, reminders)', (() => {
  const b = R.blockEventBody({ date: '2026-11-12', start_time: '17:00', duration_minutes: 60, title: 'Gym', place: { name: 'Jernbanetorget' }, alerts: [10] }, { done: false, timeZone: 'Europe/Oslo' })
  return !('location' in b) && !('reminders' in b)
})())

console.log('\n2 · "✓ " for a done item')
check('done → "✓ Gym"', R.calendarTitle('Gym', true) === '✓ Gym')
check('open → "Gym"', R.calendarTitle('Gym', false) === 'Gym')
check('never twice', R.calendarTitle('✓ Gym', true) === '✓ Gym' && R.calendarTitle('✓ ✓Gym', true) === '✓ Gym')
check('reopened → off again', R.calendarTitle('✓ Gym', false) === 'Gym')
check('stripDoneMark takes it off', R.stripDoneMark('✓ Lunch with Ola') === 'Lunch with Ola' && R.stripDoneMark('  Plain ') === 'Plain')
check('null title → empty', R.calendarTitle(null, false) === '')

console.log('\n3 · A slot\'s event')
const TZ = 'Europe/Oslo'
const allDay = R.blockEventBody({ date: '2026-10-18', start_time: null, duration_minutes: 60, title: 'Water plants' }, { done: false, timeZone: TZ })
check('no time → all-day: { date } to the day after (DTEND is exclusive)', eq(allDay.start, { date: '2026-10-18' }) && eq(allDay.end, { date: '2026-10-19' }))
check('…and Free', allDay.transparency === 'transparent')
check('…across a month and a year end', eq(R.blockEventBody({ date: '2026-12-31', start_time: null, duration_minutes: 60, title: 'x' }, { done: false, timeZone: TZ }).end, { date: '2027-01-01' }))
const busy = R.blockEventBody({ date: '2026-10-15', start_time: '17:30:00', duration_minutes: 60, title: 'Gym', busy: true }, { done: true, timeZone: TZ })
check('a time with a length → Busy, wall clock in the zone', eq(busy.start, { dateTime: '2026-10-15T17:30:00', timeZone: TZ }) && eq(busy.end, { dateTime: '2026-10-15T18:30:00', timeZone: TZ }) && busy.transparency === 'opaque')
check('…a done item\'s title has "✓ "', busy.summary === '✓ Gym')
const free = R.blockEventBody({ date: '2026-10-15', start_time: '14:00', duration_minutes: R.NOMINAL_EVENT_MINUTES, title: 'Call bank', busy: false }, { done: false, timeZone: TZ })
check('no length → Free, with the nominal 15-minute end', free.transparency === 'transparent' && free.end.dateTime === '2026-10-15T14:15:00' && R.NOMINAL_EVENT_MINUTES === 15)
check('a slot from before 155 (no busy) is Busy', R.blockEventBody({ date: '2026-10-15', start_time: '09:00', duration_minutes: 30, title: 'x' }, { done: false, timeZone: TZ }).transparency === 'opaque')
const late = R.blockEventBody({ date: '2026-10-15', start_time: '23:00', duration_minutes: 120, title: 'Night', busy: true }, { done: false, timeZone: TZ })
check('crossing midnight ends the next day', late.end.dateTime === '2026-10-16T01:00:00')
check('DST day (25.10.2026): wall clock kept, the calendar converts in the zone', R.blockEventBody({ date: '2026-10-25', start_time: '02:30', duration_minutes: 60, title: 'x' }, { done: false, timeZone: TZ }).start.dateTime === '2026-10-25T02:30:00')
check('no zone → Europe/Oslo (the server\'s)', R.blockEventBody({ date: '2026-10-15', start_time: '09:00', duration_minutes: 30, title: 'x' }, { done: false, timeZone: '' }).start.timeZone === 'Europe/Oslo')
check('no usable day → no event', R.blockEventBody({ date: 'soon', start_time: '09:00', duration_minutes: 30, title: 'x' }, { done: false, timeZone: TZ }) === null)
check('a length over a day is capped at 24 h', R.blockEventBody({ date: '2026-10-15', start_time: '09:00', duration_minutes: 5000, title: 'x' }, { done: false, timeZone: TZ }).end.dateTime === '2026-10-16T09:00:00')

console.log('\n3b · Show As and the calendar fields (193)')
{
  const at = (x) => R.blockEventBody({ date: '2026-11-12', start_time: '17:00', duration_minutes: 60, title: 'Gym', busy: true, ...x }, { done: false, timeZone: 'Europe/Oslo' })
  const day = (x) => R.blockEventBody({ date: '2026-11-12', start_time: null, duration_minutes: 60, title: 'Trip', ...x }, { done: false, timeZone: 'Europe/Oslo' })
  check('Show As Free on an item with a length: transparent (the length stays)', at({ show_as: 'free' }).transparency === 'transparent' && at({ show_as: 'free' }).end.dateTime === '2026-11-12T18:00:00')
  check('Show As Busy on an all-day item or one with no length: opaque', day({ show_as: 'busy' }).transparency === 'opaque' && at({ busy: false, show_as: 'busy' }).transparency === 'opaque')
  check('no Show As (every item before 193): Busy with a length, Free without and all day — as before', at({}).transparency === 'opaque'
    && at({ busy: false }).transparency === 'transparent' && day({}).transparency === 'transparent')
  check('a Show As that is no choice reads as not set', at({ show_as: 'BUSY' }).transparency === 'opaque' && at({ busy: false, show_as: 'tentative' }).transparency === 'transparent')
  check('allow-lists: Apple\'s alerts, travel times, a link of at most 2 048 characters', eq(R.ALERT_MINUTES, [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080])
    && eq(R.TRAVEL_MINUTES, [0, 5, 15, 30, 60, 90, 120]) && R.ITEM_URL_MAX === 2048 && R.MAX_ITEM_ALERTS === 2)
  check('eventUrl takes https links only, never a line break, a quote, a space, a user name or an over-long one',
    R.eventUrl('https://example.com/a?b=c#d') === 'https://example.com/a?b=c#d' && R.eventUrl('https://example.com:8443/x%20y') === 'https://example.com:8443/x%20y'
    && [ 'http://example.com', 'https://example.com/\r\nATTENDEE:mailto:x@example.com', 'https://example.com/a b', 'https://example.com/"x"', 'https://user@example.com/',
      'https://example.com@evil.example/', 'javascript:alert(1)', 'https://[::1]/', 'https://example.com/%zz', `https://example.com/${'a'.repeat(2048)}`, 'https://example.com/\\x',
      ' https://example.com', 'https://example.com/<b>', 'HTTPS://example.com', 5, null ].every(u => R.eventUrl(u) === null))
  check('eventTravel: 0 or an allow-listed time, else automatic (null)', R.eventTravel(0) === 0 && R.eventTravel(90) === 90 && [-1, 45, '30', null, undefined, 1e9].every(t => R.eventTravel(t) === null))
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
