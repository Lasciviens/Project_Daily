#!/usr/bin/env node
/*
 * Verification — ai-proxy's computeSleepNights session merge.
 *
 * ai-proxy is a self-contained Deno function and can't be require()'d (it
 * calls Deno.serve/Deno.env at module scope), so the logic below is a
 * hand-synced mirror of its copy — the same convention
 * scripts/verify-ai-health-stats-dedup.cjs already uses.
 *
 * What makes this script worth more than a second set of assertions: it runs
 * the mirror and the REAL web-app implementation over the same fixtures and
 * asserts they AGREE. The two copies drifting apart is the actual risk in a
 * hand-mirrored arrangement — the AI answering "you slept 4.3h" while the
 * Health tab shows 8.5h for the same night is the failure this guards.
 *
 * Run: node scripts/verify-ai-sleep-merge.cjs
 */

require('sucrase/register')
const { computeSleepSummary } = require('../src/features/training/healthAggregate.ts')

let passed = 0
const failures = []
function check(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++
  else failures.push(`${label}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`)
}
const round = (n) => Math.round(n * 100) / 100

// ─── The mirror: the edge functions' merge AND per-night grouping ───────────
// Keep in step with supabase/functions/ai-proxy/index.ts and
// supabase/functions/phone-gateway/index.ts by hand. This mirrors the whole
// pipeline, not just the merge: an earlier version of this script compared
// only the summed total, which let a real defect through — the merge was fixed
// to keep both blocks of an interrupted night, but the edge copies still
// returned one row PER SESSION, so a caller got two rows for the same date and
// nothing summed them.
const CONTAINMENT = 0.9
function aiNights(rows) {
  const ms = (s) => {
    if (typeof s !== 'string') return null
    const iso = s.trim().replace(' ', 'T').replace(/\s*([+-]\d{2}):?(\d{2})$/, '$1:$2')
    let t = Date.parse(iso); if (!Number.isFinite(t)) t = Date.parse(s)
    return Number.isFinite(t) ? t : null
  }
  const sessions = rows.map(r => {
    const v = r.value ?? {}
    return { start: ms(v.sleepStart), end: ms(v.sleepEnd), total: Number(v.totalSleep) || 0,
             deep: Number(v.deep) || 0, core: Number(v.core) || 0, rem: Number(v.rem) || 0 }
  }).filter(s => s.start != null && s.end != null && s.end > s.start)

  const ranked = [...sessions].sort((a, b) =>
    (b.total - a.total) || ((b.end - b.start) - (a.end - a.start)))
  const kept = []
  for (const s of ranked) {
    const dup = kept.some(k => {
      const overlap = Math.min(s.end, k.end) - Math.max(s.start, k.start)
      const span = s.end - s.start
      return overlap > 0 && span > 0 && overlap / span >= CONTAINMENT
    })
    if (!dup) kept.push(s)
  }

  const byNight = new Map()
  for (const s of kept) {
    const date = new Date(s.end).toLocaleDateString('en-CA', { timeZone: 'Europe/Oslo' })
    const n = byNight.get(date) ?? { date, hours: 0, deep_h: 0, core_h: 0, rem_h: 0 }
    n.hours += s.total; n.deep_h += s.deep; n.core_h += s.core; n.rem_h += s.rem
    byNight.set(date, n)
  }
  return [...byNight.values()]
    .map(n => ({ date: n.date, hours: round(n.hours), deep_h: round(n.deep_h), core_h: round(n.core_h), rem_h: round(n.rem_h) }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// ─── Fixtures ────────────────────────────────────────────────────────────────
const at = (day, clock) => `2026-07-${day} ${clock} +0200`
const row = (start, end, total, source = "Furkan's Apple Watch") => ({
  id: `${start}-${source}`, metric_name: 'sleep_analysis', date: '2026-07-20', source,
  recorded_at: start,
  value: { sleepStart: start, sleepEnd: end, totalSleep: total,
           core: total * 0.6, rem: total * 0.2, deep: total * 0.2, awake: 0 },
})

const cases = [
  ['an interrupted night with five minutes of edge overlap', [
    row(at('19', '23:10:00'), at('20', '03:20:00'), 4.10),
    row(at('20', '03:15:00'), at('20', '07:40:00'), 4.35),
  ], 8.45],
  ['a contained subset sharing the end', [
    row(at('20', '02:00:00'), at('20', '07:00:00'), 5.0),
    row(at('20', '05:00:00'), at('20', '07:00:00'), 2.0),
  ], 5],
  ['the live 4.94h / 3.34h subset pair', [
    row(at('20', '02:00:00'), at('20', '07:27:00'), 4.94),
    row(at('20', '03:36:00'), at('20', '07:27:00'), 3.34),
  ], 4.94],
  ['a partial delivery and the complete re-export sharing a start', [
    row(at('20', '02:00:51'), at('20', '05:00:00'), 3.00),
    row(at('20', '02:00:51'), at('20', '07:27:08'), 4.94, "Watch|Watch"),
  ], 4.94],
  ['two blocks that do not touch at all', [
    row(at('19', '23:10:00'), at('20', '03:10:00'), 4.00),
    row(at('20', '03:20:00'), at('20', '07:40:00'), 4.33),
  ], 8.33],
  ['a half-overlapping session, under the containment bar', [
    row(at('20', '01:00:00'), at('20', '02:00:00'), 1.0),
    row(at('20', '01:30:00'), at('20', '06:00:00'), 4.5),
  ], 5.5],
  ['a single clean night', [row(at('20', '00:51:00'), at('20', '09:55:00'), 8.64)], 8.64],
]

for (const [label, rows, expected] of cases) {
  const ai  = aiNights(rows)
  const web = computeSleepSummary(rows)

  // One row per NIGHT, never one per session — the defect the old version of
  // this script could not see.
  check(`rows     · ${label}`, [ai.length, web.length], [1, 1])
  check(`ai-proxy · ${label}`, round(ai[0].hours), expected)
  check(`web app  · ${label}`, round(web[0].total), expected)
  // The point of this script: the two implementations must not drift apart.
  check(`AGREE    · ${label}`, round(ai[0].hours), round(web[0].total))
  check(`stages   · ${label}`,
    [round(ai[0].deep_h), round(ai[0].core_h), round(ai[0].rem_h)],
    [round(web[0].deep), round(web[0].core), round(web[0].rem)])
  // Row order must not change either answer.
  const rev = [...rows].reverse()
  check(`order    · ${label}`,
    [round(aiNights(rev)[0].hours), round(computeSleepSummary(rev)[0].total)], [expected, expected])
}

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log('ai-proxy and healthAggregate agree on every sleep fixture.\n')
