#!/usr/bin/env node
/*
 * Verification — Transit's Routes tab: the best trip's route on the left, trips
 * on other lines or stops on the right (src/features/home/components/ruter/tripRoutes.ts),
 * how many trips a list shows, and a stop chip's compact "Tw" direction with its
 * platform apart (transitUtils.shortToward / stopChipLine).
 * Against the REAL modules via sucrase (no unit-test runner by convention).
 *
 * Run: node scripts/verify-trip-routes.cjs
 */
require('sucrase/register')
const fs = require('fs')
const path = require('path')

const { routeSignature, groupTripsByRoute, tripKey, tripStep } = require('../src/features/home/components/ruter/tripRoutes')
const { shortToward, stopChipLine } = require('../src/features/home/components/ruter/transitUtils')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`) }
}

const walk = (from, to, min = 3) => ({ mode: 'foot', duration: min * 60, distance: 200, from, to })
const ride = (mode, line, from, to) => ({ mode, line, duration: 600, distance: 4000, from, to })
const trip = (name, legs) => ({ name, duration: 900, walkDistance: 400, departure: '2026-11-26T12:00:00+01:00', arrival: '2026-11-26T12:15:00+01:00', legs })

const metro5   = (name, walkMin = 3) => trip(name, [walk('Origin', 'Jernbanetorget', walkMin), ride('metro', '5', 'Jernbanetorget', 'Økern'), walk('Økern', 'Destination')])
const bus31    = name => trip(name, [walk('Origin', 'Jernbanetorget'), ride('bus', '31', 'Jernbanetorget', 'Økern'), walk('Økern', 'Destination')])
const metro5Ss = name => trip(name, [walk('Origin', 'Stortinget'), ride('metro', '5', 'Stortinget', 'Økern'), walk('Økern', 'Destination')])
const change   = name => trip(name, [ride('tram', '17', 'Jernbanetorget', 'Carl Berners plass'), ride('bus', '31', 'Carl Berners plass', 'Økern')])

console.log('\n1 · A route signature: the rides in order, line + on → off; walking and times don\'t count')
check('one ride', routeSignature(metro5('a')) === '5:Jernbanetorget>Økern', routeSignature(metro5('a')))
check('a change keeps the order', routeSignature(change('a')) === '17:Jernbanetorget>Carl Berners plass | 31:Carl Berners plass>Økern', routeSignature(change('a')))
check('a longer walk to the same stop is the same route', routeSignature(metro5('a', 2)) === routeSignature(metro5('b', 9)))
check('another time is the same route', routeSignature({ ...metro5('a'), departure: '2026-11-26T13:00:00+01:00' }) === routeSignature(metro5('b')))
check('another line on the same stops is another route', routeSignature(bus31('a')) !== routeSignature(metro5('a')))
check('the same line from another stop is another route', routeSignature(metro5Ss('a')) !== routeSignature(metro5('a')))
check('a ride without a line code is told by its mode', routeSignature(trip('x', [ride('rail', undefined, 'Oslo S', 'Lillestrøm')])) === 'rail:Oslo S>Lillestrøm')
check('walking only is "walk"', routeSignature(trip('w', [walk('Origin', 'Destination', 20)])) === 'walk')

console.log('\n2 · Grouping: the best trip\'s route on the left, every other route on the right')
{
  const trips = [metro5('m1'), bus31('b1'), metro5('m2', 6), metro5Ss('s1'), metro5('m3'), bus31('b2'), change('c1')]
  const { best, other } = groupTripsByRoute(trips)
  check('the first trip is the best and leads the left column', best[0] === trips[0])
  check('the left column holds only the best trip\'s route, in Entur\'s order', best.map(t => t.name).join() === 'm1,m2,m3', best.map(t => t.name))
  check('the right column holds every other route, in Entur\'s order (bus, another stop, a change)', other.map(t => t.name).join() === 'b1,s1,b2,c1', other.map(t => t.name))
  check('no trip is lost or shown twice', best.length + other.length === trips.length && new Set([...best, ...other]).size === trips.length)
}
{
  const { best, other } = groupTripsByRoute([metro5('m1'), metro5('m2'), metro5('m3')])
  check('one route only → nothing on the right', best.length === 3 && other.length === 0)
}
{
  const { best, other } = groupTripsByRoute([])
  check('no trips → two empty columns', best.length === 0 && other.length === 0)
}
{
  const { best, other } = groupTripsByRoute([bus31('b1'), metro5('m1')])
  check('the best trip decides the left column, whatever its line', best[0].name === 'b1' && other[0].name === 'm1')
}

console.log('\n2b · How many trips a list shows (and each "Show more" adds)')
check('two columns: 3 a column', tripStep(true, true) === 3)
check('two columns, no other route: the best route fills both — 6', tripStep(true, false) === 6)
check('one column with other routes: 2 a group, so the first Alternative is near', tripStep(false, true) === 2)
check('one column, the best route only: 3', tripStep(false, false) === 3)

console.log('\n2c · A trip\'s key is the trip itself, never its place in a list')
{
  const a = metro5('a'), b = { ...metro5('b'), departure: '2026-11-26T12:15:00+01:00', arrival: '2026-11-26T12:30:00+01:00' }
  check('the same trip gives the same key', tripKey(a) === tripKey(metro5('again')))
  check('another time gives another key', tripKey(a) !== tripKey(b))
  check('another route at the same times gives another key', tripKey(a) !== tripKey(bus31('x')))
}

console.log('\n3 · A stop chip\'s direction in the owner\'s short form: "Toward" → "Tw"')
check('"Toward Økern, Oslo" → "Tw Økern, Oslo" (æøå kept)', shortToward('Toward Økern, Oslo') === 'Tw Økern, Oslo', shortToward('Toward Økern, Oslo'))
check('after a platform: "Platform D · Toward Grorud T" → "Platform D · Tw Grorud T"', shortToward('Platform D · Toward Grorud T') === 'Platform D · Tw Grorud T')
check('a description without "Toward" is left as it is', shortToward('Mot sentrum') === 'Mot sentrum')
check('only the whole word: "Towards" stays', shortToward('Towards Bergen') === 'Towards Bergen')
const line = t => JSON.stringify(stopChipLine(t))
check('"Platform B · Toward Økern, Oslo S" → the direction alone + badge B', line('Platform B · Toward Økern, Oslo S') === JSON.stringify({ direction: 'Tw Økern, Oslo S', platform: 'B' }), line('Platform B · Toward Økern, Oslo S'))
check('a quay description before the direction is left out of the chip', line('Mot sentrum · Toward Lillestrøm, Lørenskog') === JSON.stringify({ direction: 'Tw Lillestrøm, Lørenskog', platform: null }), line('Mot sentrum · Toward Lillestrøm, Lørenskog'))
check('a description alone is the direction', line('Mot sentrum') === JSON.stringify({ direction: 'Mot sentrum', platform: null }))
check('"Platform 3" alone → only the badge', line('Platform 3') === JSON.stringify({ direction: null, platform: '3' }))
check('nothing saved → nothing shown', line(null) === JSON.stringify({ direction: null, platform: null }) && line('') === line(null))

console.log('\n4 · The screen uses it')
{
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
  const tab = read('src/features/home/components/ruter/RoutesTab.tsx')
  const card = read('src/features/home/components/ruter/TripCard.tsx')
  const queries = read('src/features/home/hooks/useTransitQueries.ts')
  check('RoutesTab groups the trips with groupTripsByRoute', /groupTripsByRoute\(/.test(tab) && tab.includes("from './tripRoutes'"))
  check('the left column\'s first trip is tagged Best, the right column\'s first Alternative', /tag=\{i === 0 \? 'Best'/.test(tab) && /tag=\{i === 0 \? 'Alternative'/.test(tab))
  check('each column has its own "Show more", by tripStep', /setBestSteps\(/.test(tab) && /setOtherSteps\(/.test(tab) && /tripStep\(twoUp, hasOther\)/.test(tab))
  check('the two columns come from the tab\'s own width alone (@container, 44rem): a sideways phone too', /@container/.test(tab) && /@\[44rem\]:grid-cols-2/.test(tab) && !/useBreakpoint/.test(tab) && /useElementWidthRem\(\)/.test(tab) && />= 44\b/.test(tab))
  check('no "Other routes" heading: the first Alternative tag is the label', !/>Other routes</.test(tab))
  check('trip cards are keyed by the trip, not the index', /<TripCard key=\{tripKey\(trip\)\}/.test(tab) && !/<TripCard key=\{i\}/.test(tab))
  check('no other route: the best route\'s trips fill both columns', /if \(!hasOther\) return/.test(tab))
  check('no viewport sm:/lg: layout in RoutesTab', !/\b(sm|md|lg|xl):(max-w|grid-cols|ml-auto|flex-row)/.test(tab))
  check('stop chips show the direction alone, cut with <Truncate>, the platform as a badge, the full text as tooltip and name', /stopChipLine\(s\.quay_description\)/.test(tab) && /<Truncate fullText=\{s\.quay_description[^}]*\}[^>]*>\{direction\}<\/Truncate>/.test(tab) && /\{platform\}<\/span>/.test(tab) && /title=\{tip\}/.test(tab) && /aria-label=\{tip\}/.test(tab))
  check('stop chips: two a row, three when wide (no empty track beside three)', /grid grid-cols-2 gap-2 @\[40rem\]:grid-cols-3/.test(tab))
  check('TripCard takes one tag (Best | Alternative) in the Best tag\'s style', /tag\?: 'Best' \| 'Alternative'/.test(card) && !/isBest/.test(card + tab))
  check('trips are asked for in one count shared with Home\'s card', /const TRIP_COUNT = \d+/.test(queries) && /fetchTrips\([^)]*TRIP_COUNT/.test(queries))
  const n = Number((queries.match(/const TRIP_COUNT = (\d+)/) || [])[1])
  check('a modest count (5–10): enough for two columns, not a slow answer', n >= 5 && n <= 10, n)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
