#!/usr/bin/env node
/*
 * Phase 0 verification — source-family resolver (Fitbit Air integration).
 *
 * Proves two things about src/features/training/healthAggregate.ts:
 *   1. ZERO DRIFT — for single-source (all-Apple) data, the resolver returns
 *      the SAME array reference, so every aggregation is byte-identical to
 *      before this layer existed. This is the mathematical guarantee behind the
 *      "Health tab shows zero numeric change" DoD item.
 *   2. DUAL-SOURCE CORRECTNESS — when a (metric, day) has BOTH Apple and Fitbit
 *      points, exactly ONE family wins (no blending, no double-count), the
 *      winner respects the curated default, and it falls back to the other
 *      family when the default has no data that day.
 *
 * Runs the REAL, un-mocked module code (not a re-implementation) via sucrase —
 * this repo has no unit-test runner (no vitest/jest, only Playwright for E2E),
 * so this is a throwaway script per the same convention as
 * scripts/generate-matvaretabellen-seed.mjs. It's a .cjs so it stays CommonJS
 * under the repo's "type":"module" (which is what lets require() load .ts).
 *
 *   Run:  node scripts/verify-health-source-resolver.cjs
 *   Dep:  `sucrase` (already present as a transitive dependency).
 */
require('sucrase/register')

const {
  resolveSourcePerDate,
  familyOf,
  computeDailySeries,
  computeHeartRateDailySeries,
  computeSleepSummary,
} = require('../src/features/training/healthAggregate')
const { defaultSourceFor } = require('../src/features/training/healthSourceDefaults')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

// Minimal HealthMetric factory. `fam` omitted → legacy/Apple (no source_family
// column, exactly what a pre-migration row looks like when fetched).
let seq = 0
function m(metric, date, qty, fam, hhmm = '08:00') {
  seq++
  const row = {
    id: String(seq), user_id: 'u', metric_name: metric, date,
    recorded_at: `${date}T${hhmm}:00Z`, unit: 'count', source: fam || 'watch',
    value: { qty }, synced_at: 'x',
  }
  if (fam) row.source_family = fam
  return row
}

console.log('\n== 1. Zero-drift: single-source data passes through untouched ==')
{
  // Callers always fetch ONE metric at a time (fetchHealthMetricSeries filters
  // by metric_name), so each fixture is single-metric. Multi-day, multi-point,
  // legacy (no source_family) Apple data — exactly a pre-migration fetch.
  const apple = [
    m('step_count', '2026-07-18', 100), m('step_count', '2026-07-18', 250, undefined, '13:00'),
    m('step_count', '2026-07-19', 300), m('step_count', '2026-07-19', 50, undefined, '21:00'),
  ]
  const appleEnergy = [m('active_energy', '2026-07-18', 120), m('active_energy', '2026-07-19', 90, undefined, '10:00')]
  // Identity: the fast-path must return the SAME array object (not a copy) when
  // the whole set has ≤1 family — that IS byte-identical aggregation input.
  check('resolveSourcePerDate returns the identical array reference (step_count)',
    resolveSourcePerDate(apple, 'step_count') === apple)
  check('resolveSourcePerDate returns the identical array reference (active_energy)',
    resolveSourcePerDate(appleEnergy, 'active_energy') === appleEnergy)

  // Explicit source_family:'apple' rows (post-migration) are still one family.
  const appleExplicit = [m('step_count', '2026-07-19', 100, 'apple'), m('step_count', '2026-07-19', 40, 'apple', '12:00')]
  check('explicit all-apple rows also pass through by identity',
    resolveSourcePerDate(appleExplicit, 'step_count') === appleExplicit)

  // A manual sleep correction is source_family 'apple' (column default; it sets
  // source:'manual' but never source_family) → still a single family → identity.
  const withManual = [m('step_count', '2026-07-19', 100, 'apple'), { ...m('step_count', '2026-07-19', 5, 'apple', '23:00'), source: 'manual' }]
  check('apple + manual(source_family apple) is one family → identity',
    resolveSourcePerDate(withManual, 'step_count') === withManual)

  // And the observable daily total is the plain sum (no interference).
  check('computeDailySeries(all-apple) sums normally: 18th=350, 19th=350',
    JSON.stringify(computeDailySeries('step_count', apple)) ===
    JSON.stringify([{ date: '2026-07-18', value: 350 }, { date: '2026-07-19', value: 350 }]))
}

console.log('\n== 2. Dual-source: one family wins per day, never blended ==')
{
  // step_count default = fitbit (24/7 continuity). A day with BOTH families:
  // apple 100+50=150, fitbit 200+30=230. Fitbit wins → 230 (NOT 380).
  check('sanity: step_count default is fitbit', defaultSourceFor('step_count') === 'fitbit')
  const mixed = [
    m('step_count', '2026-07-19', 100, 'apple'), m('step_count', '2026-07-19', 50, 'apple', '15:00'),
    m('step_count', '2026-07-19', 200, 'fitbit'), m('step_count', '2026-07-19', 30, 'fitbit', '15:00'),
  ]
  const mixedOut = computeDailySeries('step_count', mixed)
  check('dual-source step_count picks fitbit total 230 (no double-count to 380)',
    mixedOut.length === 1 && mixedOut[0].value === 230, JSON.stringify(mixedOut))
  const resolved = resolveSourcePerDate(mixed, 'step_count')
  check('resolver drops apple rows on a mixed fitbit-default day',
    resolved.length === 2 && resolved.every(p => familyOf(p) === 'fitbit'))

  // Fallback: default (fitbit) absent that day → use apple.
  const appleOnlyDay = [m('step_count', '2026-07-20', 100, 'apple'), m('step_count', '2026-07-20', 50, 'apple', '15:00')]
  const fb = computeDailySeries('step_count', appleOnlyDay)
  check('fallback: fitbit-default metric with only apple data → apple total 150',
    fb.length === 1 && fb[0].value === 150, JSON.stringify(fb))

  // Apple-default metric (weight): apple 80 vs fitbit 79, latest wins per family,
  // apple is the default → 80.
  check('sanity: weight_body_mass default is apple', defaultSourceFor('weight_body_mass') === 'apple')
  const weight = [m('weight_body_mass', '2026-07-19', 80, 'apple'), m('weight_body_mass', '2026-07-19', 79, 'fitbit', '09:00')]
  const w = computeDailySeries('weight_body_mass', weight)
  check('dual-source weight picks apple (its default) = 80',
    w.length === 1 && w[0].value === 80, JSON.stringify(w))

  // Per-day independence: 18th apple-only, 19th has both → 18th apple, 19th fitbit.
  const perDay = [
    m('step_count', '2026-07-18', 111, 'apple'),
    m('step_count', '2026-07-19', 100, 'apple'), m('step_count', '2026-07-19', 222, 'fitbit'),
  ]
  const pd = computeDailySeries('step_count', perDay)
  check('per-day winner is independent: 18th=111 (apple), 19th=222 (fitbit)',
    JSON.stringify(pd) === JSON.stringify([{ date: '2026-07-18', value: 111 }, { date: '2026-07-19', value: 222 }]),
    JSON.stringify(pd))
}

console.log('\n== 3. Heart rate (minmaxavg) never blends two sensors ==')
{
  function hr(date, min, avg, max, fam, hhmm = '08:00') {
    seq++
    const r = { id: String(seq), user_id: 'u', metric_name: 'heart_rate', date, recorded_at: `${date}T${hhmm}:00Z`, unit: 'count/min', source: fam, value: { Min: min, Avg: avg, Max: max }, synced_at: 'x' }
    r.source_family = fam
    return r
  }
  check('sanity: heart_rate default is fitbit', defaultSourceFor('heart_rate') === 'fitbit')
  const pts = [hr('2026-07-19', 50, 70, 120, 'apple'), hr('2026-07-19', 48, 65, 110, 'fitbit', '09:00')]
  const out = computeHeartRateDailySeries(pts)
  // Fitbit wins → its own 48/65/110, NOT min(48,50)/avg(...)/max(120,110).
  check('dual-source HR uses fitbit only (48/65/110, not cross-source min/max)',
    out.length === 1 && out[0].min === 48 && out[0].avg === 65 && out[0].max === 110, JSON.stringify(out))
}

console.log('\n== 4. Sleep is always Fitbit; sessions not double-counted ==')
{
  function sleep(nightDate, startH, endH, total, fam) {
    seq++
    const start = `${nightDate}T0${startH}:00:00+02:00`.replace('T0', total < 0 ? 'T' : 'T0')
    const r = {
      id: String(seq), user_id: 'u', metric_name: 'sleep_analysis', date: nightDate,
      recorded_at: `${nightDate}T${String(endH).padStart(2, '0')}:00:00Z`, unit: 'hr', source: fam,
      value: { sleepStart: `${nightDate} ${String(startH).padStart(2, '0')}:00:00 +0200`, sleepEnd: `${nightDate} ${String(endH).padStart(2, '0')}:00:00 +0200`, totalSleep: total, core: total * 0.6, rem: total * 0.25, deep: total * 0.15, awake: 0 },
      synced_at: 'x',
    }
    r.source_family = fam
    return r
  }
  check('sanity: sleep_analysis default is fitbit', defaultSourceFor('sleep_analysis') === 'fitbit')
  // Same night: apple session 7h, fitbit session 8h. Fitbit wins → total 8 (not 15).
  const night = [sleep('2026-07-19', 0, 7, 7, 'apple'), sleep('2026-07-19', 0, 8, 8, 'fitbit')]
  const s = computeSleepSummary(night)
  check('dual-source night uses fitbit total 8h (not summed to 15h)',
    s.length === 1 && Math.abs(s[0].total - 8) < 1e-9, JSON.stringify(s))

  // Apple-only night (no fitbit) still shows (fallback), single source.
  const appleNight = [sleep('2026-07-20', 0, 6, 6, 'apple')]
  const s2 = computeSleepSummary(appleNight)
  check('apple-only night falls back to apple total 6h',
    s2.length === 1 && Math.abs(s2[0].total - 6) < 1e-9, JSON.stringify(s2))
}

console.log(`\n${failed === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
