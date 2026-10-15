#!/usr/bin/env node
/*
 * Verification — one item's Google Calendar event and the Calendar read-back
 * (migration 155): src/features/calendar/calendarEventRules.ts, against the
 * REAL un-mocked module via sucrase, plus static checks on the files that
 * must agree with it.
 *   1. the hand mirror in supabase/functions/google-tasks-sync/index.ts is
 *      identical to the src file;
 *   2. "✓ " in the title of a done item, never twice, off again on reopen;
 *   3. a slot's event: all-day (end = the day after), Busy / Free, wall-clock
 *      times in a zone, a length crossing midnight, a nominal end;
 *   4. a Google event read back: wall clock in its zone (offsets, DST),
 *      length, all-day, Free, a cancelled instance's day, no "✓ ";
 *   5. the sync-token plan: a baseline with timeMin, then syncToken with no
 *      timeMin / timeMax / updatedMin / showDeleted, 410 = start over;
 *   6. google-tasks-sync's read-back: only stored ids, the token moves only
 *      when every change was applied, 410 → a new baseline.
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

const RULES_FILE = 'src/features/calendar/calendarEventRules.ts'
const FUNCTION_FILE = 'supabase/functions/google-tasks-sync/index.ts'
const START = '// <calendar-event-rules>'
const END = '// </calendar-event-rules>'
const block = (s) => { const a = s.indexOf(START); const b = s.indexOf(END); return a >= 0 && b > a ? s.slice(a, b) : null }
const fn = read(FUNCTION_FILE)

console.log('\n1 · The edge function carries the same rules')
check('both files have the <calendar-event-rules> block', !!block(read(RULES_FILE)) && !!block(fn))
check('google-tasks-sync mirror is identical to calendarEventRules.ts', block(read(RULES_FILE)) === block(fn), 'copy the block from the src file into the function')
check('the function has exactly one block', fn.split(START).length === 2)

console.log('\n2 · "✓ " for a done item')
check('done → "✓ Gym"', R.calendarTitle('Gym', true) === '✓ Gym')
check('open → "Gym"', R.calendarTitle('Gym', false) === 'Gym')
check('never twice', R.calendarTitle('✓ Gym', true) === '✓ Gym' && R.calendarTitle('✓ ✓Gym', true) === '✓ Gym')
check('reopened → off again', R.calendarTitle('✓ Gym', false) === 'Gym')
check('the read-back strips it', R.stripDoneMark('✓ Lunch with Ola') === 'Lunch with Ola' && R.stripDoneMark('  Plain ') === 'Plain')
check('null title → empty', R.calendarTitle(null, false) === '')

console.log('\n3 · A slot\'s event')
const TZ = 'Europe/Oslo'
const allDay = R.blockEventBody({ date: '2026-10-18', start_time: null, duration_minutes: 60, title: 'Water plants' }, { done: false, timeZone: TZ })
check('no time → all-day: { date } to the day after (Google\'s end is exclusive)', eq(allDay.start, { date: '2026-10-18' }) && eq(allDay.end, { date: '2026-10-19' }))
check('…and Free', allDay.transparency === 'transparent')
check('…across a month and a year end', eq(R.blockEventBody({ date: '2026-12-31', start_time: null, duration_minutes: 60, title: 'x' }, { done: false, timeZone: TZ }).end, { date: '2027-01-01' }))
const busy = R.blockEventBody({ date: '2026-10-15', start_time: '17:30:00', duration_minutes: 60, title: 'Gym', busy: true }, { done: true, timeZone: TZ })
check('a time with a length → Busy, wall clock in the zone', eq(busy.start, { dateTime: '2026-10-15T17:30:00', timeZone: TZ }) && eq(busy.end, { dateTime: '2026-10-15T18:30:00', timeZone: TZ }) && busy.transparency === 'opaque')
check('…a done item\'s title has "✓ "', busy.summary === '✓ Gym')
const free = R.blockEventBody({ date: '2026-10-15', start_time: '14:00', duration_minutes: R.NOMINAL_EVENT_MINUTES, title: 'Call bank', busy: false }, { done: false, timeZone: TZ })
check('no length → Free, with the nominal 15-minute end (a zero-length event risks timeRangeEmpty)', free.transparency === 'transparent' && free.end.dateTime === '2026-10-15T14:15:00' && R.NOMINAL_EVENT_MINUTES === 15)
check('a slot from before 155 (no busy) is Busy', R.blockEventBody({ date: '2026-10-15', start_time: '09:00', duration_minutes: 30, title: 'x' }, { done: false, timeZone: TZ }).transparency === 'opaque')
const late = R.blockEventBody({ date: '2026-10-15', start_time: '23:00', duration_minutes: 120, title: 'Night', busy: true }, { done: false, timeZone: TZ })
check('crossing midnight ends the next day', late.end.dateTime === '2026-10-16T01:00:00')
check('DST day (25.10.2026): wall clock kept, Google converts in the zone', R.blockEventBody({ date: '2026-10-25', start_time: '02:30', duration_minutes: 60, title: 'x' }, { done: false, timeZone: TZ }).start.dateTime === '2026-10-25T02:30:00')
check('no zone → Europe/Oslo (the server\'s)', R.blockEventBody({ date: '2026-10-15', start_time: '09:00', duration_minutes: 30, title: 'x' }, { done: false, timeZone: '' }).start.timeZone === 'Europe/Oslo')
check('no usable day → no event', R.blockEventBody({ date: 'soon', start_time: '09:00', duration_minutes: 30, title: 'x' }, { done: false, timeZone: TZ }) === null)
check('a length over a day is capped at 24 h', R.blockEventBody({ date: '2026-10-15', start_time: '09:00', duration_minutes: 5000, title: 'x' }, { done: false, timeZone: TZ }).end.dateTime === '2026-10-16T09:00:00')

console.log('\n4 · A Google event read back')
const moved = R.readbackEvent({ id: 'evLunch', status: 'confirmed', summary: '✓ Lunch', start: { dateTime: '2026-10-23T10:30:00Z', timeZone: 'Europe/Oslo' }, end: { dateTime: '2026-10-23T12:00:00Z' }, updated: '2026-10-15T09:00:00.000Z' }, 'Europe/Oslo')
check('a UTC instant reads as the event zone\'s wall clock (12:30 in Oslo, summer time)', moved.date === '2026-10-23' && moved.time === '12:30:00', JSON.stringify(moved))
check('…its length from the two instants (90 min), Busy by default, no "✓ "', moved.minutes === 90 && moved.busy && moved.title === 'Lunch' && !moved.allDay)
check('…its updated time kept (the stale check)', moved.updated === '2026-10-15T09:00:00.000Z')
const winter = R.readbackEvent({ id: 'w', start: { dateTime: '2026-11-02T08:00:00+01:00' }, end: { dateTime: '2026-11-02T09:00:00+01:00' } }, 'Europe/Oslo')
check('an offset date-time in winter (no event zone → the calendar\'s)', winter.date === '2026-11-02' && winter.time === '08:00:00' && winter.minutes === 60)
const otherZone = R.readbackEvent({ id: 'ny', start: { dateTime: '2026-10-23T18:00:00-04:00', timeZone: 'America/New_York' }, end: { dateTime: '2026-10-23T19:00:00-04:00' } }, 'Europe/Oslo')
check('an event in another zone reads in ITS zone', otherZone.time === '18:00:00' && otherZone.date === '2026-10-23')
const ad = R.readbackEvent({ id: 'ad', summary: 'Pack', start: { date: '2026-10-24' }, end: { date: '2026-10-25' }, transparency: 'transparent' }, 'Europe/Oslo')
check('all-day: the date, no time, Free', ad.allDay && ad.date === '2026-10-24' && ad.time === null && !ad.busy && ad.minutes === 1440)
const freeEv = R.readbackEvent({ id: 'f', start: { dateTime: '2026-10-23T14:00:00+02:00' }, end: { dateTime: '2026-10-23T14:15:00+02:00' }, transparency: 'transparent' }, 'Europe/Oslo')
check('transparent → busy false', freeEv.busy === false && freeEv.minutes === 15)
const gone = R.readbackEvent({ id: 'evP1_20261028T153000Z', status: 'cancelled', recurringEventId: 'evP1', originalStartTime: { dateTime: '2026-10-28T15:30:00Z', timeZone: 'Europe/Oslo' } }, 'Europe/Oslo')
check('a cancelled instance: its series and its day (only id, recurringEventId, originalStartTime are promised)',
  gone.status === 'cancelled' && gone.seriesId === 'evP1' && gone.originalDate === '2026-10-28' && gone.title === null)
check('a cancelled one-off has only its id', eq(R.readbackEvent({ id: 'x', status: 'cancelled' }, TZ).seriesId, null))
const late2 = R.readbackEvent({ id: 'l', start: { dateTime: '2026-10-23T22:30:00Z' }, end: { dateTime: '2026-10-23T23:30:00Z' } }, 'Europe/Oslo')
check('late UTC is the next day in Oslo', late2.date === '2026-10-24' && late2.time === '00:30:00')
const adInstance = R.readbackEvent({ id: 's_20261025', recurringEventId: 's', originalStartTime: { date: '2026-10-25' }, start: { date: '2026-10-26' }, end: { date: '2026-10-27' } }, TZ)
check('an all-day series\' moved day: originalStartTime.date', adInstance.originalDate === '2026-10-25' && adInstance.date === '2026-10-26')
check('no id → nothing', R.readbackEvent({ status: 'confirmed' }, TZ) === null)

console.log('\n5 · The sync-token plan')
check('no token → a baseline', eq(R.readbackPlan(null), { mode: 'baseline' }) && eq(R.readbackPlan({ sync_token: '' }), { mode: 'baseline' }))
check('a token → incremental', eq(R.readbackPlan({ sync_token: 'tok' }), { mode: 'incremental', syncToken: 'tok' }))
const now = Date.parse('2026-10-15T12:00:00Z')
const base = R.readbackListParams({ mode: 'baseline' }, now)
check('the baseline reads from 7 days back, 2500 a page', base.timeMin === '2026-10-08T12:00:00.000Z' && base.maxResults === '2500' && !('syncToken' in base))
const inc = R.readbackListParams({ mode: 'incremental', syncToken: 'tok' }, now, 'page2')
check('incremental: syncToken + pageToken, none of timeMin/timeMax/updatedMin/orderBy/q (Google: 400 with a syncToken)',
  inc.syncToken === 'tok' && inc.pageToken === 'page2' && !['timeMin', 'timeMax', 'updatedMin', 'orderBy', 'q'].some(k => k in inc))
check('showDeleted is never sent (it may not be false with a syncToken; the same set both times)', !('showDeleted' in inc) && !('showDeleted' in base))
check('singleEvents is never sent (a series comes once; a moved day as its own exception)', !('singleEvents' in inc) && !('singleEvents' in base))
check('410 = the token is gone; 404 / 500 are not', R.isSyncTokenGone(410) && !R.isSyncTokenGone(404) && !R.isSyncTokenGone(500) && !R.isSyncTokenGone(null))

console.log('\n6 · google-tasks-sync\'s read-back')
const rb = fn.slice(fn.indexOf('async function readCalendarChanges('), fn.indexOf('// ── Handler ──'))
check('it runs after the calendar outbox', /readback = await readCalendarChanges\(access_token, userId\)/.test(fn) && fn.indexOf('readCalendarChanges(access_token') > fn.indexOf('drainCalendarOutbox(access_token'))
check('it reads only the primary calendar', /\/calendars\/primary\/events\?/.test(fn))
check('410 → a new baseline in the same run (once)', /isSyncTokenGone\(res\.status\) && plan\.mode === 'incremental' && !reset/.test(rb) && /plan = \{ mode: 'baseline' \}/.test(rb))
check('a baseline applies nothing (only incremental items are kept)', /if \(plan\.mode === 'incremental'\) items\.push/.test(rb))
check('only events a slot or plan of this account stores are applied',
  /from\('time_blocks'\)\.select\('google_calendar_event_id'\)\.eq\('user_id', userId\)\.in\('google_calendar_event_id', chunk\)/.test(rb)
  && /from\('schedule_blocks'\)\.select\('google_calendar_event_id'\)\.eq\('user_id', userId\)\.in\('google_calendar_event_id', chunk\)/.test(rb)
  && /if \(!ours\.has\(c\.id\) && !\(c\.seriesId && ours\.has\(c\.seriesId\)\)\) continue/.test(rb))
check('each change goes through apply_calendar_readback with this user', /rpc\('apply_calendar_readback', \{ p_user: userId, p_event: c \}\)/.test(rb))
check('the token moves only when every change was applied', /if \(failures\) \{[\s\S]*?return summary\s*\}\s*await record\(\{\s*sync_token: nextSyncToken/.test(rb))
check('no token on the last page → said, nothing moves', /if \(!nextSyncToken\) \{/.test(rb))
check('a missing state table (before 155) is skipped quietly', /isMissingTableError\(stateError\)\) return \{ \.\.\.summary, skipped: 'not_migrated' \}/.test(rb))
check('the read-back state is written for the user only (service role, upsert on user_id)', /from\('google_calendar_sync_state'\)\s*\.upsert\(\{ user_id: userId/.test(rb))
check('its trouble is reported (last_error) under "Calendar changes"', /readback: 'Calendar changes'/.test(fn) && /reported\.readback = readbackProblem/.test(fn))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
