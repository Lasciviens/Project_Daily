#!/usr/bin/env node
/*
 * Verification — bodyCompositionAggregate.ts (Health → Body → "More from the
 * scale", the smart-scale reports panel). Against the REAL un-mocked module via sucrase
 * (this repo has no unit-test runner by convention).
 *
 * Run: node scripts/verify-body-composition-aggregate.cjs
 */
require('sucrase/register')

const {
  BODY_COMP_FIELDS, fieldMeta, reportsBetween, latestAndPrevious, deltaFor,
  average, computeTrend, dailySeries,
} = require('../src/features/health/bodyCompositionAggregate')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

function report(measuredAt, overrides = {}) {
  return {
    id: measuredAt, measured_at: measuredAt,
    weight_kg: 78.0, body_fat_percent: 20.0, body_fat_mass_kg: 15.6, lean_body_mass_kg: 62.4,
    body_water_percent: 57.0, protein_percent: 16.0, muscle_percent: 74.0,
    skeletal_muscle_percent: 45.0, skeletal_muscle_index: 8.5, bmi: 24.1,
    visceral_fat_index: 7, subcutaneous_fat_kg: 13.8, bmr_kcal: 1680, body_score: 83,
    source: 'movinglife_report', created_at: measuredAt,
    ...overrides,
  }
}

console.log('\n1 · Field metadata — 14 fields, unique keys, throws on an unknown key')
{
  check('exactly 14 fields', BODY_COMP_FIELDS.length === 14, String(BODY_COMP_FIELDS.length))
  const keys = BODY_COMP_FIELDS.map(f => f.key)
  check('all keys unique', new Set(keys).size === keys.length)
  check('fieldMeta resolves a real key', fieldMeta('weight_kg').label === 'Weight')
  let threw = false
  try { fieldMeta('not_a_real_field') } catch { threw = true }
  check('fieldMeta throws on an unknown key', threw)
}

console.log('\n2 · reportsBetween — the page\'s period by local day, and out-of-order input is sorted')
{
  const day = iso => iso.slice(0, 10)
  const reports = [
    report('2026-09-01T07:57:00.000Z'), // out of order on purpose
    report('2025-01-01T00:00:00.000Z'), // > 1 year before
    report('2026-08-31T08:00:00.000Z'),
    report('2026-06-01T00:00:00.000Z'), // ~97 days before
  ]
  const w30 = reportsBetween(reports, '2026-08-08', '2026-09-06', day)
  check('30 days keep only the two late scans', w30.length === 2, String(w30.length))
  check('the result is chronologically sorted', w30[0].measured_at < w30[1].measured_at)
  check('90 days exclude the ~97-day-old June scan', reportsBetween(reports, '2026-06-09', '2026-09-06', day).length === 2)
  check('a year excludes the 2025 scan but keeps the rest', reportsBetween(reports, '2025-09-07', '2026-09-06', day).length === 3)
  check('the period ends on the viewed day, not today', reportsBetween(reports, '2026-08-01', '2026-08-31', day).length === 1)
  check('a single day', reportsBetween(reports, '2026-09-01', '2026-09-01', day).length === 1)
}

console.log('\n3 · latestAndPrevious — empty / one / many scans')
{
  check('empty history → both null', JSON.stringify(latestAndPrevious([])) === JSON.stringify({ latest: null, previous: null }))
  const one = latestAndPrevious([report('2026-09-06T08:23:00.000Z')])
  check('one scan → latest set, previous null', one.latest !== null && one.previous === null)
  const many = latestAndPrevious([
    report('2026-08-31T08:00:00.000Z'),
    report('2026-09-06T08:23:00.000Z'),
    report('2026-09-01T07:57:00.000Z'), // out of order
  ])
  check('picks the two most recent by measured_at, not array position',
    many.latest.measured_at === '2026-09-06T08:23:00.000Z' && many.previous.measured_at === '2026-09-01T07:57:00.000Z')
}

console.log('\n4 · deltaFor — null-safe, real percentage, no fabricated "0 change"')
{
  check('null when previous is missing', deltaFor(report('2026-09-06T08:23:00.000Z'), null, 'weight_kg') === null)
  const latest = report('2026-09-06T08:23:00.000Z', { weight_kg: 78.0 })
  const previous = report('2026-08-31T08:00:00.000Z', { weight_kg: 78.4 })
  const d = deltaFor(latest, previous, 'weight_kg')
  check('delta is latest − previous', Math.abs(d.delta - -0.4) < 1e-9, String(d.delta))
  check('deltaPercent is a real percentage', Math.abs(d.deltaPercent - (-0.4 / 78.4) * 100) < 1e-6)
  const zeroPrev = deltaFor(report('x', { visceral_fat_index: 3 }), report('y', { visceral_fat_index: 0 }), 'visceral_fat_index')
  check('deltaPercent is null (not Infinity/NaN) when previous value is 0', zeroPrev.deltaPercent === null && zeroPrev.delta === 3)
}

console.log('\n5 · average — plain mean, null (never 0) on an empty set')
{
  check('empty set → null', average([], 'weight_kg') === null)
  const reports = [report('a', { weight_kg: 80 }), report('b', { weight_kg: 82 }), report('c', { weight_kg: 84 })]
  check('mean of three scans', average(reports, 'weight_kg') === 82)
}

console.log('\n6 · computeTrend — direction + rate from a real least-squares fit')
{
  check('a single scan → null (no trend from one point)', computeTrend([report('a')], 'weight_kg') === null)

  const risingWeekly = ['2026-01-01T00:00:00.000Z', '2026-01-08T00:00:00.000Z', '2026-01-15T00:00:00.000Z', '2026-01-22T00:00:00.000Z']
    .map((d, i) => report(d, { weight_kg: 80 + i })) // +1kg every 7 days, exactly linear
  const rising = computeTrend(risingWeekly, 'weight_kg')
  check('monotonically increasing → direction up', rising.direction === 'up')
  check('slope is ~1kg/week on an exactly linear series', Math.abs(rising.perWeek - 1) < 1e-9, String(rising.perWeek))
  check('firstValue/lastValue are the real endpoints', rising.firstValue === 80 && rising.lastValue === 83)

  const fallingWeekly = ['2026-01-01T00:00:00.000Z', '2026-01-08T00:00:00.000Z', '2026-01-15T00:00:00.000Z']
    .map((d, i) => report(d, { body_fat_percent: 25 - i }))
  const falling = computeTrend(fallingWeekly, 'body_fat_percent')
  check('monotonically decreasing → direction down', falling.direction === 'down')

  const flatSeries = ['2026-01-01T00:00:00.000Z', '2026-01-08T00:00:00.000Z', '2026-01-15T00:00:00.000Z']
    .map(d => report(d, { bmi: 24.1 }))
  const flat = computeTrend(flatSeries, 'bmi')
  check('an unchanging series → direction flat', flat.direction === 'flat' && flat.perWeek === 0)

  const sameInstant = [report('2026-01-01T00:00:00.000Z', { weight_kg: 80 }), report('2026-01-01T00:00:00.000Z', { weight_kg: 82 })]
  check('two scans with no real time spread → null, not a divide-by-zero slope', computeTrend(sameInstant, 'weight_kg') === null)

  // Noisy, non-monotonic readings like a scale's (values made up) shouldn't
  // throw or produce a NaN even though they aren't a clean line.
  const noisy = computeTrend([
    report('2026-08-31T08:00:00.000Z', { weight_kg: 78.4 }),
    report('2026-09-01T07:57:00.000Z', { weight_kg: 77.8 }),
    report('2026-09-06T08:23:00.000Z', { weight_kg: 78.0 }),
  ], 'weight_kg')
  check('noisy readings produce a finite result, never NaN', noisy !== null && Number.isFinite(noisy.perWeek))
}

console.log('\n7 · dailySeries — one value per local day, for a time-scaled line')
{
  const dayOf = iso => iso.slice(0, 10)
  const reports = [
    report('2026-01-03T18:00:00.000Z', { weight_kg: 81.0 }),
    report('2026-01-01T07:00:00.000Z', { weight_kg: 80.0 }),
    report('2026-01-03T07:00:00.000Z', { weight_kg: 80.6 }),
    report('2026-01-02T07:00:00.000Z', { weight_kg: NaN }),
  ]
  const s = dailySeries(reports, 'weight_kg', dayOf)
  check('ascending, one entry per day', JSON.stringify(s.map(p => p.date)) === JSON.stringify(['2026-01-01', '2026-01-03']), JSON.stringify(s))
  check('two scans on one day → the later one', s[1].value === 81.0, String(s[1].value))
  check('a non-finite value leaves the day out', !s.some(p => p.date === '2026-01-02'))
  check('empty in, empty out', dailySeries([], 'weight_kg', dayOf).length === 0)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
