#!/usr/bin/env node
/*
 * Verification — an item's place (migration 186), against the REAL modules via sucrase:
 *   1. src/features/items/itemPlace.ts: a place from EnTur, typed or saved; cleaned to what the database stores;
 *      isStorablePlace = place_ok's rule (the same cases as scripts/db-tests/item-places, P1);
 *   2. calendarEventRules: a row's place as the writers read it (eventPlace), Google's `location` on a slot and a
 *      series — and none sent when there is no place (a place typed in Google Calendar stays);
 *   3. icloudEvents: LOCATION, Apple's map pin in the form the owner's Apple check kept (29.10.2026) and the travel
 *      advisory for Time to Leave; a quote, a line break or a stray coordinate never reaches a line;
 *   4. the functions read the place (icloud-calendar's drain, google-tasks-sync's push).
 *
 *   Run:  node scripts/verify-item-places.cjs
 */
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const P = require('../src/features/items/itemPlace')
const R = require('../src/features/calendar/calendarEventRules')
const S = require('../src/features/calendar/calendarSeries')
const I = require('../src/features/calendar/areas/icloudEvents')

const root = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

console.log('\n1. The browser\'s place')
const stop = { id: 'NSR:StopPlace:58366', name: 'Jernbanetorget', locality: 'Oslo', layer: 'venue', lat: 59.9114711, lon: 10.7500133 }
check('an EnTur stop keeps its name, town, pin and id (coordinates to 6 decimals)',
  eq(P.placeFromGeo(stop), { name: 'Jernbanetorget', locality: 'Oslo', lat: 59.911471, lon: 10.750013, id: 'NSR:StopPlace:58366' }))
check('a typed place is a name, no pin', eq(P.placeFromText('  The   old gym  '), { name: 'The old gym' }))
check('nothing typed is no place', P.placeFromText('   ') === null)
check('a saved address keeps its coordinates; a saved stop has none yet',
  eq(P.placeFromSaved({ stop_id: 'KVE:PostalAddress:0301-1-1', stop_name: 'Karl Johans gate 1', stop_locality: 'Oslo', lat: 59.91, lon: 10.74 }),
    { name: 'Karl Johans gate 1', locality: 'Oslo', lat: 59.91, lon: 10.74, id: 'KVE:PostalAddress:0301-1-1' })
  && eq(P.placeFromSaved({ stop_id: 'NSR:StopPlace:337', stop_name: 'Oslo S', stop_locality: 'Oslo', lat: null, lon: null }),
    { name: 'Oslo S', locality: 'Oslo', id: 'NSR:StopPlace:337' }))
check('a line break, a control character and U+2028 become spaces; 120 characters at most',
  eq(P.cleanPlace({ name: 'Gym\nX-INJECTED:1\u0007\u2028end' }), { name: 'Gym X-INJECTED:1 end' })
  && P.cleanPlace({ name: 'a'.repeat(200) }).name.length === 120)
check('a town equal to the name is left out; a bad id and stray coordinates are dropped',
  eq(P.cleanPlace({ name: 'Oslo', locality: 'oslo', id: 'javascript:alert(1)', lat: 91, lon: 10 }), { name: 'Oslo' })
  && eq(P.cleanPlace({ name: 'X', lat: 59.9 }), { name: 'X' }) && eq(P.cleanPlace({ name: 'X', lat: NaN, lon: 1 }), { name: 'X' }))
check('placeLabel: "name, town"', P.placeLabel({ name: 'Jernbanetorget', locality: 'Oslo' }) === 'Jernbanetorget, Oslo' && P.placeLabel({ name: 'Home' }) === 'Home')
check('placeOfRow: a stored object is read; anything else is no place',
  eq(P.placeOfRow({ name: 'Oslo S', lat: 59.91, lon: 10.75 }), { name: 'Oslo S', lat: 59.91, lon: 10.75 })
  && P.placeOfRow('Oslo S') === null && P.placeOfRow([]) === null && P.placeOfRow({}) === null && P.placeOfRow(null) === null)

// place_ok's cases (scripts/db-tests/item-places/scenarios.sql, P1) — the browser must agree.
const storable = [
  { name: 'Oslo S' },
  { name: 'Oslo S', locality: 'Oslo', lat: 59.910357, lon: 10.752245, id: 'NSR:StopPlace:337' },
  { name: 'Café Løkka – bak', lat: -33.8688, lon: -151.2093 },
  { name: 'Karl Johans gate 1', id: 'KVE:PostalAddress:0301-12345-1' },
  { name: 'Somewhere "quoted"; with, punctuation' },
]
const refused = [
  'Oslo S', [], { title: 'x' }, { name: 'Oslo S', url: 'https://example.com' }, { name: '' }, { name: '   ' }, { name: 5 },
  { name: 'a'.repeat(121) }, { name: 'Oslo S\nX-INJECTED:1' }, { name: 'Oslo S\rX' }, { name: 'Oslo S\u2028X' },
  { name: 'Oslo S', locality: 'b'.repeat(81) }, { name: 'Oslo S', locality: 'Oslo\nX' }, { name: 'Oslo S', lat: 59.9 }, { name: 'Oslo S', lon: 10.7 },
  { name: 'Oslo S', lat: '59.9', lon: 10.7 }, { name: 'Oslo S', lat: 91, lon: 10 }, { name: 'Oslo S', lat: 59, lon: -181 },
  { name: 'Oslo S', id: 'javascript:alert(1)' }, { name: 'Oslo S', id: 'NSR:StopPlace:337 X' },
  { name: 'Oslo S', locality: 'c'.repeat(80), id: 'NSR:StopPlace:' + '9'.repeat(80), lat: 59.9, lon: 10.7, name2: 1 },
]
const badOk = storable.filter(p => !P.isStorablePlace(p))
const badRefused = refused.filter(p => P.isStorablePlace(p))
check('isStorablePlace takes what place_ok takes', badOk.length === 0, JSON.stringify(badOk))
check('…and refuses what place_ok refuses', badRefused.length === 0, JSON.stringify(badRefused))
const odd = ['Gym\n\u2028', 'a'.repeat(500), '  ', 'Oslo"S', 'Tab\there']
check('whatever cleanPlace gives back is storable — the longest place too', odd.every(n => { const c = P.cleanPlace({ name: n, locality: n, lat: 95, lon: 1, id: n }); return c === null || P.isStorablePlace(c) })
  && P.isStorablePlace(P.cleanPlace({ name: 'n'.repeat(130), locality: 'l'.repeat(90), lat: -89.123456, lon: -179.123456, id: 'ABCDEFGHIJ:' + 'S'.repeat(40) + ':' + '9'.repeat(80) })))
check('the id shape is the database\'s (186)', read('supabase/migrations/186_item_places.sql').includes(`(p ->> 'id') !~ '${P.PLACE_ID.source}'`))

console.log('\n2. Google')
check('eventPlace reads a row\'s place; a town equal to the name is dropped; odd values are no place or no pin',
  eq(R.eventPlace({ name: 'Jernbanetorget', locality: 'Oslo', lat: 59.91, lon: 10.75, id: 'NSR:StopPlace:58366' }), { name: 'Jernbanetorget', locality: 'Oslo', lat: 59.91, lon: 10.75 })
  && eq(R.eventPlace({ name: 'Oslo', locality: 'Oslo' }), { name: 'Oslo' }) && R.eventPlace({ name: '' }) === null && R.eventPlace('x') === null
  && eq(R.eventPlace({ name: 'X', lat: 200, lon: 1 }), { name: 'X' }) && eq(R.eventPlace({ name: 'Gym\nBAD' }), { name: 'Gym BAD' }))
const slot = { date: '2026-11-12', start_time: '17:00', duration_minutes: 60, title: 'Gym', busy: true }
const withPlace = R.blockEventBody({ ...slot, place: { name: 'Jernbanetorget', locality: 'Oslo', lat: 59.91, lon: 10.75 } }, { done: false, timeZone: 'Europe/Oslo' })
const noPlace = R.blockEventBody(slot, { done: false, timeZone: 'Europe/Oslo' })
check('a slot with a place: Google\'s location is "name, town"', withPlace.location === 'Jernbanetorget, Oslo')
check('a new event with no place carries no location', !('location' in noPlace))
check('a PATCH of the whole event carries the location; a title push never does',
  R.eventPatchFor(withPlace, 'all').location === 'Jernbanetorget, Oslo' && eq(Object.keys(R.eventPatchFor(withPlace, 'title')), ['summary']))
check('an all-day slot carries it too', R.blockEventBody({ ...slot, start_time: null, place: { name: 'Hytta' } }, { done: false, timeZone: 'Europe/Oslo' }).location === 'Hytta')
const plan = { title: 'Run', start_time: '07:00:00', end_time: '08:00:00', busy: true, days_of_week: [2, 4], effective_from: '2026-11-03',
  repeat_kind: 'weekly', place: { name: 'Frognerparken', locality: 'Oslo', lat: 59.927, lon: 10.702 } }
const series = S.seriesEventFor(plan, { today: '2026-11-02', timeZone: 'Europe/Oslo' })
check('a repeating plan\'s series carries its place; none without one', series.body.location === 'Frognerparken, Oslo'
  && !('location' in S.seriesEventFor({ ...plan, place: null }, { today: '2026-11-02', timeZone: 'Europe/Oslo' }).body))

console.log('\n3. Apple')
check('the map pin in the form the Apple check kept: LOCATION on two lines, X-APPLE-STRUCTURED-LOCATION, the travel advisory',
  eq(I.locationLines({ name: 'Oslo S', locality: 'Oslo', lat: 59.910357, lon: 10.752245 }), [
    'LOCATION:Oslo S\\nOslo',
    'X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-ADDRESS="Oslo";X-APPLE-RADIUS=70;X-TITLE="Oslo S":geo:59.910357,10.752245',
    'X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC',
  ]))
check('a typed place: LOCATION only, no pin', eq(I.locationLines({ name: 'The old gym' }), ['LOCATION:The old gym']))
check('no place: nothing', eq(I.locationLines(null), []))
const evil = I.locationLines({ name: 'Gym"; X-EVIL=1:geo:0,0\nBAD', locality: 'Oslo, "Norway";', lat: -33.8688, lon: -151.2093 })
check('a quote, : ; = and a line break never reach Apple\'s quoted parameters (an allow-list, not escaping)',
  evil[1] === 'X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-ADDRESS="Oslo, Norway";X-APPLE-RADIUS=70;X-TITLE="Gym X-EVIL 1 geo 0,0 BAD":geo:-33.868800,-151.209300'
  && /^LOCATION:Gym"\\; X-EVIL=1:geo:0\\,0\\nBAD\\nOslo\\, "Norway"\\;$/.test(evil[0]), JSON.stringify(evil))
check('coordinates out of range, missing or not numbers: no pin', eq(I.locationLines({ name: 'X', lat: 91, lon: 0 }), ['LOCATION:X'])
  && eq(I.locationLines({ name: 'X', lat: 59 }), ['LOCATION:X']) && eq(I.locationLines({ name: 'X', lat: '59', lon: '10' }), ['LOCATION:X'])
  && eq(I.locationLines({ name: 'X', lat: Infinity, lon: 0 }), ['LOCATION:X']))
const marked = I.locationLines({ name: '\u0301Gym', locality: '\u0301Oslo', lat: 59.9, lon: 10.7 })
check('a combining mark first never joins a quote (it is dropped from the pin\'s text)', marked[1] === 'X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-ADDRESS="Oslo";X-APPLE-RADIUS=70;X-TITLE="Gym":geo:59.900000,10.700000', JSON.stringify(marked))
check('a "prepend" letter that would join the closing quote: no pin', I.locationLines({ name: 'Gym\u0D4E', lat: 59.9, lon: 10.7 }).length === 1)
check('a name with nothing allowed in a pin keeps LOCATION and loses the pin', eq(I.locationLines({ name: '"""', lat: 1, lon: 1 }), ['LOCATION:"""']))
const area = { key: 'personal', name: 'Lasci · Personal', emoji: '', color: '#3B82F6', alertMinutes: null, app: 'apple', enabled: true }
const look = { notes: 'link', allDayAlert: null }
const now = new Date('2026-11-03T10:00:00Z')
const ev = I.slotEvent({ id: '00000000-0000-0000-0000-0000000000aa', ...slot, place: { name: 'Jernbanetorget', locality: 'Oslo', lat: 59.9114711, lon: 10.7500133 } },
  { done: false, area, look, timeZone: 'Europe/Oslo', appUrl: 'https://example.com/app/', now })
const unfolded = ev.ics.replace(/\r\n /g, '')
check('a slot\'s event carries LOCATION and the pin (folded at 75 octets, read back whole)',
  unfolded.includes('\r\nLOCATION:Jernbanetorget\\nOslo\r\n')
  && unfolded.includes('X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-ADDRESS="Oslo";X-APPLE-RADIUS=70;X-TITLE="Jernbanetorget":geo:59.911471,10.750013\r\n')
  && ev.ics.split('\r\n').every(l => new TextEncoder().encode(l).length <= 75))
const pev = I.planEvent({ id: '00000000-0000-0000-0000-0000000000bb', ...plan, notes: null, icloud_from: '2026-11-03' },
  { area, look, today: '2026-11-02', timeZone: 'Europe/Oslo', appUrl: 'https://example.com/app/', now })
check('a repeat\'s series carries its place', pev.ics.replace(/\r\n /g, '').includes('LOCATION:Frognerparken\\nOslo') && pev.ics.includes('X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC'))
const bare = I.slotEvent({ id: '00000000-0000-0000-0000-0000000000cc', ...slot }, { done: false, area, look, timeZone: 'Europe/Oslo', appUrl: 'https://example.com/app/', now })
check('an item with no place: no LOCATION line', !bare.ics.includes('LOCATION'))
check('a stored place with a line break still writes the event (cleaned on read)', !!I.slotEvent({ id: '00000000-0000-0000-0000-0000000000dd', ...slot, place: { name: 'Gym\nX-INJECTED:1' } },
  { done: false, area, look, timeZone: 'Europe/Oslo', appUrl: 'https://example.com/app/', now }).ics.match(/\r\nLOCATION:Gym X-INJECTED:1\r\n/))

check('a whole-event PATCH takes a place off Google (location null); a title PATCH never touches it',
  R.eventPatchFor(noPlace, 'all').location === null && R.eventPatchFor(withPlace, 'all').location === 'Jernbanetorget, Oslo'
  && !('location' in R.eventPatchFor(noPlace, 'title')) && !('location' in noPlace))
check('a series update does the same', R.fullEventPatch(S.seriesEventFor({ ...plan, place: null }, { today: '2026-11-02', timeZone: 'Europe/Oslo' }).body).location === null)
const linkSrc = read('src/features/calendar/api/linkBlockCalendarEvent.ts')
check('a new Google event (the browser\'s create) carries the slot\'s place', /busy: block\.busy,\s*place: block\.place,/.test(linkSrc))
check('a series update goes through fullEventPatch', (read('src/features/calendar/api/scheduleSeriesCalendar.ts').match(/fullEventPatch\(plan\.body\)/g) || []).length === 2)

console.log('\n4. The functions read the place')
const icloud = read('supabase/functions/icloud-calendar/index.ts')
// (193 reads its calendar fields after the place.)
check('icloud-calendar\'s drain reads a slot\'s and a plan\'s place', (icloud.match(/icloud_etag, time_zone, place(, alerts, show_as, url, travel_minutes)?'\)/g) || []).length === 1
  && (icloud.match(/icloud_horizon, time_zone, place(, alerts, show_as, url, travel_minutes, repeat_until, repeat_count)?'\)/g) || []).length === 1)
check('google-tasks-sync\'s push reads a slot\'s place', read('supabase/functions/google-tasks-sync/index.ts').includes(".select('id, date, start_time, duration_minutes, title, busy, time_zone, place, show_as, alerts, task:tasks(status)')"))

console.log(`\nverify-item-places: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
