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
const base = { timeZone: 'Europe/Oslo', appUrl: 'https://lasciviens.github.io/Project_Daily/#/daily', now, look: { notes: 'notes+link', allDayAlert: null } }
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
eq([line(allDay.ics, 'DTSTART'), line(allDay.ics, 'DTEND'), line(allDay.ics, 'TRANSP'), allDay.ics.includes('ACTION:DISPLAY'), line(allDay.ics, 'ACTION'), allDay.ics.includes('VTIMEZONE')],
  ['DTSTART;VALUE=DATE:20261103', 'DTEND;VALUE=DATE:20261104', 'TRANSP:TRANSPARENT', false, 'ACTION:NONE', false],
  "no time: all day, free, no alert unless the owner set an all-day one (Apple's no-alert marker, not the iPhone's default), no zone")
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
eq([line(allDayPlan.ics, 'DTSTART'), allDayPlan.ics.includes('ACTION:DISPLAY')], ['DTSTART;VALUE=DATE:20261102', false], 'a repeat with no time is an all-day series, no alert (unless the owner set an all-day one)')
eq(E.planEvent({ ...weekly, days_of_week: [] }, { ...base, area: DEFAULT_AREAS.training, today: '2026-10-30' }), null, 'a repeat with no day left has no event')

console.log('\n== Every event: notes and alerts (2b-3) ==')
const look = (o) => ({ ...base, done: false, look: { ...base.look, ...o } })
const slot = { id: 'b7', date: '2026-11-03', start_time: '18:00', duration_minutes: 60, title: 'Match', busy: true, notes: 'Bring scarf' }
const desc = (o) => { const ics = unfold(E.slotEvent(slot, { ...look(o), area: DEFAULT_AREAS.football }).ics); return ics.slice(0, ics.indexOf('BEGIN:VALARM')).split('\r\n').find(l => l.startsWith('DESCRIPTION:')) ?? null }
eq([desc({ notes: 'notes+link' })?.startsWith('DESCRIPTION:Bring scarf\\n\\nOpen in Lasci'), desc({ notes: 'notes' }), desc({ notes: 'link' })?.startsWith("DESCRIPTION:Open in Lasci's Board"), desc({ notes: 'none' })],
  [true, 'DESCRIPTION:Bring scarf', true, null], "an event's notes carry what the owner picked: notes and the link, notes only, the link only, or nothing")
eq(E.slotEvent(slot, { ...look({ notes: 'none' }), area: DEFAULT_AREAS.football }).ics.includes('URL;VALUE=URI:'), true, "the link field itself stays (Apple's URL field, #7)")
const allDaySlot = { id: 'b8', date: '2026-11-03', start_time: null, duration_minutes: 60, title: 'Birthday', busy: true }
const trig = (o) => line(E.slotEvent(allDaySlot, { ...look(o), area: DEFAULT_AREAS.personal }).ics, 'TRIGGER')
eq([trig({ allDayAlert: { dayBefore: false, time: '09:00' } }), trig({ allDayAlert: { dayBefore: true, time: '09:00' } }), trig({ allDayAlert: { dayBefore: false, time: '00:00' } }), trig({ allDayAlert: null })],
  ['TRIGGER:PT540M', 'TRIGGER:-PT900M', 'TRIGGER:PT0S', 'TRIGGER;VALUE=DATE-TIME:19760401T005545Z'],
  'an all-day alert at a time on the day (PT540M = 09:00), the day before (-PT900M = 09:00 the day before), or Apple\'s no-alert marker')
const timedNone = E.slotEvent(slot, { ...look({}), area: { ...DEFAULT_AREAS.football, alertMinutes: null } }).ics
eq([timedNone.includes('ACTION:NONE'), timedNone.includes('ACTION:DISPLAY')], [true, false], 'an area with alert "None" writes Apple\'s no-alert marker (the iPhone adds no default alert)')
eq(trig({ allDayAlert: { dayBefore: false, time: '25:99' } }), 'TRIGGER;VALUE=DATE-TIME:19760401T005545Z', 'a time that isn\'t one gives no alert, never a broken line')

console.log('\n== Hostile text (security review, 30.10.2026) ==')
eq([E.icsEscape('Lunch\u2028ATTENDEE:mailto:ola@example.com'), E.icsEscape('Lunch\u0085X'), E.icsEscape('Lunch\u2029X')],
  ['LunchATTENDEE:mailto:ola@example.com', 'LunchX', 'LunchX'], 'U+0085 and U+2028/2029 (line ends to some parsers) are dropped too')
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
const F = new Function(`${transform(pure.replace(/^export /gm, ''), { transforms: ['typescript'] }).code}\nreturn { ownEventUrl, drainStep, validEtag, onApple, ownEventOfHref, titleFromSummary, bareTitleFromSummary, readbackChangeOf }`)()
const cals = { work: { url: 'https://p67-caldav.icloud.com:443/123/calendars/lasci-work/' }, media: { url: 'https://evil.example/lasci-media/' } }
const id = '2c5e1b9a-4d0f-4a3b-9e7c-1f2a3b4c5d6e'
eq(F.ownEventUrl('slot', id, 'work', cals), `https://p67-caldav.icloud.com/123/calendars/lasci-work/lasci-slot-${id}.ics`, "an event's address is its own file in the area calendar the app made")
eq([F.ownEventUrl('slot', '../../work/x', 'work', cals), F.ownEventUrl('slot', id, '../work', cals), F.ownEventUrl('slot', id, 'personal', cals), F.ownEventUrl('plan', id, 'media', cals)],
  [null, null, null, null], 'never from a stored address: a forged id or area, an area with no calendar, or one outside iCloud gives no address at all')
const drainOne = src.slice(src.indexOf('async function drainOne'), src.indexOf('async function openCreds'))
const drain = src.slice(src.indexOf('async function drainAccount'), src.indexOf('const MOVE_PAGE'))
eq(!/icloud_href|\.href\b/.test(drainOne) && /ownEventUrl\(/.test(drainOne), true, 'the drain stores and trusts only the area key, never an address')
eq((drainOne.match(/if \(step === 'put'\) \{\n\s*const url = ownEventUrl\([^)]*\)\n\s*if \(!url\) throw new ICloudError\('calendars', NO_AREA_CALENDAR\)/g) || []).length, 2,
  'an event is put only when the item wants a calendar and its area is on and on Apple; a missing area calendar keeps the row waiting (never a silent skip)')
eq(/wantsCalendar\(t \? t\.google_target : null,/.test(drainOne), true, 'a slot with no task is on a calendar only where it is now (never put there by default)')
eq(/const skippedDay = !!b\.schedule_block_id && t\?\.status === 'cancelled' && !t\.closed_reason\n\s*const wanted = !skippedDay && wantsCalendar\(/.test(drainOne) && /schedule_block_id, google_calendar_event_id, icloud_area/.test(drainOne) && /\.select\('status, closed_reason, /.test(drainOne), true,
  'a skipped day of a repeat comes off Apple Calendar, as it does off Google (Undo of the skip puts it back); a day marked missed stays')
eq(/function removeOwnEvent[\s\S]{0,400}if \(!url\) throw new ICloudError\('calendars', NO_AREA_CALENDAR\)/.test(src), true, 'a link is never cleared without a real DELETE')
eq((drainOne.match(/const etag = await putEvent\([^\n]*\n\s*if \(!\(await link\([^\n]*\n[\s\S]{0,500}?\}\n\s*await removeOld\(/g) || []).length, 2,
  'the new copy first, linked only while the row still is what was read, then the old copies go')
eq(/const now = await eventNow\(c, url\)\n\s*const match = now\.gone \? null : etag \?\? now\.etag\n\s*const r = await dav\(c, 'PUT', url, ics, now\.gone \? \{ 'If-None-Match': '\*' \} : match \? \{ 'If-Match': match \} : \{\}\)/.test(src), true,
  'every write reads the event first and goes only over the version read (or the one the app knew): a change on the iPhone is never written over; one deleted there is made again (If-None-Match)')
eq(/const now = await eventNow\(c, url\)\n\s*if \(now\.gone\) return\n[^\n]*\n\s*const r = await dav\(c, 'DELETE', url, undefined, now\.etag \? \{ 'If-Match': now\.etag \} : \{\}\)\n\s*if \(r\.status === 412\) throw new ICloudError\('changed'/.test(src), true,
  'a remove reads the event first and removes only the version read (a change since waits for the read-back)')
eq(/\/\^\(ATTENDEE\|ORGANIZER\)\[;:\]\/im\.test\(r\.text\)\) throw new ICloudError\('invited'/.test(src) && /new URL\(r\.url\)\.pathname !== new URL\(url\)\.pathname\) throw new ICloudError\('redirect'/.test(src)
  && !/refuseIfInvited/.test(src), true,
  'an event with invitees is never rewritten or removed (iCloud would email them in the owner\'s name), whatever version the row stores; an answer for another place is refused')
eq(/r\.status === 412\) throw new ICloudError\('changed'/.test(src), true, 'a write over a version changed on the iPhone is refused (412) and waits for the read-back')
const drainAction = drain
eq(/\.or\(`drain_until\.is\.null,drain_until\.lt\.\$\{nowIso\}`\)/.test(drainAction) && /finally \{\n[^\n]*\n\s*await db\.from\('icloud_credentials'\)\.update\(\{ drain_until: null \}\)\.eq\('user_id', userId\)\.eq\('drain_until', lease\)/.test(drainAction), true, 'one drain at a time per account (a lease; only its own is given back)')
eq(/if \(prefsError\) throw new ICloudError\('prefs'/.test(drainAction) && !/last_error: null/.test(drainAction), true, "settings that can't be read are never guessed; a drain itself never wipes the account's last problem")
eq(/function clearRunProblem[\s\S]{0,300}\.not\('last_error', 'like', `\$\{NOT_MADE\}%`\)/.test(src) && /`\$\{NOT_MADE\}: \$\{notMade/.test(src)
  && (src.match(/await clearRunProblem\(db, /g) || []).length === 2, true,
  "a run that went through (the drain action, the timer) clears a failed run's problem; setup's \"Not made…\" stays until a setup run makes it")
eq(/lt\('icloud_horizon', addDaysIso\(today, SERIES_TOPUP_DAYS\)\)/.test(drainAction), true, "a monthly series' date list is renewed before it runs out (90 days)")
const reads = [...drainOne.matchAll(/db\.from\((?:'[a-z_]+'|table)\)[^\n]*(?:\n\s+\.[^\n]*)*/g)].map(m => m[0])
eq(reads.length >= 4 && reads.every(r => /\.eq\('user_id', userId\)/.test(r)), true, `every read and write of the live rows is the caller's own (${reads.length})`)
eq(/\.delete\(\)\.eq\('id', q\.id\)\.eq\('user_id', userId\)\.eq\('requested_at', q\.requested_at\)/.test(drain), true, 'a queue row goes only while requested_at is what was read (a newer change waits)')
eq(!/console\.(log|error|warn)\([^)]*(title|summary|notes|ics)/i.test(src), true, 'no title, note or event text is ever logged')
eq(!/'PROPPATCH'|'MKCALENDAR'/.test(drainOne), true, 'the drain never makes or changes a calendar')


console.log('\n== The switch per area (2b-2, migration 175) ==')
const step = (wanted, apple, inApple, googleCopy, waitsForGoogleTask) => F.drainStep({ wanted, apple, inApple, googleCopy, waitsForGoogleTask })
eq([step(true, true, false, true, false), step(true, true, true, false, false)], ['put', 'put'], 'an item that wants a calendar in an area on Apple is put there')
eq([step(true, false, true, false, false), step(true, false, true, true, false)], ['keep', 'remove'],
  'back on Google: the Apple copy stays until the Google copy exists, then goes (the new copy first)')
eq([step(false, true, true, false, true), step(false, true, true, false, false), step(false, false, false, false, false)], ['keep', 'remove', 'none'],
  'moved to Google Tasks: the Apple copy waits for the Google Task; off every calendar it goes; nothing in Apple, nothing to do')
eq([F.onApple({ enabled: true, app: 'apple' }), F.onApple({ enabled: false, app: 'apple' }), F.onApple({ enabled: true, app: 'google' })], [true, false, false],
  'an area writes to Apple only when it is switched to Apple and in use')
eq([F.validEtag('"abc-1"'), F.validEtag('W/"x"'), F.validEtag('"a"\r\nX-Evil: 1'), F.validEtag('abc'), F.validEtag('""'), F.validEtag(null)],
  ['"abc-1"', 'W/"x"', null, null, null, null], 'a stored version goes into If-Match only as one quoted value (never a header break)')
eq(/validEtag\(b\.icloud_etag\)/.test(drainOne) && /validEtag\(p\.icloud_etag\)/.test(drainOne), true, 'the drain sends a stored version only through that check')
eq((drainOne.match(/await removeOld\('(slot|plan)', [bp]\.id, area, [bp]\.icloud_area, q\.area\)\n\s*return handOver\('(slot|plan)', [bp]\.id, [bp]\.google_calendar_event_id\)/g) || []).length, 2,
  'the Google Calendar copy is handed over only after the Apple copy is in and linked')
eq(/db\.rpc\('icloud_hand_over', \{ p_user: userId, p_entity: entity, p_id: id, p_event: eventId \}\)/.test(drainOne), true,
  "the hand-over is the database's (it deletes only an id the app made for that item, 175)")
eq((drainOne.match(/if \(step === 'keep'\) \{\n\s*await removeOld\('(slot|plan)', [bp]\.id, [bp]\.icloud_area, q\.area\)\n\s*return 'kept'/g) || []).length, 2,
  'a kept item keeps its linked Apple copy (only an unlinked one left by an Undo goes)')
const handler = src.slice(src.indexOf('Deno.serve('))
eq(/const syncHeader = req\.headers\.get\('x-sync-secret'\)\n\s*if \(syncHeader !== null\) \{\n\s*const syncSecret = Deno\.env\.get\('ICLOUD_SYNC_SECRET'\)\n\s*if \(!syncSecret \|\| !\(await sameSecret\(syncHeader, syncSecret\)\)\) return answer\(\{ error: 'forbidden' \}, 401\)/.test(handler)
   && handler.indexOf("req.headers.get('x-sync-secret')") < handler.indexOf("req.headers.get('authorization')"), true,
  'the timer is let in only with the sync secret (constant time; none set: refused) — every other call needs a signed-in app user')
const everyAccount = src.slice(src.indexOf('async function drainEveryAccount'), src.indexOf('async function sameSecret'))
eq(/if \(!\(await isAppUser\(r\.user_id\)\)\) continue/.test(everyAccount) && /const total: Record<string, number>/.test(everyAccount) && /\n  return total\n\}/.test(everyAccount), true,
  'the timer drains only accounts the app serves, and answers counts only')
eq(/\[functions\.icloud-calendar\]\nverify_jwt = false/.test(fs.readFileSync(path.join(__dirname, '../supabase/config.toml'), 'utf8')), true,
  'config.toml lets the timer reach the function (the check is in its code)')
const move = src.slice(src.indexOf("if (action === 'move')"), src.indexOf("if (!row || !row.app_password)"))
const moveFn = src.slice(src.indexOf('async function queueAreaMove'), src.indexOf('async function drainEveryAccount'))
eq(/!\(AREA_KEYS as readonly string\[\]\)\.includes\(areaKey\) \|\| !\(MOVE_FROM as readonly string\[\]\)\.includes\(from\)/.test(move), true, 'a move names one of the five areas and a known start, nothing else')
eq(/part === 'past days of a repeat'\) page = page\.lt\('date', today\)\.not\('schedule_block_id', 'is', null\)/.test(moveFn), true,
  'from today on also takes the earlier days of a repeat with a slot of their own (they go with the series)')
const disconnect = src.slice(src.indexOf("if (action === 'disconnect')"), src.indexOf("if (action === 'move')"))
eq(/onApple\(readCalendarPrefs\(prefsRow\?\.prefs\)\.areas\[k\]\)/.test(disconnect) && disconnect.indexOf('onAppleNow.length') < disconnect.indexOf(".delete()"), true,
  'disconnect is refused while an area shows in Apple Calendar (its new items would reach no calendar)')
eq(/if \(!dryRun && !onApple\(/.test(moveFn), true, "an area's items are queued only once it is switched to Apple (the preview only counts)")
const moveReads = [...moveFn.matchAll(/db\.from\('[a-z_]+'\)[^\n]*(?:\n\s+\.[^\n]*)*/g)].map(m => m[0]).filter(r => !/\.upsert\(/.test(r))
eq(moveReads.length >= 4 && moveReads.every(r => /\.eq\('user_id', userId\)/.test(r)), true, `a move reads only the caller's own rows (${moveReads.length})`)


console.log('\n== Changes from Apple Calendar (2c, migration 176) ==')
const pid = '2c5e1b9a-4d0f-4a3b-9e7c-1f2a3b4c5d6e'
eq([F.ownEventOfHref(`/123/calendars/lasci-work/lasci-slot-${pid}.ics`), F.ownEventOfHref(`/123/calendars/lasci-work/lasci-plan-${pid.toUpperCase()}.ics`)],
  [{ entity: 'slot', id: pid }, { entity: 'plan', id: pid }], "the app's own event file names give the item")
eq([F.ownEventOfHref('/123/calendars/lasci-work/ABC-owner-made.ics'), F.ownEventOfHref(`/x/lasci-slot-${pid}.ics/../evil.ics`), F.ownEventOfHref(`/x/lasci-slot-${pid}x.ics`), F.ownEventOfHref('/x/%E0%A4%A.ics')],
  [null, null, null, null], 'any other name (an event the owner made, a trick path, a broken escape) gives nothing')
eq([F.titleFromSummary('✓ 🏋️ Lower B', '🏋️'), F.titleFromSummary('🏋️ Lower B', '🏋️'), F.titleFromSummary('Lower B', '🏋️'), F.titleFromSummary('Lunch\u0007\u0000 ok', '')],
  ['Lower B', 'Lower B', 'Lower B', 'Lunch ok'], "a title read back loses the done mark and the area's emoji the app put there, and control characters")
eq([F.titleFromSummary('🎂 Birthday', ''), F.titleFromSummary('→ Call the bank', ''), F.titleFromSummary('⚽ Derby', '🥅')], ['🎂 Birthday', '→ Call the bank', '⚽ Derby'],
  "a symbol of the owner's own title stays (an area with no emoji, or another emoji): the title read back is never cut")
eq([F.bareTitleFromSummary('⚽ Derby', '🥅'), F.bareTitleFromSummary('#1 Derby', '🥅'), F.bareTitleFromSummary('⚽', '🥅')], ['Derby', '#1 Derby', '⚽'],
  'only for comparing: an emoji from before the area\'s emoji changed comes off (a first word of symbols only — never "#1", never the whole title)')
const ev = (...lines) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', ...lines, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
const suid = `lasci-slot-${pid}@lasciviens.github.io`
eq(F.readbackChangeOf(ev(`UID:${suid}`, 'DTSTART;TZID=Europe/Oslo:20261113T183000', 'DTEND;TZID=Europe/Oslo:20261113T200000', 'SUMMARY:⚽ Match (moved)', 'LAST-MODIFIED:20261030T150000Z'), 'slot', suid, '⚽'),
  { allDay: false, date: '2026-11-13', time: '18:30', minutes: 90, busy: true, title: 'Match (moved)', titleBare: 'Match (moved)', lastModified: '2026-10-30T15:00:00Z' },
  'an event moved on the iPhone: its day, time, length and title on the Oslo clock, and when it was changed')
eq(F.readbackChangeOf(ev(`UID:${suid}`, 'DTSTART:20261113T173000Z', 'DURATION:PT45M', 'TRANSP:TRANSPARENT', 'SUMMARY:x'), 'slot', suid, ''),
  { allDay: false, date: '2026-11-13', time: '18:30', minutes: 45, busy: false, title: 'x', titleBare: 'x', lastModified: null },
  'a UTC time is read on the Oslo clock; a DURATION gives the length; Free is not busy; no stamp stays null (never applied)')
eq(F.readbackChangeOf(ev(`UID:${suid}`, 'DTSTART;VALUE=DATE:20261114', 'DTEND;VALUE=DATE:20261115', 'SUMMARY:Birthday'), 'slot', suid, '').allDay, true, 'an all-day event reads as all day')
eq([F.readbackChangeOf(ev(`UID:${suid}`, 'DTSTART;TZID=Mars/Olympus:20261113T183000', 'SUMMARY:x'), 'slot', suid, ''),
    F.readbackChangeOf(ev('UID:someone-else@example.com', 'DTSTART:20261113T173000Z', 'SUMMARY:x'), 'slot', suid, '')],
  [null, null], 'a time in a zone the server can\'t read, or another uid, gives nothing (never a guess)')
const puid = `lasci-plan-${pid}@lasciviens.github.io`
const series = ['BEGIN:VCALENDAR', 'VERSION:2.0',
  'BEGIN:VEVENT', `UID:${puid}`, 'DTSTART;TZID=Europe/Oslo:20261103T063000', 'DTEND;TZID=Europe/Oslo:20261103T073000', 'RRULE:FREQ=WEEKLY;BYDAY=TU',
  'EXDATE;TZID=Europe/Oslo:20261110T063000,20261117T063000', 'EXDATE;VALUE=DATE:20261124', 'SUMMARY:🏋️ Swim 2 km', 'LAST-MODIFIED:20261030T150000Z', 'END:VEVENT',
  'BEGIN:VEVENT', `UID:${puid}`, 'RECURRENCE-ID;TZID=Europe/Oslo:20261103T063000', 'DTSTART;TZID=Europe/Oslo:20261104T070000', 'DTEND;TZID=Europe/Oslo:20261104T074500', 'SUMMARY:🏋️ Swim', 'LAST-MODIFIED:20261030T151000Z', 'END:VEVENT',
  'BEGIN:VEVENT', `UID:${puid}`, 'RECURRENCE-ID;TZID=Europe/Oslo:20261201T063000', 'STATUS:CANCELLED', 'DTSTART;TZID=Europe/Oslo:20261201T063000', 'END:VEVENT',
  'END:VCALENDAR'].join('\r\n')
eq(F.readbackChangeOf(series, 'plan', puid, '🏋️'), {
  title: 'Swim 2 km', titleBare: 'Swim 2 km', lastModified: '2026-10-30T15:10:00Z', days: [
    { originalDate: '2026-11-10', cancelled: true }, { originalDate: '2026-11-17', cancelled: true }, { originalDate: '2026-11-24', cancelled: true },
    { originalDate: '2026-11-03', allDay: false, date: '2026-11-04', time: '07:00', minutes: 45, busy: true, title: 'Swim' },
    { originalDate: '2026-12-01', cancelled: true },
  ] }, "a series: its title, its newest stamp, every deleted day (EXDATEs, a cancelled day) and a moved day")

const rbArea = src.slice(src.indexOf('async function readBackArea'), src.indexOf('async function readBackCalendarLook'))
eq(/return ownEventUrl\(o\.entity, o\.id, area, areaCals\) === new URL\(href, calUrl\)\.toString\(\) \? o : null/.test(rbArea)
   && /readbackChangeOf\(item\.ics, o\.entity, `lasci-\$\{o\.entity\}-\$\{o\.id\}@lasciviens\.github\.io`/.test(rbArea), true,
  "only the app's own events: the file name, the whole address the app builds itself (exact, never startsWith), and the uid inside")
eq(/if \(!counts\.failed && !stopped && todo\.length <= READBACK_MAX && newToken\)/.test(rbArea), true, 'the token moves only when every change was handled')
eq(!/removed = /.test(rbArea.slice(rbArea.indexOf('if (!token) {'))) , true, 'reading every event (no token) never infers a deletion')
const rbReads = [...rbArea.matchAll(/db\.from\((?:'[a-z_]+'|table)\)[^\n]*(?:\n\s+\.[^\n]*)*/g)].map(m => m[0]).filter(r => !/\.upsert\(/.test(r))
eq(rbReads.length >= 1 && rbReads.every(r => /\.eq\('user_id', userId\)/.test(r)), true, `the read-back reads only the account's own rows (${rbReads.length})`)
const drainFn = src.slice(src.indexOf('async function drainAccount'), src.indexOf('const MOVE_PAGE'))
eq(drainFn.indexOf('await readBackAccount(') > drainFn.indexOf("update({ drain_until: lease })") && drainFn.indexOf('await readBackAccount(') < drainFn.indexOf("from('icloud_outbox')"), true,
  'changes from the iPhone are read inside the drain\'s lease, before anything is sent')
const lookFn = src.slice(src.indexOf('async function readBackCalendarLook'), src.indexOf('async function readBackAccount'))
eq(/if \(!state\?\.written_name && !state\?\.written_color\)[\s\S]{0,300}return false/.test(lookFn) && /iName !== state\.written_name/.test(lookFn), true,
  "a calendar's name comes back only when it differs from what the app last wrote (the first look is the baseline)")
eq(/change\.foreign = !!\(mine && now && validEtag\(mine\) && mine !== now\)/.test(rbArea), true,
  "a version the app didn't write (it knew its own) is someone else's change, even with no LAST-MODIFIED stamp")
eq(/return look \|\| !state\?\.synced_at \|\| Date\.now\(\) - Date\.parse\(state\.synced_at\) > READBACK_FRESH_MS/.test(src) && /started = Date\.now\(\) \/\/ the send's own time budget/.test(src), true,
  'a save skips a calendar read in the last minute, and the send gets its own time after the read-back')
eq(/if \(action === 'status'\) \{[\s\S]{0,400}from\('icloud_sync_state'\)\.select\('area, synced_at, last_error'\)\.eq\('user_id', user\.id\)/.test(src), true,
  'the card is told when changes were last read and any problem (never silent)')
eq(/const removedOwn = await stillLinked\(db, userId, area, /.test(rbArea) && /\.eq\('icloud_area', area\)\.in\('id', ids\.slice\(at, at \+ 100\)\)/.test(src), true,
  'only removals of events still linked to that calendar count: the app\'s own deletes and moves never hold the read-back back')
eq(/if \(removedOwn\.length > READBACK_MAX_REMOVED\) \{/.test(rbArea) && /const READBACK_MAX_REMOVED = 20/.test(src), true,
  'more than 20 of the app\'s events removed at once: none is let go, the token stays and it is said')
eq(/if \(Date\.now\(\) > deadline\) \{ stopped = true; return \}/.test(rbArea) && /!counts\.failed && !stopped &&/.test(rbArea), true,
  'the read-back keeps to its share of the drain\'s time; past it nothing new starts and the token stays')
const rbAccount = src.slice(src.indexOf('async function readBackAccount'), src.indexOf("type DrainCounts"))
eq(/await Promise\.allSettled\(areas\.map/.test(rbAccount) && !/await Promise\.all\(areas/.test(rbAccount), true,
  'every area calendar finishes before the drain goes on or gives its lease back (never work left running)')
eq(/filter\(d => \(d\.originalDate \?\? ''\) >= today\)\.slice\(0, 31\)/.test(rbArea), true, "a series' days: only from today on, at most 31 (the database checks the same)")
eq(/db\.rpc\('icloud_calendar_look'/.test(lookFn) && !/from\('calendar_prefs'\)\.upsert/.test(lookFn), true,
  "a calendar renamed on the iPhone changes only its name and colour in Settings (one narrow update, never the whole document)")
const readFile = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
eq(/BLOCK_EVENT_RESET: RowOverrides = \{ time_blocks: \{ google_calendar_event_id: null, icloud_area: null, icloud_etag: null \} \}/.test(readFile('src/features/calendar/api/deletedBlockEvents.ts'))
   && /icloud_area: null, icloud_etag: null, icloud_horizon: null/.test(readFile('src/features/calendar/api/scheduleSeriesCalendar.ts')), true,
  'Undo of a delete puts the item back without its old Apple link (the next read-back never takes it for deleted on the iPhone)')
eq(/res\.status === 503\) \{[^\n]*throw new ICloudError\('busy'/.test(src) && /e\.code === 'auth' \|\| e\.code === 'busy'\)\) throw e/.test(drainFn), true,
  "iCloud's rate limit (503) stops the run instead of hammering it")

console.log(`\nverify-icloud-events: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
