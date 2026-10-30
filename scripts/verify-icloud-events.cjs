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

console.log('\n== Hostile text (security review, 30.10.2026) ==')
eq(E.icsEscape('Lunch\rATTENDEE;RSVP=TRUE:mailto:ola@example.com\u0007'), 'Lunch\\nATTENDEE\\;RSVP=TRUE:mailto:ola@example.com', 'a lone CR becomes an escaped line break; other control characters are dropped')
const sneaky = E.slotEvent({ id: 'b6', date: '2026-11-03', start_time: '09:00', duration_minutes: 30, title: 'Lunch\rATTENDEE:mailto:ola@example.com', busy: true, notes: 'a\r\nb\nc' },
  { ...base, done: false, area: { ...DEFAULT_AREAS.personal, emoji: '🏠\r' } })
eq(unfold(sneaky.ics).split('\r\n').filter(l => /^ATTENDEE/.test(l)).length, 0, 'a title, note or emoji with line breaks never adds a property')
let guarded = false
try { E.eventObject({ uid: 'x', body: { summary: 'x', start: { date: '2026-11-03' }, end: { date: '2026-11-04' }, transparency: 'transparent', recurrence: ['RRULE:FREQ=DAILY\r\nATTENDEE:mailto:ola@example.com'] }, area: DEFAULT_AREAS.personal, notes: null, link: 'https://example.com', now }) } catch { guarded = true }
eq(guarded, true, 'the last guard refuses any event line that still holds a control character')
const { seriesTimeZone, seriesPushZone } = require('../src/features/calendar/calendarSeries')
eq([seriesTimeZone('America/New_York'), seriesTimeZone('Etc/GMT+1'), seriesTimeZone('Europe/Oslo:20261102T070000\r\nATTENDEE:mailto:x@example.com'), seriesTimeZone('Not/AZone'), seriesTimeZone(null)],
  ['America/New_York', 'Etc/GMT+1', 'Europe/Oslo', 'Europe/Oslo', 'Europe/Oslo'], 'a stored zone is used only when it is a real zone name (never text that lands in TZID=)')
eq(seriesPushZone('Europe/Oslo\r\nX:1', 'Europe/Oslo', false), 'Europe/Oslo', 'the stored zone of a background push goes through the same check (Google too)')

console.log('\n== The function ==')
try { execFileSync('node', [path.join(__dirname, 'sync-icloud-shared.mjs'), '--check'], { stdio: 'pipe' }); eq(true, true, "the function's copy of the event rules is current (sync-icloud-shared)") }
catch { eq(false, true, "the function's copy of the event rules is current — run node scripts/sync-icloud-shared.mjs") }
const src = fs.readFileSync(path.join(__dirname, '../supabase/functions/icloud-calendar/index.ts'), 'utf8')
const { transform } = require('sucrase')
const pure = src.slice(src.indexOf('// <icloud-pure>'), src.indexOf('// </icloud-pure>'))
const F = new Function(`${transform(pure.replace(/^export /gm, ''), { transforms: ['typescript'] }).code}\nreturn { ownEventUrl }`)()
const cals = { work: { url: 'https://p67-caldav.icloud.com:443/123/calendars/lasci-work/' }, media: { url: 'https://evil.example/lasci-media/' } }
const id = '2c5e1b9a-4d0f-4a3b-9e7c-1f2a3b4c5d6e'
eq(F.ownEventUrl('slot', id, 'work', cals), `https://p67-caldav.icloud.com/123/calendars/lasci-work/lasci-slot-${id}.ics`, "an event's address is its own file in the area calendar the app made")
eq([F.ownEventUrl('slot', '../../work/x', 'work', cals), F.ownEventUrl('slot', id, '../work', cals), F.ownEventUrl('slot', id, 'personal', cals), F.ownEventUrl('plan', id, 'media', cals)],
  [null, null, null, null], 'never from a stored address: a forged id or area, an area with no calendar, or one outside iCloud gives no address at all')
const drainOne = src.slice(src.indexOf('async function drainOne'), src.indexOf('function osloTomorrow'))
const drain = src.slice(src.indexOf("if (action === 'drain')"), src.indexOf("if (action === 'remove')"))
eq(!/icloud_href|\.href\b/.test(drainOne) && /ownEventUrl\(/.test(drainOne), true, 'the drain stores and trusts only the area key, never an address')
eq((drainOne.match(/if \(wanted && conf\.enabled && conf\.app === 'apple'\) \{\n\s*const url = ownEventUrl\([^)]*\)\n\s*if \(!url\) throw new ICloudError\('calendars', NO_AREA_CALENDAR\)/g) || []).length, 2,
  'an event is put only when the item wants a calendar and its area is on and on Apple; a missing area calendar keeps the row waiting (never a silent skip)')
eq(/wantsCalendar\(t \? t\.google_target : null,/.test(drainOne), true, 'a slot with no task is on a calendar only where it is now (never put there by default)')
eq(/function removeOwnEvent[\s\S]{0,400}if \(!url\) throw new ICloudError\('calendars', NO_AREA_CALENDAR\)/.test(src), true, 'a link is never cleared without a real DELETE')
eq((drainOne.match(/const etag = await putEvent\([^\n]*\n\s*if \(!\(await link\([^\n]*\n[\s\S]{0,200}?\}\n\s*await removeOld\(/g) || []).length, 2,
  'the new copy first, linked only while the row still is what was read, then the old copies go')
eq(/'If-Match': etag/.test(src) && /r\.status === 412\) throw new ICloudError\('changed'/.test(src), true, 'a write sends the version the app last wrote: a change made on the iPhone is never written over')
const drainAction = src.slice(src.indexOf("if (action === 'drain')"), src.indexOf("if (action === 'remove')"))
eq(/\.or\(`drain_until\.is\.null,drain_until\.lt\.\$\{nowIso\}`\)/.test(drainAction) && /finally \{\n\s*await db\.from\('icloud_credentials'\)\.update\(\{ drain_until: null \}\)/.test(drainAction), true, 'one drain at a time per account (a lease, given back at the end)')
eq(/if \(prefsError\) throw new ICloudError\('prefs'/.test(drainAction) && !/last_error: null/.test(drainAction), true, "settings that can't be read are never guessed; a drain never wipes the account's last problem")
eq(/lt\('icloud_horizon', addDaysIso\(today, SERIES_TOPUP_DAYS\)\)/.test(drainAction), true, "a monthly series' date list is renewed before it runs out (90 days)")
const reads = [...drainOne.matchAll(/db\.from\((?:'[a-z_]+'|table)\)[^\n]*(?:\n\s+\.[^\n]*)*/g)].map(m => m[0])
eq(reads.length >= 4 && reads.every(r => /\.eq\('user_id', userId\)/.test(r)), true, `every read and write of the live rows is the caller's own (${reads.length})`)
eq(/\.delete\(\)\.eq\('id', q\.id\)\.eq\('user_id', user\.id\)\.eq\('requested_at', q\.requested_at\)/.test(drain), true, 'a queue row goes only while requested_at is what was read (a newer change waits)')
eq(!/console\.(log|error|warn)\([^)]*(title|summary|notes|ics)/i.test(src), true, 'no title, note or event text is ever logged')
eq(!/'PROPPATCH'|'MKCALENDAR'/.test(drainOne), true, 'the drain never makes or changes a calendar')

console.log(`\nverify-icloud-events: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
