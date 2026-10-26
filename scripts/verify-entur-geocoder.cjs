#!/usr/bin/env node
/*
 * Verification — EnTur's place search, v3 (26.10.2026; v1/v2 are deprecated).
 *
 * 1. The query: v3's names (q, limit, countries) — lowercase "no", because
 *    "NOR" matches nothing (checked live) — and the layers that cover v1's
 *    venue + address.
 * 2. The parser on the live answers saved in scripts/fixtures/entur/: a stop
 *    keeps its NSR id, name, town and stop types; places that aren't stops
 *    keep their coordinates; anything odd is skipped, never thrown.
 * 3. ai-proxy carries the same <entur-geocoder> block, verbatim, and nothing
 *    calls the old v1 address any more.
 *
 *   Run:  node scripts/verify-entur-geocoder.cjs
 */
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const G = require('../src/features/home/api/enturGeocoder.ts')

let passed = 0
let failed = 0
const check = (name, cond, detail) => {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`) }
}
const ROOT = path.join(__dirname, '..')
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/entur', name), 'utf8'))

console.log('1 · the query')
{
  const q = new URLSearchParams(G.geocoderQuery('Jernbanetorget', 15))
  check('the v3 address', G.GEOCODER_V3 === 'https://api.entur.io/geocoder/v3/autocomplete')
  check('q, limit and lang', q.get('q') === 'Jernbanetorget' && q.get('limit') === '15' && q.get('lang') === 'no', Object.fromEntries(q))
  check('countries is lowercase "no" (NOR matches nothing)', q.get('countries') === 'no')
  check('stops, addresses, streets, places of interest and named places', q.get('layers') === 'stopPlace,address,street,poi,place', q.get('layers'))
  check('no v1 names left', !['text', 'size', 'boundary.country'].some(k => q.has(k)))
}

console.log('\n2 · the live answers (26.10.2026)')
{
  const stops = G.parseGeocoderPlaces(fixture('geocoder-v3-stop.json'))
  const stop = stops.find(p => p.id === 'NSR:StopPlace:58366')
  check('the stop is found by its NSR id', !!stop, stops.map(p => p.id))
  check('its name is names.default, its town address.locality', stop?.name === 'Jernbanetorget' && stop?.locality === 'Oslo', stop)
  check('a stop is a "venue" (the layer name the screens use)', stop?.layer === 'venue')
  check('its stop types read as one line', stop?.category === 'onstreetBus, onstreetTram, metroStation', stop?.category)
  check('it keeps its coordinates (lat, lon — GeoJSON is lon, lat)', typeof stop?.lat === 'number' && stop.lat > 59 && stop.lat < 60 && stop.lon > 10 && stop.lon < 11, stop)
  check('streets and places of interest come as "address", with coordinates', stops.filter(p => p.layer !== 'venue').every(p => p.layer === 'address' && typeof p.lat === 'number'), stops)
  check('a place that isn\'t a stop has no stop types', stops.filter(p => p.layer !== 'venue').every(p => p.category === undefined))

  const addresses = G.parseGeocoderPlaces(fixture('geocoder-v3-address.json'))
  check('an address search gives addresses, none of them stops', addresses.length > 0 && addresses.every(p => p.layer === 'address'), addresses)
  check('an address keeps its house number in the name', addresses[0]?.name === 'Karl Johans gate 1' && addresses[0]?.locality === 'Oslo', addresses[0])
}

console.log('\n3 · odd answers are skipped, never thrown')
{
  const P = G.parseGeocoderPlaces
  check('null, a string, no features', P(null).length === 0 && P('x').length === 0 && P({}).length === 0 && P({ features: 'x' }).length === 0)
  const odd = { features: [
    null,
    { properties: { names: { default: 'No id' }, layer: 'address' }, geometry: { coordinates: [10, 59] } },
    { properties: { id: 'KVE:1', names: {}, layer: 'address' }, geometry: { coordinates: [10, 59] } },
    { properties: { id: 'KVE:2', names: { default: 'No point' }, layer: 'address' } },
    { properties: { id: 'KVE:3', names: { default: 'Bad point' }, layer: 'address' }, geometry: { coordinates: ['10', 59] } },
    { properties: { id: 'KVE:4', names: { default: 'Unknown layer' }, layer: 'custom-poi' }, geometry: { coordinates: [10, 59] } },
    { properties: { id: 'NSR:StopPlace:1', names: { display: 'Stop, Town' }, layer: 'stopPlace' } },
    { properties: { id: 'KVE:5', names: { default: 'Street' }, layer: 'street', address: { county: 'Oslo' } }, geometry: { coordinates: [10.7, 59.9] } },
  ] }
  const out = P(odd)
  check('only the stop and the street with a point survive', out.map(p => p.id).join() === 'NSR:StopPlace:1,KVE:5', out)
  check('a stop without a point is still a stop (its id is what counts)', out[0]?.layer === 'venue' && out[0]?.lat === undefined && out[0]?.name === 'Stop, Town')
  check('the county stands in for a missing town', out[1]?.locality === 'Oslo' && out[1]?.layer === 'street')
}

console.log('\n4 · ai-proxy carries the same block; v1 is gone')
{
  const block = (file) => {
    const s = fs.readFileSync(path.join(ROOT, file), 'utf8')
    const a = s.indexOf('// <entur-geocoder>')
    const b = s.indexOf('// </entur-geocoder>')
    return a >= 0 && b > a ? s.slice(a, b) : null
  }
  const src = block('src/features/home/api/enturGeocoder.ts')
  check('ai-proxy carries the same <entur-geocoder> block', !!src && src === block('supabase/functions/ai-proxy/index.ts'),
    'copy the <entur-geocoder> block from src/features/home/api/enturGeocoder.ts into ai-proxy')
  const callers = ['src/features/home/api/ruterApi.ts', 'supabase/functions/ai-proxy/index.ts']
  check('nobody calls geocoder v1 or sends v1 parameters', callers.every(f => !/geocoder\/v1|boundary\.country|'venue,address'/.test(fs.readFileSync(path.join(ROOT, f), 'utf8'))))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
