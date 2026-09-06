#!/usr/bin/env node
/*
 * Verification — health_metrics 'sum'-metric duplicate collapse
 * (healthAggregate.ts's collapseIntraStreamMinuteDuplicates), against the
 * REAL un-mocked module via sucrase (no test framework, per convention).
 *
 * Real bug, TWO rounds, both live-confirmed 2026-09-06 against production
 * data right after the user triggered Health Auto Export's 7-day/30-day
 * reconciliation automations:
 *   Round 1: the same hour, same device, arrived under two different
 *   `source` strings ("Watch" vs "Watch|Watch" -- HAE's own multi-
 *   contributor join, un-deduped). Fixed by canonicalizing source before
 *   comparing.
 *   Round 2 (round 1 wasn't enough): every hour ALSO carries a THIRD row at
 *   a genuinely different minute with a genuinely different device
 *   combination in `source` (e.g. "Watch|Lasci 17 Pro" at "06:00:00" and
 *   just "Watch" at "06:39:34") -- a per-minute-per-source key still missed
 *   this and summed it on top, inflating a live day's basal energy to
 *   ~5400 kcal/day average (a real BMR is ~1600-2400). Root cause: these
 *   rows are NOT independent per-device contributions -- HAE re-reports the
 *   SAME real hour's already-merged total every time its sync automations
 *   re-fire, with `source` reflecting whatever happened to be available to
 *   HealthKit's merge at that moment. Fixed by grouping by HOUR ONLY,
 *   ignoring the exact minute and the source string entirely -- confirmed
 *   against real numbers: naive-summing one partial day of basal energy
 *   came to 3309 kcal, hour-level collapse brings the SAME rows to 1164
 *   kcal (a sane ~80 kcal/hour).
 *
 * Run: node scripts/verify-health-source-dedup.cjs
 */
require('sucrase/register')

const { computeDailySeries } = require('../src/features/training/healthAggregate')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

function pt(recordedAt, qty, source) {
  return { id: recordedAt + source, user_id: 'u', metric_name: 'active_energy', date: recordedAt.slice(0, 10), recorded_at: recordedAt, unit: 'kcal', source, value: { qty }, synced_at: recordedAt }
}

console.log('\n1 · Round 1 case: same hour, same value, device listed twice in one source string')
{
  const points = [
    pt('2026-09-05T00:00:00Z', 0.786, "Furkan's Apple Watch"),
    pt('2026-09-05T00:00:00Z', 0.786, "Furkan's Apple Watch|Furkan's Apple Watch"),
  ]
  const series = computeDailySeries('active_energy', points)
  check('collapses to ONE value, not summed to 1.572', series.length === 1 && Math.abs(series[0].value - 0.786) < 1e-9,
    JSON.stringify(series))
}

console.log('\n2 · Round 2 case: the exact live pattern — hour-boundary reading + a mid-hour partial with a DIFFERENT source, still collapses')
{
  const points = [
    pt('2026-09-06T06:00:00Z', 83.7, 'Lasci 17 Pro|Watch'),
    pt('2026-09-06T06:00:00Z', 83.7, 'Lasci 17 Pro|Watch|Watch'), // round-1 style exact dup
    pt('2026-09-06T06:39:34Z', 64.2, 'Watch'),                    // round-2: different minute AND source
  ]
  const series = computeDailySeries('active_energy', points)
  check('collapses to the hour-boundary value only (83.7), never summed with the partial', series.length === 1 && Math.abs(series[0].value - 83.7) < 1e-9,
    JSON.stringify(series))
}

console.log('\n3 · A full day of the real live basal_energy_burned pattern produces a sane total, not thousands of kcal')
{
  // Mirrors the real live shape: per hour, an hour-boundary reading plus a
  // mid-hour "since last sync" partial under a different source, repeated
  // for 24 hours at a realistic ~80 kcal/hour BMR rate.
  const points = []
  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, '0')
    points.push(pt(`2026-09-06T${hh}:00:00Z`, 80, 'Lasci 17 Pro|Watch'))
    points.push(pt(`2026-09-06T${hh}:00:00Z`, 80, 'Lasci 17 Pro|Watch|Watch'))
    points.push(pt(`2026-09-06T${hh}:39:00Z`, 45, 'Watch'))
  }
  const series = computeDailySeries('active_energy', points)
  check('24 hours at ~80 kcal/hour → ~1920 kcal/day, not ~4800+', series.length === 1 && Math.abs(series[0].value - 1920) < 1e-6,
    JSON.stringify(series))
}

console.log('\n4 · When NEITHER reading in an hour lands on the boundary, the larger (more complete) partial wins — never summed')
{
  const points = [
    pt('2026-09-06T09:39:34Z', 60, 'Watch'),
    pt('2026-09-06T09:51:21Z', 65, 'Lasci 17 Pro|Watch'), // later, more complete partial
  ]
  const series = computeDailySeries('active_energy', points)
  check('keeps the larger partial only (65), not 60+65=125', series.length === 1 && Math.abs(series[0].value - 65) < 1e-9,
    JSON.stringify(series))
}

console.log('\n5 · A genuine hour-boundary reading always wins over a partial, even if the partial happens to read larger')
{
  const points = [
    pt('2026-09-06T10:00:00Z', 90, 'Lasci 17 Pro|Watch'),  // closed-hour total
    pt('2026-09-06T10:32:17Z', 93.6, 'Watch'),             // a later partial that reads slightly higher
  ]
  const series = computeDailySeries('active_energy', points)
  check('the hour-boundary reading (90) wins, not the larger partial (93.6) and never their sum', series.length === 1 && Math.abs(series[0].value - 90) < 1e-9,
    JSON.stringify(series))
}

console.log('\n6 · Two genuinely different real hours both count in full (no cross-hour collapsing)')
{
  const points = [
    pt('2026-09-06T12:00:00Z', 3.0, "Furkan's Apple Watch"),
    pt('2026-09-06T13:00:00Z', 4.0, "Furkan's Apple Watch"),
  ]
  const series = computeDailySeries('active_energy', points)
  check('two real distinct hours sum to 7.0', series.length === 1 && Math.abs(series[0].value - 7.0) < 1e-9)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
