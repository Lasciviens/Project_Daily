#!/usr/bin/env node
/*
 * Verification — ai-proxy's getHealthStats own duplicate-source collapse
 * (collapseDuplicateSumPoints/canonicalizeSource). ai-proxy is a
 * self-contained Deno function and can't be require()'d directly (it calls
 * Deno.serve/Deno.env at module scope), so this is a hand-synced mirror of
 * the pure logic — same convention as the Hevy upsert logic's 4-way inlining
 * and phone-gateway's own verify script. Keep this in sync with
 * supabase/functions/ai-proxy/index.ts's copy by hand.
 *
 * Run: node scripts/verify-ai-health-stats-dedup.cjs
 */

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

function canonicalizeSource(raw) {
  const parts = raw.split('|').map(p => p.trim().replace(/\u00a0/g, ' ')).filter(Boolean)
  return [...new Set(parts)].sort().join('|')
}

const SUM_METRICS_FOR_DEDUP = new Set(['step_count', 'active_energy', 'basal_energy_burned', 'apple_exercise_time'])
function collapseDuplicateSumPoints(rows) {
  const byKey = new Map()
  const passthrough = []
  for (const r of rows) {
    if (!SUM_METRICS_FOR_DEDUP.has(r.metric_name) || typeof r.value?.qty !== 'number') { passthrough.push(r); continue }
    const key = `${r.metric_name}|${canonicalizeSource(r.source ?? '')}|${String(r.recorded_at).slice(0, 16)}`
    const kept = byKey.get(key)
    if (!kept || r.value.qty > kept.value.qty) byKey.set(key, r)
  }
  return [...byKey.values(), ...passthrough]
}

function row(metric, recordedAt, qty, source) {
  return { metric_name: metric, date: recordedAt.slice(0, 10), unit: 'kcal', value: { qty }, recorded_at: recordedAt, source, source_family: 'apple' }
}

console.log('\n1 · The exact live-confirmed case collapses to one row')
{
  const rows = [
    row('active_energy', '2026-09-05T00:00:00Z', 0.786, "Furkan's Apple Watch"),
    row('active_energy', '2026-09-05T00:00:00Z', 0.786, "Furkan's Apple Watch|Furkan's Apple Watch"),
  ]
  const out = collapseDuplicateSumPoints(rows)
  check('collapsed to 1 row', out.length === 1, String(out.length))
  const sum = out.reduce((a, r) => a + r.value.qty, 0)
  check('sums to 0.786, not 1.572', Math.abs(sum - 0.786) < 1e-9, String(sum))
}

console.log('\n2 · heart_rate (not in the dedup set) passes through untouched even with a duplicate-looking source')
{
  const rows = [
    { metric_name: 'heart_rate', date: '2026-09-05', unit: null, value: { Avg: 60, Min: 55, Max: 90 }, recorded_at: '2026-09-05T00:00:00Z', source: 'Watch|Watch' },
    { metric_name: 'heart_rate', date: '2026-09-05', unit: null, value: { Avg: 62, Min: 56, Max: 91 }, recorded_at: '2026-09-05T00:00:00Z', source: 'Watch' },
  ]
  const out = collapseDuplicateSumPoints(rows)
  check('both heart_rate rows pass through (no qty field, not a sum metric)', out.length === 2, String(out.length))
}

console.log('\n3 · Two genuinely different real sources at the same minute both count')
{
  const rows = [
    row('step_count', '2026-09-05T08:00:00Z', 100, 'Watch'),
    row('step_count', '2026-09-05T08:00:00Z', 50, 'iPhone'),
  ]
  const out = collapseDuplicateSumPoints(rows)
  check('both kept as distinct real sources', out.length === 2)
  const sum = out.reduce((a, r) => a + r.value.qty, 0)
  check('sums to 150', sum === 150)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
