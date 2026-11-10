#!/usr/bin/env node
/*
 * Verification — an item's calendar fields (migration 193; the one item screen, step 2): End Repeat, Alert + Second
 * Alert, Show As, URL and Travel Time, from the sheet's form to Apple's iCalendar text and Google's bodies, and back
 * from the iPhone. Every value is input (the warning in AGENTS.md), so hostile values are tried at each step: CRLF in
 * a link, a 10 000-character link, a negative alert, an End Repeat before the start, a forged repeat rule.
 * Two golden files hold the whole iCalendar object of a slot and a series with every field
 * (scripts/golden/icloud-*-193.ics; `--update` rewrites them after a deliberate change).
 *
 *   Run:  node scripts/verify-item-calendar-fields.cjs
 */
process.env.TZ = 'Europe/Oslo'
const fs = require('fs')
const path = require('path')
require('sucrase/register')
const R = require('../src/features/calendar/calendarEventRules')
const C = require('../src/features/daily/recurrence')
const S = require('../src/features/calendar/calendarSeries')
const E = require('../src/features/calendar/areas/icloudEvents')
const F = require('../src/features/items/itemCalendarFields')
const I = require('../src/features/items/itemRules')
const P = require('../src/shared/components/plan-modal/planForm')
const { DEFAULT_AREAS } = require('../src/features/calendar/areas/calendarAreas')

let passed = 0, failed = 0
function eq(got, want, name) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name} — got ${g}, want ${w}`) }
}
const throws = (fn) => { try { fn(); return null } catch (e) { return e.message } }
const unfold = ics => ics.replace(/\r\n[ \t]/g, '')
const vevent = ics => { const u = unfold(ics); return u.slice(u.indexOf('BEGIN:VEVENT'), u.indexOf('END:VEVENT')).split('\r\n') }
const lines = (ics, name) => vevent(ics).filter(l => l.startsWith(name))
const now = new Date('2026-11-10T09:00:00Z')
const appUrl = 'https://lasciviens.github.io/Project_Daily/#/daily'
const look = { notes: 'notes+link', allDayAlert: null }
const personal = DEFAULT_AREAS.personal
const work10 = { ...DEFAULT_AREAS.work, alertMinutes: 10 }
const slot = (x = {}, o = {}) => E.slotEvent({ id: '2c5e1b9a-4d0f-4a3b-9e7c-1f2a3b4c5d6e', date: '2026-11-12', start_time: '17:00:00', duration_minutes: 60, title: 'Dentist', busy: true, ...x },
  { done: false, area: work10, look, timeZone: 'Europe/Oslo', appUrl, now, ...o })

console.log('\n== End Repeat: the rule (recurrence.ts) ==')
{
  const tueThu = { days_of_week: [2, 4], repeat_kind: 'weekly', effective_from: '2026-11-03' }
  eq([C.countEndDay({ ...tueThu, repeat_count: 4 }), C.countEndDay({ days_of_week: [2, 4], effective_from: '2026-11-04', repeat_count: 1 }),
      C.countEndDay({ days_of_week: [], repeat_kind: 'interval', repeat_interval: 3, repeat_unit: 'day', effective_from: '2026-11-02', repeat_count: 3 }),
      C.countEndDay({ days_of_week: [1], repeat_kind: 'interval', repeat_interval: 2, repeat_unit: 'week', effective_from: '2026-11-02', repeat_count: 3 }),
      C.countEndDay({ days_of_week: [], repeat_kind: 'monthly', effective_from: '2026-01-31', repeat_count: 2 }),
      C.countEndDay({ days_of_week: [], repeat_kind: 'dates', repeat_dates: ['2026-12-24', '2026-11-20', '2026-11-20', '2026-11-01'], effective_from: '2026-11-02', repeat_count: 2 }),
      C.countEndDay({ days_of_week: [], repeat_kind: 'dates', repeat_dates: ['2026-11-20'], effective_from: '2026-11-02', repeat_count: 2 }),
      C.countEndDay({ days_of_week: [], effective_from: '2026-11-02', repeat_count: 1 }),
      C.countEndDay({ days_of_week: [1], effective_from: '2026-11-02', repeat_count: 0 })],
    ['2026-11-12', '2026-11-05', '2026-11-08', '2026-11-30', '2026-02-28', '2026-12-24', null, null, null],
    'the Nth day per kind — the same days as the database\'s repeat_count_end (scenario C5)')
  eq(C.countEndDay({ ...tueThu, except_dates: ['2026-11-05'], repeat_count: 4 }), '2026-11-12', 'a day taken out still counts (RFC 5545 counts before EXDATE)')
  const four = { ...tueThu, repeat_count: 4 }
  eq([C.occursOn(four, '2026-11-12'), C.occursOn(four, '2026-11-17'), C.occursOn({ ...tueThu, repeat_until: '2026-11-10' }, '2026-11-10'),
      C.occursOn({ ...tueThu, repeat_until: '2026-11-10' }, '2026-11-12'), C.occursOn({ ...tueThu, repeat_until: null, repeat_count: null }, '2030-01-01')],
    [true, false, true, false, true], 'occursOn: never after its end (a count with no stored end day yet is counted); "on a day" includes that day; never = no end')
  eq(C.occurrencesBetween(four, '2026-11-01', '2026-12-31'), ['2026-11-03', '2026-11-05', '2026-11-10', '2026-11-12'], 'its days are exactly the 4')
  eq([C.repeatLastDay({ ...tueThu, repeat_until: '2026-11-24', repeat_count: 4 }), C.repeatCountOf(1000), C.repeatCountOf(2.5), C.repeatCountOf('4'), C.repeatCountOf(999)],
    ['2026-11-24', null, null, null, 999], 'the stored end day wins (the database keeps it at the Nth day); a count is a whole 1–999')
  const big = C.countEndDay({ days_of_week: [], repeat_kind: 'interval', repeat_interval: 99, repeat_unit: 'month', effective_from: '2026-01-01', repeat_count: 999 })
  eq(big, null, 'a count the rule never reaches within 20 years has no end day (the database answers the same)')
}

console.log('\n== End Repeat, Show As and reminders on a series (calendarSeries.ts — Google and Apple) ==')
{
  const plan = (x = {}) => ({ title: 'Run', days_of_week: [2, 4], repeat_kind: 'weekly', effective_from: '2026-11-03', start_time: '07:00:00', end_time: '07:45:00', busy: true, time_zone: 'Europe/Oslo', ...x })
  const ser = (x, from = null) => S.seriesEventFor({ ...plan(x), google_calendar_from: from }, { today: '2026-11-02', timeZone: 'Europe/Oslo' })
  eq(ser({ repeat_count: 4, repeat_until: '2026-11-12' }).body.recurrence, ['RRULE:FREQ=WEEKLY;WKST=MO;BYDAY=TU,TH;COUNT=4'],
    '"after 4 times" from the plan\'s own first day: COUNT=4 (Apple and Google count the same 4)')
  eq(ser({ repeat_count: 4, repeat_until: '2026-11-12' }, '2026-11-06').body.recurrence, ['RRULE:FREQ=WEEKLY;WKST=MO;BYDAY=TU,TH;UNTIL=20261112T225959Z'],
    '…a series that starts later (added to the calendar on 06.11): UNTIL its last day, never COUNT=4 from there')
  eq(ser({ repeat_until: '2026-12-01' }).body.recurrence, ['RRULE:FREQ=WEEKLY;WKST=MO;BYDAY=TU,TH;UNTIL=20261201T225959Z'],
    '"on a day": UNTIL that day\'s 23:59:59 on the plan\'s clock as UTC (RFC 5545: with a TZID start, UNTIL is UTC)')
  eq(S.seriesEventFor({ ...plan({ repeat_until: '2026-07-14', time_zone: 'Europe/Oslo' }), effective_from: '2026-07-01' }, { today: '2026-06-30', timeZone: 'Europe/Oslo' }).body.recurrence,
    ['RRULE:FREQ=WEEKLY;WKST=MO;BYDAY=TU,TH;UNTIL=20260714T215959Z'], '…summer time counted (Oslo is UTC+2 in July)')
  eq(S.seriesEventFor(plan({ repeat_until: '2026-12-01', time_zone: 'America/New_York' }), { today: '2026-11-02', timeZone: 'America/New_York' }).body.recurrence,
    ['RRULE:FREQ=WEEKLY;WKST=MO;BYDAY=TU,TH;UNTIL=20261202T045959Z'], '…on the plan\'s own zone')
  eq(ser({ start_time: null, end_time: null, repeat_until: '2026-12-01' }).body.recurrence, ['RRULE:FREQ=WEEKLY;WKST=MO;BYDAY=TU,TH;UNTIL=20261201'],
    'an all-day series ends on a date (UNTIL=YYYYMMDD, as its VALUE=DATE start)')
  eq(ser({ repeat_until: '2026-11-01' }), null, 'an End Repeat before the start (UNTIL before DTSTART): no series at all — never one that ends before it starts')
  const monthly = S.seriesEventFor({ title: 'Rent', days_of_week: [], repeat_kind: 'monthly', effective_from: '2026-11-15', start_time: '09:00', end_time: '09:15', repeat_until: '2027-02-20' },
    { today: '2026-11-02', timeZone: 'Europe/Oslo' })
  eq([monthly.body.recurrence, monthly.horizon], [['RDATE;TZID=Europe/Oslo:20261215T090000,20270115T090000,20270215T090000'], '2027-02-20'],
    'the RDATE kinds list no day after the end; the horizon is the end, so…')
  eq(S.needsHorizonTopUp({ ...monthly.body, title: 'Rent', days_of_week: [], repeat_kind: 'monthly', effective_from: '2026-11-15', start_time: '09:00', end_time: '09:15',
    repeat_until: '2027-02-20', google_calendar_event_id: 'e1', google_calendar_horizon: '2027-02-20' }, '2027-01-30'), false, '…it is never topped up again')
  eq(ser({ except_dates: ['2026-11-19'], repeat_until: '2026-11-17' }).body.recurrence, ['RRULE:FREQ=WEEKLY;WKST=MO;BYDAY=TU,TH;UNTIL=20261117T225959Z'],
    'an EXDATE after the end is not sent (Google wants an EXDATE to name a real occurrence)')
  eq([ser({ show_as: 'free' }).body.transparency, ser({ busy: false, show_as: 'busy' }).body.transparency, ser({ start_time: null, end_time: null, show_as: 'busy' }).body.transparency,
      ser({}).body.transparency, ser({ busy: false }).body.transparency],
    ['transparent', 'opaque', 'opaque', 'opaque', 'transparent'], 'Show As sets Busy / Free on a series; none of its own: by its length, as before')
  eq([ser({ alerts: [60, 10] }).body.reminders, 'reminders' in ser({}), ser({ start_time: null, end_time: null, alerts: [1440] }).body.reminders.overrides],
    [{ useDefault: false, overrides: [{ method: 'popup', minutes: 60 }, { method: 'popup', minutes: 10 }] }, false, [{ method: 'popup', minutes: 900 }]],
    "a plan's own alerts are Google's reminders (none of its own: Google's default); all day: 09:00 the day before = 900")
}

console.log('\n== Apple: the event (icloudEvents.ts) ==')
{
  const full = slot({ alerts: [60, 10], show_as: 'free', url: 'https://example.com/booking?ref=1', travel_minutes: 30,
    place: { name: 'Jernbanetorget', locality: 'Oslo', lat: 59.911, lon: 10.75 } })
  eq(lines(full.ics, 'TRIGGER'), ['TRIGGER:-PT60M', 'TRIGGER:-PT10M'], 'Alert and Second Alert: two VALARMs, in order (not the area\'s 10 alone)')
  eq(lines(full.ics, 'ACTION'), ['ACTION:DISPLAY', 'ACTION:DISPLAY'], '…each a display alert')
  eq(lines(full.ics, 'TRANSP'), ['TRANSP:TRANSPARENT'], 'Show As Free → TRANSP:TRANSPARENT, though it has a length')
  eq(lines(full.ics, 'URL'), ['URL;VALUE=URI:https://example.com/booking?ref=1'], "the item's own link in Apple's URL field")
  eq(lines(full.ics, 'DESCRIPTION')[0].includes('#/daily?date=2026-11-12'), true, '…the link back to the app stays in the notes')
  eq([lines(full.ics, 'X-APPLE-TRAVEL-DURATION'), lines(full.ics, 'X-APPLE-TRAVEL-ADVISORY'), lines(full.ics, 'X-APPLE-STRUCTURED-LOCATION').length],
    [['X-APPLE-TRAVEL-DURATION;VALUE=DURATION:PT30M'], [], 1], 'Travel Time 30 minutes: Apple\'s travel duration, the pin kept, no Time to Leave advisory')
  eq([lines(slot({ alerts: [] }).ics, 'ACTION'), lines(slot({}).ics, 'TRIGGER'), lines(slot({ alerts: null }).ics, 'TRIGGER')],
    [['ACTION:NONE'], ['TRIGGER:-PT10M'], ['TRIGGER:-PT10M']], 'None → Apple\'s no-alert marker; none of its own → the area\'s alert, as before 193')
  eq(lines(slot({ alerts: [0] }).ics, 'TRIGGER'), ['TRIGGER:PT0S'], 'at the time of the event: PT0S')
  const day = (x) => slot({ start_time: null, ...x })
  eq([lines(day({ alerts: [0] }).ics, 'TRIGGER'), lines(day({ alerts: [1440, 10080] }).ics, 'TRIGGER'), lines(day({ alerts: [2880] }).ics, 'TRIGGER'), lines(day({ alerts: [5, 30] }).ics, 'TRIGGER')],
    [['TRIGGER:PT540M'], ['TRIGGER:-PT900M', 'TRIGGER:-PT9540M'], ['TRIGGER:-PT2340M'], ['TRIGGER:PT540M']],
    'all day: on the day 09:00 = PT540M, 1 day / a week before at 09:00, 2 days; two minute alerts on the same day become one')
  eq(lines(slot({ show_as: 'busy', busy: false }).ics, 'TRANSP'), ['TRANSP:OPAQUE'], 'Show As Busy on an item with no length → OPAQUE')
  const pin = { name: 'Jernbanetorget', lat: 59.911, lon: 10.75 }
  eq([lines(slot({ place: pin }).ics, 'X-APPLE-TRAVEL'), lines(slot({ place: pin, travel_minutes: 0 }).ics, 'X-APPLE-TRAVEL'), lines(slot({ travel_minutes: 120 }).ics, 'X-APPLE-TRAVEL')],
    [['X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC'], [], ['X-APPLE-TRAVEL-DURATION;VALUE=DURATION:PT120M']],
    'Travel: automatic with a pin = Time to Leave (as 186); None = neither line; minutes without a place = the duration alone')
}

console.log('\n== Apple: hostile values (the warning in AGENTS.md) ==')
{
  const dayLink = 'URL;VALUE=URI:https://lasciviens.github.io/Project_Daily/#/daily?date=2026-11-12'
  const crlf = slot({ url: 'https://example.com/x\r\nATTENDEE;RSVP=TRUE:mailto:ola@example.com' })
  eq([lines(crlf.ics, 'URL'), lines(crlf.ics, 'ATTENDEE')], [[dayLink], []], 'CRLF in the link: no ATTENDEE line — the stored value is refused, the day link stands')
  eq(lines(slot({ url: `https://example.com/${'a'.repeat(10000)}` }).ics, 'URL'), [dayLink], 'a 10 000-character link is no link (the day link)')
  for (const u of ['http://example.com', 'javascript:alert(1)', 'https://example.com/"x"', 'https://example.com/a b', 'https://user@example.com/', 'https://example.com/\u2028X', 'data:text/html,x'])
    eq(lines(slot({ url: u }).ics, 'URL'), [dayLink], `a link that isn't an https web address is no link: ${JSON.stringify(u).slice(0, 40)}`)
  eq(lines(slot({ alerts: [-5] }).ics, 'TRIGGER'), ['TRIGGER:-PT10M'], 'a negative alert is no alert of its own (the area\'s); never "-PT-5M" or after the start')
  for (const a of [[5, 10, 15], [10, 10], ['10'], [7], [40320], 'PT5M', { 0: 5 }])
    eq(lines(slot({ alerts: a }).ics, 'TRIGGER'), ['TRIGGER:-PT10M'], `hostile alerts read as none of its own: ${JSON.stringify(a)}`)
  eq([lines(slot({ travel_minutes: -1 }).ics, 'X-APPLE-TRAVEL'), lines(slot({ travel_minutes: '30\r\nX:1' }).ics, 'X-APPLE-TRAVEL'), lines(slot({ show_as: 'free\r\nX:1' }).ics, 'TRANSP')],
    [[], [], ['TRANSP:OPAQUE']], 'a travel time or Show As off the list reads as not set (automatic, by its length)')
  // The last guards: what the readers let through can't reach them, so each is tried directly.
  eq(throws(() => E.urlLine(null, 'https://example.com/\r\nX:1')), 'An event link is not a web address the app takes — not written', 'the URL line refuses anything ITEM_URL doesn\'t take, even the fallback')
  eq(throws(() => E.urlLine(null, `https://example.com/${'a'.repeat(2030)}`)), 'An event link is not a web address the app takes — not written', '…or one over 2048 characters')
  eq(throws(() => E.eventObject({ uid: 'x', body: { summary: 'x', start: { date: '2026-11-03' }, end: { date: '2026-11-04' }, transparency: 'transparent',
    recurrence: ['RRULE:FREQ=WEEKLY;UNTIL=20261201;X-EVIL=1'] }, area: personal, look, notes: null, link: appUrl, now })),
    'A repeat rule is not one the app builds — not written', 'a repeat rule the app didn\'t build (a forged part) is refused')
  eq(throws(() => E.eventObject({ uid: 'x', body: { summary: 'x', start: { date: '2026-11-03' }, end: { date: '2026-11-04' }, transparency: 'transparent',
    recurrence: ['RRULE:FREQ=DAILY;COUNT=0'] }, area: personal, look, notes: null, link: appUrl, now })), 'A repeat rule is not one the app builds — not written', '…and so is COUNT=0')
  eq(E.ITEM_TRIGGERS, ['PT0S', 'PT540M', '-PT5M', '-PT10M', '-PT15M', '-PT30M', '-PT60M', '-PT120M', '-PT1440M', '-PT900M', '-PT2880M', '-PT2340M', '-PT10080M', '-PT9540M'],
    'the alert guard\'s list: every trigger an item alert can be, and no other')
  const plan = { id: 'p1', title: 'Run', days_of_week: [2], repeat_kind: 'weekly', effective_from: '2026-11-03', start_time: '07:00', end_time: '07:45', busy: true }
  eq(E.planEvent({ ...plan, repeat_until: '2026-11-01' }, { area: personal, look, today: '2026-11-02', timeZone: 'Europe/Oslo', appUrl, now }), null,
    'an End Repeat before the start (UNTIL before DTSTART) writes no event')
}

console.log('\n== The golden files: a slot and a series with every field ==')
{
  const goldenDir = path.join(__dirname, 'golden')
  const golden = (file, ics) => {
    const p = path.join(goldenDir, file)
    if (process.argv.includes('--update')) { fs.mkdirSync(goldenDir, { recursive: true }); fs.writeFileSync(p, ics) }
    const want = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
    eq(ics === want, true, `${file} is exactly the golden copy${want === null ? ' (missing — run with --update)' : ''}`)
  }
  golden('icloud-slot-193.ics', slot({ alerts: [60, 10], show_as: 'free', url: 'https://example.com/booking?ref=1', travel_minutes: 30, notes: 'Bring the card',
    place: { name: 'Jernbanetorget', locality: 'Oslo', lat: 59.911, lon: 10.75 } }).ics)
  golden('icloud-plan-193.ics', E.planEvent({ id: '0b7e6c1d-2f3a-4b5c-8d9e-0f1a2b3c4d5e', title: 'Run', days_of_week: [2, 4], repeat_kind: 'weekly', effective_from: '2026-11-03',
    start_time: '07:00', end_time: '07:45', busy: true, except_dates: ['2026-11-05'], repeat_count: 10, repeat_until: '2026-12-03', alerts: [15], show_as: 'busy',
    url: 'https://example.com/route', travel_minutes: 0, notes: null, icloud_from: '2026-11-02' },
    { area: { ...DEFAULT_AREAS.training, alertMinutes: 60 }, look, today: '2026-11-02', timeZone: 'Europe/Oslo', appUrl, now }).ics)
}

console.log('\n== Google: what a slot sends (calendarEventRules.ts) ==')
{
  const body = R.blockEventBody({ date: '2026-11-12', start_time: '17:00', duration_minutes: 60, title: 'Dentist', busy: true, alerts: [60, 10], show_as: 'free',
    url: 'https://example.com/booking', travel_minutes: 30 }, { done: false, timeZone: 'Europe/Oslo' })
  eq([body.transparency, body.reminders, 'url' in body || 'description' in body || 'source' in body],
    ['transparent', { useDefault: false, overrides: [{ method: 'popup', minutes: 60 }, { method: 'popup', minutes: 10 }] }, false],
    'Google gets Show As and the reminders; no link (Google has no URL field and the app writes no description for its items) and no travel time')
}

console.log('\n== The read-back from the iPhone (icloud-calendar) ==')
{
  const src = fs.readFileSync(path.join(__dirname, '../supabase/functions/icloud-calendar/index.ts'), 'utf8')
  const { transform } = require('sucrase')
  const pure = src.slice(src.indexOf('// <icloud-pure>'), src.indexOf('// </icloud-pure>'))
  const X = new Function(`${transform(pure.replace(/^export /gm, ''), { transforms: ['typescript'] }).code}\nreturn { alarmToken, masterAlarms, fieldsChangeOf, isDayLink, travelOf, GUARD_REFUSALS, slotEvent }`)()
  eq([X.alarmToken(['ACTION:DISPLAY', 'TRIGGER:-PT1H']), X.alarmToken(['TRIGGER:-P1D']), X.alarmToken(['TRIGGER;RELATED=START:PT0S']), X.alarmToken(['TRIGGER:PT540M']),
      X.alarmToken(['ACTION:NONE', 'TRIGGER;VALUE=DATE-TIME:19760401T005545Z']), X.alarmToken(['TRIGGER;VALUE=DATE-TIME:20261112T080000Z']),
      X.alarmToken(['TRIGGER;RELATED=END:-PT5M']), X.alarmToken(['TRIGGER:-PT30S']), X.alarmToken(['TRIGGER:soon']), X.alarmToken(['ACTION:DISPLAY'])],
    ['-60', '-1440', '0', '540', 'NONE', null, null, null, null, null],
    'alarms read as minutes from the start (an hour, a day, at the time, 09:00); Apple\'s marker as none; an absolute time, one from the end, seconds, junk: unreadable')
  const uid = 'lasci-slot-2c5e1b9a-4d0f-4a3b-9e7c-1f2a3b4c5d6e@lasciviens.github.io'
  // Edited as iCloud would hand it back: the parser unfolds lines, so the tests edit the unfolded text.
  const mineEvent = { ics: unfold(slot({ url: null }).ics) }
  const row = { alerts: null, url: null, travel_minutes: null, place: null }
  eq(X.fieldsChangeOf(mineEvent.ics, uid, row, work10, look, true, appUrl), { showAs: 'busy' },
    "the app's own event (the area's alert, the day link, nothing for travel) reads as no change of its fields")
  const edited = mineEvent.ics.replace('TRIGGER:-PT10M', 'TRIGGER:-PT30M\r\nEND:VALARM\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-P1D')
    .replace(/URL;VALUE=URI:[^\r]*/, 'URL;VALUE=URI:https://example.com/from-iphone').replace('TRANSP:OPAQUE', 'TRANSP:TRANSPARENT\r\nX-APPLE-TRAVEL-DURATION;VALUE=DURATION:PT15M')
  eq(X.fieldsChangeOf(edited, uid, row, work10, look, true, appUrl), { showAs: 'free', alerts: [30, 1440], url: 'https://example.com/from-iphone', travelMinutes: 15 },
    'two alerts, a link, Free and a travel time set on the iPhone come back, in the app\'s own terms')
  const hostile = mineEvent.ics.replace('TRIGGER:-PT10M', 'TRIGGER:-PT45M').replace(/URL;VALUE=URI:[^\r]*/, 'URL;VALUE=URI:http://example.com/x')
    .replace('TRANSP:OPAQUE', 'TRANSP:OPAQUE\r\nX-APPLE-TRAVEL-DURATION;VALUE=DURATION:PT45M')
  eq(X.fieldsChangeOf(hostile, uid, row, work10, look, true, appUrl), { showAs: 'busy' },
    'an alert off Apple\'s list, an http link, a travel time off the list: left out (never applied, never guessed)')
  const three = mineEvent.ics.replace('TRIGGER:-PT10M', 'TRIGGER:-PT5M\r\nEND:VALARM\r\nBEGIN:VALARM\r\nTRIGGER:-PT10M\r\nEND:VALARM\r\nBEGIN:VALARM\r\nTRIGGER:-PT15M')
  eq('alerts' in X.fieldsChangeOf(three, uid, row, work10, look, true, appUrl), false, 'three alerts (a Mac can) are left out')
  const own = { ics: unfold(slot({ alerts: [60], url: 'https://example.com/a', travel_minutes: 30 }).ics) }
  const ownRow = { alerts: [60], url: 'https://example.com/a', travel_minutes: 30, place: null }
  eq(X.fieldsChangeOf(own.ics, uid, ownRow, work10, look, true, appUrl), { showAs: 'busy' }, 'an item\'s own fields as the app wrote them: no change')
  const removed = own.ics.replace(/BEGIN:VALARM[\s\S]*?END:VALARM\r\n/, '').replace(/URL;VALUE=URI:[^\r]*\r\n/, '').replace('X-APPLE-TRAVEL-DURATION;VALUE=DURATION:PT30M\r\n', '')
  eq(X.fieldsChangeOf(removed, uid, ownRow, work10, look, true, appUrl), { showAs: 'busy', alerts: [], url: null, travelMinutes: 0 },
    'its alert, link and travel time removed on the iPhone: none, none of its own, none')
  eq([X.isDayLink('https://lasciviens.github.io/Project_Daily/#/daily?date=2026-11-12', appUrl), X.isDayLink('https://evil.example/#/daily?date=2026-11-12', appUrl),
      X.isDayLink('https://lasciviens.github.io/Project_Daily/#/daily?date=2026-11-12&x=1', appUrl)],
    [true, false, false], 'the app\'s day link is recognised only exactly as the app builds it (never startsWith)')
  const allDay = { ics: unfold(slot({ start_time: null, alerts: [1440] }).ics) }
  eq(X.fieldsChangeOf(allDay.ics.replace('TRIGGER:-PT900M', 'TRIGGER:-PT2340M'), uid, { alerts: [1440] }, work10, look, false, appUrl).alerts, [2880],
    'an all-day event\'s alert moved to 2 days before comes back as 2880')
  eq(['An event alert is not one the app offers — not written', 'An event travel time is not one the app offers — not written',
    'An event link is not a web address the app takes — not written', 'A repeat rule is not one the app builds — not written'].every(g => X.GUARD_REFUSALS.includes(g)), true,
    "the new guards' texts reach the card and the save's warning (sendFailureText's allow-list)")
  const drainOne = src.slice(src.indexOf('async function drainOne'), src.indexOf('async function openCreds'))
  eq(/time_zone, place, alerts, show_as, url, travel_minutes'\)/.test(drainOne) && /place, alerts, show_as, url, travel_minutes, repeat_until, repeat_count'\)/.test(drainOne), true,
    'the drain reads every field of a slot and a plan (the event is built from the row as it is)')
  const rb = src.slice(src.indexOf('async function readBackArea'), src.indexOf('async function stillLinked'))
  eq(/fieldsChangeOf\(item\.ics, uid, fieldRows\.get\(keyOf\(x\)\) \?\? \{\}, conf, look, timed, APP_URL\)/.test(rb) && /'days', 'changed'\]/.test(rb), true,
    'the read-back sends only the fields that differ from what the app wrote, and counts a field change as applied')
}

console.log('\n== The sheet: what it may send (itemCalendarFields, planForm, itemRules) ==')
{
  const ok = u => { const r = F.cleanItemUrl(u); return 'url' in r ? r.url : `problem: ${r.problem}` }
  eq([ok('example.com/x'), ok(' https://Example.COM/a b '), ok('https://københavn.example/'), ok('https://example.com/a|b^c[d]'), ok('https://example.com/%20%zz'), ok(''), ok(null)],
    ['https://example.com/x', 'https://example.com/a%20b', 'https://xn--kbenhavn-54a.example/', 'https://example.com/a%7Cb%5Ec%5Bd%5D', 'https://example.com/%20%25zz', null, null],
    'a typed link: https added to a bare host, the host in lower case and punycode, a space and odd characters percent-encoded')
  eq([ok('http://example.com'), ok('javascript:alert(1)'), ok('https://user:pw@example.com'), ok('https://example.com/\r\nX:1'), ok(`https://example.com/${'a'.repeat(2040)}`), ok('https://[::1]/')],
    ['problem: Only https:// links', 'problem: Only https:// links', 'problem: A link with a user name or password is not taken', 'problem: A link is one line',
      'problem: A link is at most 2048 characters', "problem: That link can't be used"], '…and why one can\'t be used')
  const samples = ['example.com', 'https://a.example/ü?q=ö#x', 'https://example.com/"q"', 'https://example.com/<b>', 'https://example.com/`x`', 'https://example.com/{a}', 'https://example.com/\\x',
    'https://example.com/a%2', 'https://EXAMPLE.com:443/', 'https://example.com:8443/x?y=1&z=2#f', 'https://xn--e1afmkfd.example/']
  eq(samples.map(F.cleanItemUrl).every(r => !('url' in r) || (r.url === null || (R.ITEM_URL.test(r.url) && r.url.length <= 2048))), true,
    'every link cleanItemUrl answers passes ITEM_URL (= the database\'s item_url_ok)')
  eq([F.alertsOf({ alert: 'default', second: 5 }), F.alertsOf({ alert: 'none', second: 5 }), F.alertsOf({ alert: 60, second: 10 }), F.alertsOf({ alert: 60, second: 60 }), F.alertsOf({ alert: 60, second: null })],
    [null, [], [60, 10], [60], [60]], 'the two rows → what is saved: the area\'s own, none, two in order, never the same twice')
  eq([F.alertRows(null), F.alertRows([]), F.alertRows([30, 5]), F.alertRows([-5])], [{ alert: 'default', second: null }, { alert: 'none', second: null }, { alert: 30, second: 5 }, { alert: 'default', second: null }],
    '…and back (a hostile stored value reads as the area\'s own)')
  eq([F.alertLabel(0, false), F.alertLabel(120, false), F.alertLabel(10080, false), F.alertLabel(0, true), F.alertLabel(1440, true), F.alertLabel(10080, true)],
    ['At time of event', '2 hours before', '1 week before', 'On the day (09:00)', '1 day before (09:00)', 'A week before (09:00)'], 'alert labels (24 h times)')
  eq([F.travelLabel(null), F.travelLabel(null, false), F.travelLabel(0), F.travelLabel(90), F.travelLabel(120), F.travelLabel(15)],
    ['Automatic', 'Automatic (needs a place on the map)', 'None', '1 hour 30 minutes', '2 hours', '15 minutes'], 'travel labels')
  eq([F.repeatEndProblem({ until: '2026-11-01' }, '2026-11-03'), F.repeatEndProblem({ until: '2026-11-03' }, '2026-11-03'), F.repeatEndProblem({ count: 0 }, '2026-11-03'),
      F.repeatEndProblem({ count: 1000 }, null), F.repeatEndProblem({ until: '03.11.2026' }, null), F.repeatEndProblem(null, '2026-11-03')],
    ['The repeat ends before it starts', null, 'After 1 to 999 times', 'After 1 to 999 times', 'Pick the day it ends', null], 'End Repeat problems (the database refuses the same)')
  eq([F.repeatEndLabel(null), F.repeatEndLabel({ until: '2026-12-31' }), F.repeatEndLabel({ count: 4 }, { days_of_week: [2, 4], effective_from: '2026-11-03' })],
    ['Never', 'On 31.12.2026', 'After 4 times · last 12.11.2026'], 'End Repeat labels (DD.MM.YYYY)')
  // Rows → the item: only what the rows say.
  const it = I.itemFromRows(null, { id: 'b1', date: '2026-11-12', title: 'Dentist', start_time: '17:00:00', duration_minutes: 60, category: 'daily', notes: null,
    source_type: null, source_id: null, google_calendar_event_id: null, alerts: [60], show_as: 'free', url: 'https://example.com/a', travel_minutes: 0 })
  eq([it.alerts, it.showAs, it.url, it.travelMinutes, 'repeatEnd' in it], [[60], 'free', 'https://example.com/a', 0, false], 'a slot\'s fields read as the item\'s')
  const old = I.itemFromRows(null, { id: 'b1', date: '2026-11-12', title: 'x', start_time: null, duration_minutes: 60, category: 'daily', notes: null, source_type: null, source_id: null, google_calendar_event_id: null })
  eq(['alerts' in old, 'url' in old, 'showAs' in old, 'travelMinutes' in old], [false, false, false, false], 'a row without the columns (before 193) leaves them unknown (the save keeps them)')
  const pl = I.itemFromRows(null, null, { id: 'p1', title: 'Run', category: 'daily', days_of_week: [2], effective_from: '2026-11-03', repeat_kind: 'weekly', repeat_interval: null,
    repeat_unit: null, repeat_dates: null, google_calendar_event_id: null, start_time: '07:00', end_time: '07:45', repeat_until: '2026-11-24', repeat_count: 4, url: 'javascript:x' })
  eq([pl.repeatEnd, pl.url], [{ count: 4 }, null], 'a repeat\'s End Repeat reads as its count; a stored value the writers refuse reads as none')
  // The form: a new item sends them; an edit only what it knew or the owner changed.
  const seed = { mode: 'schedule', today: '2026-11-10', nextTime: '10:00', defaults: { date: '2026-11-12', startTime: '17:00' } }
  const f0 = P.buildInitialForm(seed)
  const f1 = { ...f0, ...P.withCalendarField(f0, 'alerts', [60, 10]), url: 'example.com/booking' }
  const f2 = { ...f1, ...P.withCalendarField(f1, 'url', f1.url) }
  const input = P.inputFromForm(f2, { googleConnected: false, today: '2026-11-10' })
  eq([input.alerts, input.url, input.showAs, input.travelMinutes, 'repeatEnd' in input], [[60, 10], 'https://example.com/booking', null, null, false],
    'a new item sends every field (the link cleaned); End Repeat only with a repeat')
  const edit = { taskId: 't1', blockId: 'b1', scheduleBlockId: null, title: 'Dentist', domain: 'personal', priority: 'medium', date: '2026-11-12', time: '17:00', durationMinutes: 60, google: 'none' }
  const fe = P.buildInitialForm({ ...seed, item: edit })
  const ie = P.inputFromForm({ ...fe, ...P.withCalendarField(fe, 'travelMinutes', 15) }, { item: edit, googleConnected: false, today: '2026-11-10' })
  eq([ie.travelMinutes, 'alerts' in ie, 'url' in ie, 'showAs' in ie], [15, false, false, false], 'an edit opened without the columns sends only what the owner changed (never a null over a value it wasn\'t told about)')
  const known = { ...edit, alerts: [30], url: 'https://example.com/a', showAs: null, travelMinutes: null }
  const ik = P.inputFromForm(P.buildInitialForm({ ...seed, item: known }), { item: known, googleConnected: false, today: '2026-11-10' })
  eq([ik.alerts, ik.url, ik.showAs, ik.travelMinutes], [[30], 'https://example.com/a', null, null], 'an edit that knew them sends them as they are')
  const bad = { ...f0, ...P.withCalendarField(f0, 'url', 'https://example.com/\r\nX:1') }
  eq([P.calendarFieldsProblem(bad, { today: '2026-11-10' }), P.inputFromForm(bad, { googleConnected: false, today: '2026-11-10' }).url],
    ['A link is one line', 'https://example.com/\r\nX:1'], 'a link that can\'t be used is said first; if saved anyway it goes as typed so the database refuses it with its message — never dropped silently')
  const rep = { ...f0, recurrence: 'weekly', weeklyDays: [2], date: '2026-11-03', ...P.withCalendarField(f0, 'repeatEnd', { until: '2026-11-01' }) }
  eq([P.calendarFieldsProblem(rep, { today: '2026-11-02' }), P.inputFromForm(rep, { googleConnected: false, today: '2026-11-02' }).repeatEnd],
    ['The repeat ends before it starts', { until: '2026-11-01' }], 'a repeat whose End Repeat is before its start says so; the rule\'s save carries End Repeat')
  const repDay = P.inputFromForm({ ...rep, scope: 'day' }, { item: { ...edit, scheduleBlockId: 'p1', repeat: { kind: 'weekly', daysOfWeek: [2], startsOn: '2026-11-03' }, repeatEnd: null },
    occurrenceDate: '2026-11-10', googleConnected: false, today: '2026-11-02' })
  eq('repeatEnd' in repDay, false, '"This day" never sends End Repeat')
  eq([F.sendsCalendarFields({ url: null }), F.sendsCalendarFields({ title: 'x' })], [true, false], 'a database without 193 is noticed only when the save sent a field')
}

console.log(`\nverify-item-calendar-fields: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
