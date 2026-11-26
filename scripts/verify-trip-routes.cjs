#!/usr/bin/env node
/*
 * Verification — Transit's Routes tab: the best trip's route on the left, trips
 * on other lines or stops on the right (src/features/home/components/ruter/tripRoutes.ts),
 * and the compact "Tw" direction on a stop chip (transitUtils.shortToward).
 * Against the REAL modules via sucrase (no unit-test runner by convention).
 *
 * Run: node scripts/verify-trip-routes.cjs
 */
require('sucrase/register')
const fs = require('fs')
const path = require('path')

const { routeSignature, groupTripsByRoute, TRIPS_PER_STEP } = require('../src/features/home/components/ruter/tripRoutes')
const { shortToward } = require('../src/features/home/components/ruter/transitUtils')

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
check('a column starts with a few trips and "Show more" adds as many', Number.isInteger(TRIPS_PER_STEP) && TRIPS_PER_STEP >= 2 && TRIPS_PER_STEP <= 4, TRIPS_PER_STEP)

console.log('\n3 · A stop chip\'s direction in the owner\'s short form: "Toward" → "Tw"')
check('"Toward Økern, Oslo" → "Tw Økern, Oslo" (æøå kept)', shortToward('Toward Økern, Oslo') === 'Tw Økern, Oslo', shortToward('Toward Økern, Oslo'))
check('after a platform: "Platform D · Toward Grorud T" → "Platform D · Tw Grorud T"', shortToward('Platform D · Toward Grorud T') === 'Platform D · Tw Grorud T')
check('a description without "Toward" is left as it is', shortToward('Mot sentrum') === 'Mot sentrum')
check('only the whole word: "Towards" stays', shortToward('Towards Bergen') === 'Towards Bergen')

console.log('\n4 · The screen uses it')
{
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
  const tab = read('src/features/home/components/ruter/RoutesTab.tsx')
  const card = read('src/features/home/components/ruter/TripCard.tsx')
  const queries = read('src/features/home/hooks/useTransitQueries.ts')
  check('RoutesTab groups the trips with groupTripsByRoute', /groupTripsByRoute\(/.test(tab) && tab.includes("from './tripRoutes'"))
  check('the left column\'s first trip is tagged Best, the right column\'s first Alternative', /tag=\{i === 0 \? 'Best'/.test(tab) && /tag=\{i === 0 \? 'Alternative'/.test(tab))
  check('each column has its own "Show more"', /setShownBest\(/.test(tab) && /setShownOther\(/.test(tab))
  check('the two columns come from the tab\'s own width, never on a phone (sideways too)', /@container/.test(tab) && /useBreakpoint\(\) !== 'phone'/.test(tab) && /wide && '@\[44rem\]:grid-cols-2'/.test(tab))
  check('no viewport sm:/lg: layout in RoutesTab', !/\b(sm|md|lg|xl):(max-w|grid-cols|ml-auto|flex-row)/.test(tab))
  check('stop chips shorten "Toward" and cut the rest with <Truncate>', /<Truncate fullText=\{s\.quay_description\}[^>]*>\{shortToward\(s\.quay_description\)\}<\/Truncate>/.test(tab))
  check('TripCard takes one tag (Best | Alternative) in the Best tag\'s style', /tag\?: 'Best' \| 'Alternative'/.test(card) && !/isBest/.test(card + tab))
  check('trips are asked for in one count shared with Home\'s card', /const TRIP_COUNT = \d+/.test(queries) && /fetchTrips\([^)]*TRIP_COUNT/.test(queries))
  const n = Number((queries.match(/const TRIP_COUNT = (\d+)/) || [])[1])
  check('a modest count (5–10): enough for two columns, not a slow answer', n >= 5 && n <= 10, n)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
