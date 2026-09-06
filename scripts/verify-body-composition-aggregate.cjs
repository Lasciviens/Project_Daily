#!/usr/bin/env node
/*
 * Verification — bodyCompositionAggregate.ts (Training → Health → Body's
 * smart-scale reports panel). Against the REAL un-mocked module via sucrase
 * (this repo has no unit-test runner by convention).
 *
 * Run: node scripts/verify-body-composition-aggregate.cjs
 */
require('sucrase/register')

const {
  BODY_COMP_FIELDS, fieldMeta, reportsInWindow, latestAndPrevious, deltaFor,
  average, computeTrend,
} = require('../src/features/training/bodyCompositionAggregate')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

function report(measuredAt, overrides = {}) {
  return {
    id: measuredAt, measured_at: measuredAt,
    weight_kg: 83.6, body_fat_percent: 24.4, body_fat_mass_kg: 20.4, lean_body_mass_kg: 63.2,
    body_water_percent: 55.4, protein_percent: 15.0, muscle_percent: 70.4,
    skeletal_muscle_percent: 42.9, skeletal_muscle_index: 8.2, bmi: 25.8,
    visceral_fat_index: 8, subcutaneous_fat_kg: 18.0, bmr_kcal: 1735, body_score: 79,
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

console.log('\n2 · reportsInWindow — 30d/90d/365d/all, and out-of-order input is sorted')
{
  const now = new Date('2026-09-06T08:23:00Z').getTime()
  const reports = [
    report('2026-09-01T07:57:00.000Z'), // out of order on purpose
    report('2025-01-01T00:00:00.000Z'), // > 1 year ago
    report('2026-08-31T08:00:00.000Z'),
    report('2026-06-01T00:00:00.000Z'), // ~97 days before "now"
  ]
  const w30 = reportsInWindow(reports, '30d', now)
  check('30d keeps only the two September scans', w30.length === 2, String(w30.length))
  check('30d result is chronologically sorted', w30[0].measured_at < w30[1].measured_at)

  const w90 = reportsInWindow(reports, '90d', now)
  check('90d excludes the ~97-day-old June scan', w90.length === 2, String(w90.length))

  const w365 = reportsInWindow(reports, '365d', now)
  check('365d excludes the 2025 scan but keeps the rest', w365.length === 3, String(w365.length))

  const wAll = reportsInWindow(reports, 'all', now)
  check('all returns every scan regardless of age', wAll.length === 4)
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
  const latest = report('2026-09-06T08:23:00.000Z', { weight_kg: 83.6 })
  const previous = report('2026-08-31T08:00:00.000Z', { weight_kg: 83.55 })
  const d = deltaFor(latest, previous, 'weight_kg')
  check('delta is latest − previous', Math.abs(d.delta - 0.05) < 1e-9, String(d.delta))
  check('deltaPercent is a real percentage', Math.abs(d.deltaPercent - (0.05 / 83.55) * 100) < 1e-6)
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
    .map(d => report(d, { bmi: 25.8 }))
  const flat = computeTrend(flatSeries, 'bmi')
  check('an unchanging series → direction flat', flat.direction === 'flat' && flat.perWeek === 0)

  const sameInstant = [report('2026-01-01T00:00:00.000Z', { weight_kg: 80 }), report('2026-01-01T00:00:00.000Z', { weight_kg: 82 })]
  check('two scans with no real time spread → null, not a divide-by-zero slope', computeTrend(sameInstant, 'weight_kg') === null)

  // Real (noisy, non-monotonic) data from the actual reports shouldn't throw
  // or produce a NaN even though it isn't a clean line.
  const real = computeTrend([
    report('2026-08-31T08:00:00.000Z', { weight_kg: 83.55 }),
    report('2026-09-01T07:57:00.000Z', { weight_kg: 83.20 }),
    report('2026-09-06T08:23:00.000Z', { weight_kg: 83.60 }),
  ], 'weight_kg')
  check('real noisy data produces a finite result, never NaN', real !== null && Number.isFinite(real.perWeek))
}

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
