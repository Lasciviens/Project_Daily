#!/usr/bin/env node
/*
 * Verification — the app's events in Apple Calendar (Phase 2b-1,
 * src/features/calendar/areas/icloudEvents.ts, run by icloud-calendar's
 * `drain`): which area an item goes to, that an item wants a calendar only by
 * its Google choice, and the iCalendar object — Google's own event rules
 * (blockEventBody, seriesEventFor) plus the area's emoji and alert and a link
 * back. Plus: the function's generated copy is current, and the drain only
 * ever writes into the app's own area calendars, the new copy before the old.
 *
 *   Run:  node scripts/verify-icloud-events.cjs
 */
process.env.TZ = 'Europe/Oslo'
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
require('sucrase/register')
const E = require('../src/features/calendar/areas/icloudEvents')
const { DEFAULT_AREAS } = require('../src/features/calendar/areas/calendarAreas')

let passed = 0, failed = 0
function eq(got, want, name) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name} — got ${g}, want ${w}`) }
}
const unfold = ics => ics.replace(/\r\n[ \t]/g, '')
// A property of the event itself (not of the time zone block before it).
const line = (ics, name) => { const u = unfold(ics); return u.slice(u.indexOf('BEGIN:VEVENT')).split('\r\n').find(l => l.startsWith(name)) ?? null }

console.log('\n== The area ==')
eq([
  E.itemArea({ category: 'football', source_type: 'training_session' }),
  E.itemArea({ category: 'daily', task_source_type: 'training_session' }),
  E.itemArea({ hevy_routine_id: 'r1' }),
  E.itemArea({ source_type: 'tv_episode' }),
  E.itemArea({ domain: 'media' }),
  E.itemArea({ category: 'projects' }),
  E.itemArea({ project_id: 'p1', domain: 'personal' }),
  E.itemArea({ domain: 'work' }),
  E.itemArea({ category: 'daily', domain: 'personal', source_type: null }),
  E.itemArea({}),
], ['football', 'training', 'training', 'media', 'media', 'work', 'work', 'work', 'personal', 'personal'],
  'football → training → media → work (with projects) → personal')
eq([E.wantsCalendar('calendar', false), E.wantsCalendar('both', false), E.wantsCalendar('tasks', true), E.wantsCalendar('none', true), E.wantsCalendar(null, true), E.wantsCalendar(null, false)],
  [true, true, false, false, true, false], "an item wants a calendar by its Google choice; an old row (no choice saved) where it is now")

console.log('\n== A slot ==')
const now = new Date('2026-10-30T10:00:00Z')
const base = { timeZone: 'Europe/Oslo', appUrl: 'https://lasciviens.github.io/Project_Daily/#/daily', now }
const gym = E.slotEvent({ id: 'b1', date: '2026-11-02', start_time: '17:30:00', duration_minutes: 60, title: 'Lower B', busy: true, notes: 'Squat, RDL; leg press' },
  { ...base, done: false, area: DEFAULT_AREAS.training })
// An iCalendar uid has an address shape; the public scan for email addresses would read it as one, so it is checked in parts.
const uidParts = uid => [uid.split('@')[0], uid.split('@')[1]]
eq(uidParts(gym.uid), ['lasci-slot-b1', 'lasciviens.github.io'], 'the uid names the slot (on the app\'s own site), so a move or rename replaces its event')
eq(E.eventFileName(gym.uid), 'lasci-slot-b1.ics', 'and its file in the area calendar')
eq([line(gym.ics, 'DTSTART'), line(gym.ics, 'DTEND'), line(gym.ics, 'TRANSP')],
  ['DTSTART;TZID=Europe/Oslo:20261102T173000', 'DTEND;TZID=Europe/Oslo:20261102T183000', 'TRANSP:OPAQUE'], "Google's rules: wall-clock time in Oslo, an hour, busy")
eq(gym.ics.includes('BEGIN:VTIMEZONE') && gym.ics.includes('TZID:Europe/Oslo'), true, 'the Oslo time zone travels with the event')
eq(line(gym.ics, 'SUMMARY'), 'SUMMARY:🏋️ Lower B', "the area's emoji in front of the title")
eq([line(gym.ics, 'TRIGGER'), line(gym.ics, 'ACTION')], ['TRIGGER:-PT60M', 'ACTION:DISPLAY'], "the area's alert: Training 60 min before")
eq(line(gym.ics, 'DESCRIPTION'), "DESCRIPTION:Squat\\, RDL\\; leg press\\n\\nOpen in Lasci's Board: https://lasciviens.github.io/Project_Daily/#/daily?date=2026-11-02",
  'notes escaped, with a link back to the day')
eq(line(gym.ics, 'URL'), 'URL;VALUE=URI:https://lasciviens.github.io/Project_Daily/#/daily?date=2026-11-02', "and the same link in Apple's URL field")
const done = E.slotEvent({ id: 'b1', date: '2026-11-02', start_time: '17:30', duration_minutes: 60, title: 'Lower B', busy: true },
  { ...base, done: true, area: DEFAULT_AREAS.training })
eq(line(done.ics, 'SUMMARY'), 'SUMMARY:✓ 🏋️ Lower B', "done: Google's ✓ first, then the emoji")
const allDay = E.slotEvent({ id: 'b2', date: '2026-11-03', start_time: null, duration_minutes: 60, title: 'Pay rent æøå', busy: true },
  { ...base, done: false, area: DEFAULT_AREAS.work })
eq([line(allDay.ics, 'DTSTART'), line(allDay.ics, 'DTEND'), line(allDay.ics, 'TRANSP'), allDay.ics.includes('VALARM'), allDay.ics.includes('VTIMEZONE')],
  ['DTSTART;VALUE=DATE:20261103', 'DTEND;VALUE=DATE:20261104', 'TRANSP:TRANSPARENT', false, false], 'no time: all day, free, no alert (an alert before midnight helps no one), no zone')
eq(line(allDay.ics, 'SUMMARY'), 'SUMMARY:💼 Pay rent æøå', 'æøå kept')
const free = E.slotEvent({ id: 'b3', date: '2026-11-03', start_time: '14:00', duration_minutes: 0, title: 'Call', busy: false },
  { ...base, done: false, area: { ...DEFAULT_AREAS.personal, emoji: '', alertMinutes: 0 } })
eq([line(free.ics, 'DTEND'), line(free.ics, 'TRANSP'), line(free.ics, 'SUMMARY'), line(free.ics, 'TRIGGER')],
  ['DTEND;TZID=Europe/Oslo:20261103T141500', 'TRANSP:TRANSPARENT', 'SUMMARY:Call', 'TRIGGER:PT0S'], 'no length: free with a nominal end; no emoji; an alert at the start')
eq(E.slotEvent({ id: 'b4', date: 'not a day', start_time: null, duration_minutes: 60, title: 'x' }, { ...base, done: false, area: DEFAULT_AREAS.personal }), null, 'a slot with no usable day has no event')
const long = E.slotEvent({ id: 'b5', date: '2026-11-03', start_time: '09:00', duration_minutes: 30, title: 'Ø'.repeat(80), busy: true }, { ...base, done: false, area: DEFAULT_AREAS.personal })
eq(long.ics.split('\r\n').every(l => Buffer.byteLength(l, 'utf8') <= 75) && unfold(long.ics).includes('Ø'.repeat(80)), true, 'lines folded at 75 octets, never inside a letter')
eq(long.ics.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n') && !/[^\r]\n/.test(long.ics), true, 'CRLF throughout')

console.log('\n== A repeating plan ==')
const weekly = { id: 'p1', title: 'Gym', start_time: '07:00:00', end_time: '08:00:00', busy: true, days_of_week: [1, 3], repeat_kind: 'weekly',
  effective_from: '2026-10-01', except_dates: ['2026-11-04'], notes: null, icloud_from: null }
const pe = E.planEvent(weekly, { ...base, area: DEFAULT_AREAS.training, today: '2026-10-30' })
eq([uidParts(pe.uid)[0], line(pe.ics, 'DTSTART'), line(pe.ics, 'RRULE'), line(pe.ics, 'EXDATE')],
  ['lasci-plan-p1', 'DTSTART;TZID=Europe/Oslo:20261102T070000', 'RRULE:FREQ=WEEKLY;WKST=MO;BYDAY=MO,WE', 'EXDATE;TZID=Europe/Oslo:20261104T070000'],
  "ONE series from the first day on or after the day it reached Apple Calendar (today), Google's RRULE and EXDATE")
eq([pe.plan.from, line(pe.ics, 'SUMMARY'), line(pe.ics, 'TRIGGER')], ['2026-10-30', 'SUMMARY:🏋️ Gym', 'TRIGGER:-PT60M'], 'its start day is stored (icloud_from); emoji and alert as a slot')
const kept = E.planEvent({ ...weekly, icloud_from: '2026-10-05' }, { ...base, area: DEFAULT_AREAS.training, today: '2026-10-30' })
eq(line(kept.ics, 'DTSTART'), 'DTSTART;TZID=Europe/Oslo:20261005T070000', 'a series keeps the start day it was given (never moved by a later push)')
const allDayPlan = E.planEvent({ ...weekly, id: 'p2', start_time: null, end_time: null, except_dates: [] }, { ...base, area: DEFAULT_AREAS.personal, today: '2026-10-30' })
eq([line(allDayPlan.ics, 'DTSTART'), allDayPlan.ics.includes('VALARM')], ['DTSTART;VALUE=DATE:20261102', false], 'a repeat with no time is an all-day series, no alert')
eq(E.planEvent({ ...weekly, days_of_week: [] }, { ...base, area: DEFAULT_AREAS.training, today: '2026-10-30' }), null, 'a repeat with no day left has no event')

console.log('\n== The function ==')
try { execFileSync('node', [path.join(__dirname, 'sync-icloud-shared.mjs'), '--check'], { stdio: 'pipe' }); eq(true, true, "the function's copy of the event rules is current (sync-icloud-shared)") }
catch { eq(false, true, "the function's copy of the event rules is current — run node scripts/sync-icloud-shared.mjs") }
const src = fs.readFileSync(path.join(__dirname, '../supabase/functions/icloud-calendar/index.ts'), 'utf8')
const drainOne = src.slice(src.indexOf('async function drainOne'), src.indexOf('function osloTomorrow'))
const drain = src.slice(src.indexOf("if (action === 'drain')"), src.indexOf("if (action === 'remove')"))
eq(/conf\.enabled && conf\.app === 'apple' && calUrl/.test(drainOne) && /wantsCalendar\(/.test(drainOne), true, 'an event is put only when the item wants a calendar and its area is on, on Apple, and made')
eq(/putEvent\([^)]*\)\n\s*if \(b\.icloud_href && b\.icloud_href !== href\) await removeEvent/.test(drainOne) && /putEvent\([^)]*\)\n\s*if \(p\.icloud_href && p\.icloud_href !== href\) await removeEvent/.test(drainOne), true,
  'the new copy first, then the old one (an area change)')
eq(/function removeEvent[\s\S]{0,200}inAreaCalendars\(href, areaUrls\)/.test(src) && /areaUrls\.some\(u => href\.startsWith\(u\)\)/.test(src), true, "it only ever removes from the app's own area calendars")
eq(/\.delete\(\)\.eq\('id', q\.id\)\.eq\('requested_at', q\.requested_at\)/.test(drain), true, 'a queue row goes only while requested_at is what was read (a newer change waits)')
eq(!/console\.(log|error|warn)\([^)]*(title|summary|notes|ics)/i.test(src), true, 'no title, note or event text is ever logged')
eq(/\.eq\('user_id', userId\)/.test(drainOne) && !/'PROPPATCH'|'MKCALENDAR'/.test(drainOne), true, "the live rows are read as the caller's own; the drain never makes or changes a calendar")

console.log(`\nverify-icloud-events: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
