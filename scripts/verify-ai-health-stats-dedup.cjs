#!/usr/bin/env node
/*
 * Verification — ai-proxy's getHealthStats own duplicate-hour collapse
 * (collapseDuplicateSumPoints). ai-proxy is a self-contained Deno function
 * and can't be require()'d directly (it calls Deno.serve/Deno.env at module
 * scope), so this is a hand-synced mirror of the pure logic — same
 * convention as the Hevy upsert logic's 4-way inlining and phone-gateway's
 * own verify script. Keep this in sync with
 * supabase/functions/ai-proxy/index.ts's copy by hand — and with
 * scripts/verify-health-source-dedup.cjs, which verifies the identical logic
 * in healthAggregate.ts (the two must stay behaviorally identical).
 *
 * Run: node scripts/verify-ai-health-stats-dedup.cjs
 */

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

const SUM_METRICS_FOR_DEDUP = new Set(['step_count', 'active_energy', 'basal_energy_burned', 'apple_exercise_time'])

function isHourBoundary(recordedAt) {
  return recordedAt.slice(14, 19) === '00:00'
}

function collapseDuplicateSumPoints(rows) {
  const byKey = new Map()
  const passthrough = []
  for (const r of rows) {
    if (!SUM_METRICS_FOR_DEDUP.has(r.metric_name) || typeof r.value?.qty !== 'number') { passthrough.push(r); continue }
    const key = `${r.metric_name}|${String(r.recorded_at).slice(0, 13)}`
    const kept = byKey.get(key)
    if (!kept) { byKey.set(key, r); continue }
    const keptIsBoundary = isHourBoundary(String(kept.recorded_at))
    const rIsBoundary = isHourBoundary(String(r.recorded_at))
    if (rIsBoundary && !keptIsBoundary) byKey.set(key, r)
    else if (rIsBoundary === keptIsBoundary && r.value.qty > kept.value.qty) byKey.set(key, r)
  }
  return [...byKey.values(), ...passthrough]
}

function row(metric, recordedAt, qty, source) {
  return { metric_name: metric, date: recordedAt.slice(0, 10), unit: 'kcal', value: { qty }, recorded_at: recordedAt, source, source_family: 'apple' }
}

console.log('\n1 · Round 1 case: same hour, same value, device listed twice in one source string')
{
  const rows = [
    row('active_energy', '2026-09-05T00:00:00Z', 0.786, "Furkan's Apple Watch"),
    row('active_energy', '2026-09-05T00:00:00Z', 0.786, "Furkan's Apple Watch|Furkan's Apple Watch"),
  ]
  const out = collapseDuplicateSumPoints(rows)
  check('collapsed to 1 row', out.length === 1, String(out.length))
  check('sums to 0.786, not 1.572', Math.abs(out.reduce((a, r) => a + r.value.qty, 0) - 0.786) < 1e-9)
}

console.log('\n2 · Round 2 case: hour-boundary reading + a mid-hour partial with a DIFFERENT source, still collapses')
{
  const rows = [
    row('active_energy', '2026-09-06T06:00:00Z', 83.7, 'Lasci 17 Pro|Watch'),
    row('active_energy', '2026-09-06T06:39:34Z', 64.2, 'Watch'),
  ]
  const out = collapseDuplicateSumPoints(rows)
  check('collapsed to 1 row', out.length === 1)
  check('keeps only the hour-boundary value (83.7)', Math.abs(out[0].value.qty - 83.7) < 1e-9)
}

console.log('\n3 · heart_rate (not in the dedup set) passes through untouched')
{
  const rows = [
    { metric_name: 'heart_rate', date: '2026-09-05', unit: null, value: { Avg: 60, Min: 55, Max: 90 }, recorded_at: '2026-09-05T00:00:00Z', source: 'Watch|Watch' },
    { metric_name: 'heart_rate', date: '2026-09-05', unit: null, value: { Avg: 62, Min: 56, Max: 91 }, recorded_at: '2026-09-05T00:39:00Z', source: 'Watch' },
  ]
  const out = collapseDuplicateSumPoints(rows)
  check('both heart_rate rows pass through (no qty field, not a sum metric)', out.length === 2, String(out.length))
}

console.log('\n4 · A full day at a realistic BMR rate stays sane (not inflated by the hourly partial pattern)')
{
  const rows = []
  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, '0')
    rows.push(row('basal_energy_burned', `2026-09-06T${hh}:00:00Z`, 80, 'Lasci 17 Pro|Watch'))
    rows.push(row('basal_energy_burned', `2026-09-06T${hh}:39:00Z`, 45, 'Watch'))
  }
  const out = collapseDuplicateSumPoints(rows)
  const total = out.reduce((a, r) => a + r.value.qty, 0)
  check('24 hours at ~80 kcal/hour → 1920 kcal/day, not ~3000', Math.abs(total - 1920) < 1e-6, String(total))
}

console.log('\n5 · Two genuinely different real hours both count in full')
{
  const rows = [
    row('step_count', '2026-09-05T08:00:00Z', 100, 'Watch'),
    row('step_count', '2026-09-05T09:00:00Z', 50, 'iPhone'),
  ]
  const out = collapseDuplicateSumPoints(rows)
  check('both kept as distinct real hours', out.length === 2)
  check('sums to 150', out.reduce((a, r) => a + r.value.qty, 0) === 150)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
