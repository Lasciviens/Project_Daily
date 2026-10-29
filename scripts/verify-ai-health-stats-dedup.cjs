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

const MINUTE_GRAIN_MIN_MINUTES = 7

function collapseDuplicateSumPoints(rows) {
  const byHour = new Map()
  const passthrough = []
  for (const r of rows) {
    if (!SUM_METRICS_FOR_DEDUP.has(r.metric_name) || typeof r.value?.qty !== 'number') { passthrough.push(r); continue }
    const key = `${r.metric_name}|${String(r.recorded_at).slice(0, 13)}`
    const arr = byHour.get(key)
    if (arr) arr.push(r); else byHour.set(key, [r])
  }
  const kept = []
  for (const hourRows of byHour.values()) {
    if (hourRows.length === 1) { kept.push(hourRows[0]); continue }
    const perMinute = new Map()
    for (const r of hourRows) {
      const k = String(r.recorded_at).slice(0, 16)
      const cur = perMinute.get(k)
      if (!cur || r.value.qty > cur.value.qty) perMinute.set(k, r)
    }
    if (perMinute.size >= MINUTE_GRAIN_MIN_MINUTES) { kept.push(...perMinute.values()); continue }
    let winner = hourRows[0]
    for (const r of hourRows.slice(1)) {
      const rIsBoundary = isHourBoundary(String(r.recorded_at)), wIsBoundary = isHourBoundary(String(winner.recorded_at))
      if (rIsBoundary && !wIsBoundary) winner = r
      else if (rIsBoundary === wIsBoundary && r.value.qty > winner.value.qty) winner = r
    }
    kept.push(winner)
  }
  return [...kept, ...passthrough]
}

function row(metric, recordedAt, qty, source) {
  return { metric_name: metric, date: recordedAt.slice(0, 10), unit: 'kcal', value: { qty }, recorded_at: recordedAt, source, source_family: 'apple' }
}

console.log('\n1 · Round 1 case: same hour, same value, device listed twice in one source string')
{
  const rows = [
    row('active_energy', '2026-09-05T00:00:00Z', 0.786, "Owner's Apple Watch"),
    row('active_energy', '2026-09-05T00:00:00Z', 0.786, "Owner's Apple Watch|Owner's Apple Watch"),
  ]
  const out = collapseDuplicateSumPoints(rows)
  check('collapsed to 1 row', out.length === 1, String(out.length))
  check('sums to 0.786, not 1.572', Math.abs(out.reduce((a, r) => a + r.value.qty, 0) - 0.786) < 1e-9)
}

console.log('\n2 · Round 2 case: hour-boundary reading + a mid-hour partial with a DIFFERENT source, still collapses')
{
  const rows = [
    row('active_energy', '2026-09-06T06:00:00Z', 83.7, 'Owner iPhone|Watch'),
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
    rows.push(row('basal_energy_burned', `2026-09-06T${hh}:00:00Z`, 80, 'Owner iPhone|Watch'))
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

console.log('\n6 · Minute-grain hour (>= 7 distinct minutes): minutes are summed, same-minute twins collapse')
{
  const rows = []
  for (let m = 0; m < 30; m++) rows.push(row('step_count', `2026-07-20T10:${String(m).padStart(2, '0')}:00Z`, 50, 'Watch'))
  // a float-noise workout twin in minute 5
  rows.push(row('step_count', '2026-07-20T10:05:00Z', 49.9999, 'Watch'))
  const out = collapseDuplicateSumPoints(rows)
  const total = out.reduce((a, r) => a + r.value.qty, 0)
  check('30 minutes × 50 steps → 1500, not 50 and not 1549.9999', Math.abs(total - 1500) < 1e-9, String(total))
}

console.log('\n7 · Six distinct minutes stays hour-grain (boundary row wins)')
{
  const rows = [row('step_count', '2026-07-20T11:00:00Z', 300, 'Watch')]
  for (let m = 10; m < 15; m++) rows.push(row('step_count', `2026-07-20T11:${m}:00Z`, 400, 'Watch'))
  const out = collapseDuplicateSumPoints(rows)
  check('keeps only the boundary row (300)', out.length === 1 && out[0].value.qty === 300, JSON.stringify(out.map(r => r.value.qty)))
}

console.log('\n8 · The mirror AGREES with the web app (healthAggregate.collapsedPoints)')
{
  require('sucrase/register')
  const { collapsedPoints } = require('../src/features/health/healthAggregate.ts')
  const sum = (xs) => Math.round(xs.reduce((a, r) => a + r.value.qty, 0) * 1e6) / 1e6
  const fixtures = {
    'hour-grain re-deliveries': [
      row('step_count', '2026-09-06T06:00:00Z', 83.7, 'A|B'), row('step_count', '2026-09-06T06:39:34Z', 64.2, 'A'),
      row('step_count', '2026-09-06T07:12:00Z', 20, 'A'), row('step_count', '2026-09-06T07:40:00Z', 25, 'A'),
    ],
    'minute-grain hour': Array.from({ length: 12 }, (_, m) => row('step_count', `2026-09-06T08:${String(m * 5).padStart(2, '0')}:00Z`, 10 + m, 'A')),
    'mixed day': [
      ...Array.from({ length: 9 }, (_, m) => row('step_count', `2026-09-06T09:${String(m).padStart(2, '0')}:30Z`, 7, 'A')),
      row('step_count', '2026-09-06T10:00:00Z', 500, 'A'), row('step_count', '2026-09-06T10:00:00Z', 500, 'A|A'),
    ],
  }
  for (const [label, rows] of Object.entries(fixtures)) {
    const edge = sum(collapseDuplicateSumPoints(rows))
    const web = sum(collapsedPoints('step_count', rows))
    check(`${label}: edge ${edge} === web ${web}`, edge === web)
  }
}

// The REAL getHealthStats (TypeScript stripped) against a fake PostgREST that,
// like Supabase, answers at most 1,000 rows — in table order unless the query
// orders it. Audit 28.10.2026: hourly rows pass 1,000 within a week, and the
// unpaged read dropped the newest days.
async function pagingChecks() {
  console.log('\n9 · The real getHealthStats reads past PostgREST\'s 1,000-row cap')
  const fs = require('fs')
  const path = require('path')
  const { transform } = require('sucrase')
  const src = fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/ai-proxy/index.ts'), 'utf8')
  const start = src.indexOf('const SLEEP_CONTAINMENT')
  const end = src.indexOf('\nasync function markEpisodeWatched')
  const code = transform('type AnyRecord = Record<string, any>\n' + src.slice(start, end), { transforms: ['typescript'] }).code
  const getHealthStats = new Function(code + '; return getHealthStats')()

  const reads = []
  const fakeDb = (table) => ({ from: () => {
    const f = [], order = []
    let range = null
    const q = {
      select: () => q,
      eq: (c, v) => (f.push(r => r[c] === v), q),
      in: (c, v) => (f.push(r => v.includes(r[c])), q),
      gte: (c, v) => (f.push(r => r[c] >= v), q),
      order: (c) => (order.push(c), q),
      range: (a, b) => (range = [a, b], q),
      then: (res) => {
        let rows = table.filter(r => f.every(fn => fn(r)))
        if (order.length) rows = [...rows].sort((x, y) => { for (const c of order) { const d = String(x[c]).localeCompare(String(y[c])); if (d) return d } return 0 })
        if (range) rows = rows.slice(range[0], range[1] + 1)
        reads.push({ order: [...order], range })
        return res({ data: rows.slice(0, 1000), error: null })
      },
    }
    return q
  } })

  const days = 7
  const table = []
  let id = 0
  const today = new Date()
  for (let d = days - 1; d >= 0; d--) {
    const day = new Date(today.getTime() - d * 86400e3).toISOString().slice(0, 10)
    for (let h = 0; h < 24; h++) {
      const hh = String(h).padStart(2, '0')
      for (const m of ['step_count', 'active_energy', 'basal_energy_burned', 'apple_exercise_time']) {
        const qty = m === 'step_count' ? 300 : m === 'apple_exercise_time' ? 1 : 50
        const base = { user_id: 'u', metric_name: m, date: day, unit: 'kcal', source_family: 'apple' }
        table.push({ ...base, id: String(++id).padStart(8, '0'), value: { qty }, recorded_at: `${day}T${hh}:00:00Z`, source: 'Watch' })
        table.push({ ...base, id: String(++id).padStart(8, '0'), value: { qty: qty * 0.8 }, recorded_at: `${day}T${hh}:39:00Z`, source: 'Watch|iPhone' })
      }
      table.push({ user_id: 'u', id: String(++id).padStart(8, '0'), metric_name: 'heart_rate', date: day, unit: 'bpm', value: { Avg: 70, Min: 55, Max: 120 }, recorded_at: `${day}T${hh}:00:00Z`, source: 'Watch' })
    }
    // Raw per-stage sleep rows: 160 stages of 0.05 h = 8 h a night (1,120 rows in a week).
    for (let i = 0; i < 160; i++) {
      const at = new Date(Date.parse(`${day}T00:00:00Z`) + i * 3 * 60_000).toISOString()
      table.push({ user_id: 'u', id: String(++id).padStart(8, '0'), metric_name: 'sleep_analysis', date: day, unit: 'hr', value: { value: 'Core', qty: 0.05 }, recorded_at: at, source: 'Watch' })
    }
  }
  const out = await getHealthStats(fakeDb(table), 'u', { days })
  const dates = out.daily.map(x => x.date)
  check(`all ${days} days come back (${table.length} rows in the table)`, dates.length === days, dates.join(' '))
  check('every day counts 7,200 steps, so the average is 7,200', out.daily.every(x => x.steps === 7200) && out.averages.steps === 7200,
    `${out.averages.steps}: ${out.daily.map(x => `${x.date.slice(5)}=${x.steps}`).join(' ')}`)
  check(`every night of sleep comes back with 8 h`, out.sleep.nights.length === days && out.sleep.nights.every(n => n.hours === 8),
    out.sleep.nights.map(n => `${n.date.slice(5)}=${n.hours}`).join(' '))
  check('every read is a ranged page in a stable order (recorded_at, id)',
    reads.length > 2 && reads.every(r => r.range && r.order.join(',') === 'recorded_at,id'), JSON.stringify(reads.slice(0, 3)))
}

pagingChecks().catch((e) => { failed++; console.log(`  ✗ crashed: ${e.stack}`) }).then(() => {
  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
})
