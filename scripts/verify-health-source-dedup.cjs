#!/usr/bin/env node
/*
 * Verification — health_metrics 'sum'-metric duplicate collapse
 * (healthAggregate.ts's collapseIntraStreamMinuteDuplicates/streamKeyOf),
 * against the REAL un-mocked module via sucrase (no test framework, per
 * convention).
 *
 * Real bug this locks in (2026-09-06, live-confirmed against production
 * data after triggering Health Auto Export's 7-day/30-day reconciliation
 * automations): the SAME hour, from the SAME device, arrived under TWO
 * different `source` strings — "Furkan's Apple Watch" and "Furkan's Apple
 * Watch|Furkan's Apple Watch" (the device listed twice, un-deduped by HAE's
 * own multi-contributor join) — so the old raw-string stream key treated
 * them as different streams and summed both, doubling steps/active energy/
 * basal energy for that hour. canonicalSourceKey (via streamKeyOf) fixes
 * this display-side; health-export-webhook's own canonicalizeSource is the
 * matching ingest-side fix (not exercised here — it's a Deno function).
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

console.log("\n1 · The exact live-confirmed case: same hour, same value, device listed twice in one source string")
{
  const points = [
    pt('2026-09-05T00:00:00Z', 0.786, "Furkan's Apple Watch"),
    pt('2026-09-05T00:00:00Z', 0.786, "Furkan's Apple Watch|Furkan's Apple Watch"),
  ]
  const series = computeDailySeries('active_energy', points)
  check('collapses to ONE value, not summed to 1.572', series.length === 1 && Math.abs(series[0].value - 0.786) < 1e-9,
    JSON.stringify(series))
}

console.log("\n2 · Two real contributing devices, one duplicated in the join, the other not")
{
  const points = [
    pt('2026-09-05T08:00:00Z', 40.0, 'Lasci 17 Pro|Watch'),
    pt('2026-09-05T08:00:00Z', 40.0, 'Lasci 17 Pro|Watch|Watch'),
  ]
  const series = computeDailySeries('active_energy', points)
  check('collapses regardless of how many times a device is repeated in the join', series.length === 1 && Math.abs(series[0].value - 40.0) < 1e-9)
}

console.log('\n3 · Device order differing between exports still collapses (order-independent)')
{
  const points = [
    pt('2026-09-05T09:00:00Z', 12.5, 'Watch|Phone'),
    pt('2026-09-05T09:00:00Z', 12.5, 'Phone|Watch'),
  ]
  const series = computeDailySeries('active_energy', points)
  check('order-independent join collapses to one', series.length === 1 && Math.abs(series[0].value - 12.5) < 1e-9)
}

console.log('\n4 · An NBSP inside a device name (Apple sometimes writes "Apple\\u00a0Watch") does not defeat the match')
{
  const points = [
    pt('2026-09-05T10:00:00Z', 5.0, 'Furkan’s Apple Watch'),        // normal space
    pt('2026-09-05T10:00:00Z', 5.0, 'Furkan’s Apple Watch'),   // NBSP between Apple/Watch
  ]
  const series = computeDailySeries('active_energy', points)
  check('NBSP-vs-space variants of the same device collapse', series.length === 1 && Math.abs(series[0].value - 5.0) < 1e-9)
}

console.log('\n5 · Genuinely DIFFERENT devices at the same minute are NOT collapsed (real distinct sources stay distinct)')
{
  const points = [
    pt('2026-09-05T11:00:00Z', 3.0, 'Furkan’s Apple Watch'),
    pt('2026-09-05T11:00:00Z', 2.0, 'Some Other Real Device'),
  ]
  const series = computeDailySeries('active_energy', points)
  // Two genuinely different streams at the same minute are summed as real
  // distinct contributions, per this file's own stated design (only same-
  // stream duplicates collapse) — 3.0 + 2.0 = 5.0.
  check('two real distinct sources still sum normally', series.length === 1 && Math.abs(series[0].value - 5.0) < 1e-9)
}

console.log('\n6 · A genuinely different minute (real second reading) is never collapsed away')
{
  const points = [
    pt('2026-09-05T12:00:00Z', 3.0, "Furkan's Apple Watch"),
    pt('2026-09-05T12:32:42Z', 4.0, "Furkan's Apple Watch"),
  ]
  const series = computeDailySeries('active_energy', points)
  check('two real distinct minutes both count', series.length === 1 && Math.abs(series[0].value - 7.0) < 1e-9)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
