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
const { computeSleepSummary } = require('../src/features/health/healthAggregate.ts')

let passed = 0
const failures = []
function check(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++
  else failures.push(`${label}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`)
}
const round = (n) => Math.round(n * 100) / 100

// ─── The mirror: the edge functions' whole sleep pipeline ────────────────────
// Keep in step with supabase/functions/ai-proxy/index.ts (summarizeSleepNights)
// and supabase/functions/phone-gateway/index.ts (computeSleepNightsGw) by hand.
// It mirrors the whole contract — wake-day night key, manual-wins, the
// containment merge PER NIGHT, raw-stage sums — not just the merge: an earlier
// version compared only the summed total and let a per-session (not per-night)
// row defect through.
const CONTAINMENT = 0.9
const MIN_EXTRA_MS = 15 * 60_000
const ms = (s) => {
  if (typeof s !== 'string') return null
  const iso = s.trim().replace(' ', 'T').replace(/\s*([+-]\d{2}):?(\d{2})$/, '$1:$2')
  let t = Date.parse(iso); if (!Number.isFinite(t)) t = Date.parse(s)
  return Number.isFinite(t) ? t : null
}
function nightKeyOf(r) {
  const end = r.value?.sleepEnd
  if (typeof end === 'string' && /^\d{4}-\d{2}-\d{2}/.test(end) && /[+-]\d{2}:?\d{2}$/.test(end.trim())) return end.slice(0, 10)
  return String(r.date)
}
function mergeRows(pre) {
  const timed = []
  const untimed = []
  const seen = new Set()
  for (const r of pre) {
    const v = r.value ?? {}
    const key = [v.sleepStart ?? r.recorded_at, v.sleepEnd ?? '', v.totalSleep ?? ''].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    const start = ms(v.sleepStart), end = ms(v.sleepEnd)
    if (start != null && end != null && end > start) timed.push({ r, start, end, total: Number(v.totalSleep) || 0, order: timed.length })
    else untimed.push(r)
  }
  const ranked = [...timed].sort((a, b) => (b.total - a.total) || ((b.end - b.start) - (a.end - a.start)) || (a.order - b.order))
  const kept = []
  for (const s of ranked) {
    const dup = kept.some(k => {
      const overlap = Math.min(s.end, k.end) - Math.max(s.start, k.start)
      const span = s.end - s.start
      return overlap > 0 && span > 0 && (overlap / span >= CONTAINMENT || span - overlap < MIN_EXTRA_MS)
    })
    if (!dup) kept.push(s)
  }
  kept.sort((a, b) => a.start - b.start)
  return [...untimed, ...kept.map(k => k.r)]
}
function aiNights(rows) {
  const byNight = new Map()
  for (const r of rows) {
    const k = nightKeyOf(r)
    if (!byNight.has(k)) byNight.set(k, [])
    byNight.get(k).push(r)
  }
  const out = []
  for (const [date, pts] of byNight) {
    const manual = pts.filter(p => p.source === 'manual')
    const src = manual.length > 0 ? manual : pts
    const pre = src.filter(p => typeof p.value?.totalSleep === 'number')
    let core = 0, rem = 0, deep = 0, awake = 0, total = 0
    if (pre.length > 0) {
      for (const p of mergeRows(pre)) {
        const v = p.value
        core += Number(v.core) || 0; rem += Number(v.rem) || 0; deep += Number(v.deep) || 0; awake += Number(v.awake) || 0
        total += typeof v.totalSleep === 'number' ? v.totalSleep : (Number(v.core) || 0) + (Number(v.rem) || 0) + (Number(v.deep) || 0)
      }
    } else {
      let asleep = 0
      for (const p of src) {
        const stage = p.value?.value, qty = p.value?.qty
        if (typeof qty !== 'number') continue
        if (stage === 'Core') core += qty
        else if (stage === 'REM') rem += qty
        else if (stage === 'Deep') deep += qty
        else if (stage === 'Awake') awake += qty
        else if (stage === 'Asleep') asleep += qty
      }
      total = core + rem + deep + asleep
      if (!(total > 0 || awake > 0)) continue
    }
    out.push({ date, hours: round(total), deep_h: round(deep), core_h: round(core), rem_h: round(rem), awake_h: round(awake) })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
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
  // "Since Last Sync" re-summarises the same night on every run from a window
  // that starts ~6 h before its previous run, so a night arrives as a chain of
  // rows sharing ONE sleepEnd with later and later starts (shape of the live
  // rows, values synthetic). The complete row wins; fragments are never added.
  ['a complete night and its "Since Last Sync" fragment chain', [
    row(at('20', '01:05:00'), at('20', '08:30:00'), 7.2),
    row(at('20', '03:10:00'), at('20', '08:30:00'), 5.1),
    row(at('20', '03:50:00'), at('20', '08:30:00'), 4.5),
    row(at('20', '08:05:00'), at('20', '08:30:00'), 0.4),
  ], 7.2],
  // The same chain when the run that should have carried the whole night
  // exported nothing: the EARLIEST fragment is the most complete — never the
  // latest partial, never a sum.
  ['a cut night: fragments only', [
    row(at('20', '02:50:00'), at('20', '09:25:00'), 5.9),
    row(at('20', '07:40:00'), at('20', '09:25:00'), 1.3),
  ], 5.9],
  // Two exporters, one night: a short fragment overhangs the full night by
  // 3 minutes (89.6% contained). Summing would add its whole 0.46 h.
  ['a fragment overhanging the full night by 3 minutes', [
    row(at('19', '23:42:00'), at('20', '07:25:00'), 7.48, 'Other exporter'),
    row(at('20', '07:00:26'), at('20', '07:27:52'), 0.46),
  ], 7.48],
  // …but a block with 20 minutes of its own outside the night is real sleep.
  ['a second block with 20 min of its own', [
    row(at('20', '01:00:00'), at('20', '07:00:00'), 6.0),
    row(at('20', '06:50:00'), at('20', '07:20:00'), 0.5),
  ], 6.5],
  // The same session under two source spellings (a curly apostrophe vs a
  // no-break space — HAE sent both before the webhook canonicalised them).
  ['one session under two source spellings', [
    row(at('20', '00:40:00'), at('20', '08:00:00'), 7.1, 'Furkan’s Apple Watch'),
    row(at('20', '00:40:00'), at('20', '08:00:00'), 7.1, 'Furkan’s Apple\u00a0Watch'),
  ], 7.1],
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

// ─── The manual-night contract (audit T36) ───────────────────────────────────
// A night with a manual entry uses ONLY the manual rows (a deliberate
// correction), filed under the night date the user chose. The edge copies
// adopted the rule (they used to ignore manual rows), so these are real
// assertions now, not a reported divergence.
{
  const manualRows = [
    { id: 'm1', metric_name: 'sleep_analysis', date: '2026-07-20', source: 'manual', recorded_at: '2026-07-20T06:00:00Z', value: { value: 'Deep', qty: 1.2, source: 'manual' } },
    { id: 'm2', metric_name: 'sleep_analysis', date: '2026-07-20', source: 'manual', recorded_at: '2026-07-20T06:00:01Z', value: { value: 'Core', qty: 4.8, source: 'manual' } },
    { id: 'm3', metric_name: 'sleep_analysis', date: '2026-07-20', source: 'manual', recorded_at: '2026-07-20T06:00:02Z', value: { value: 'REM', qty: 2.0, source: 'manual' } },
  ]
  const watch = row(at('20', '02:00:00'), at('20', '06:00:00'), 4.0)
  const web = computeSleepSummary([watch, ...manualRows])
  check('manual  · the manual entry replaces the Watch night', [web.length, round(web[0].total)], [1, 8])
  check('manual  · filed under the night the user picked', web[0].date, '2026-07-20')
  const ai = aiNights([watch, ...manualRows])
  check('manual  · edge copies: the manual entry replaces the Watch night', [ai.length, ai[0] && ai[0].hours], [1, 8])
  check('manual  · AGREE on stages', [ai[0].deep_h, ai[0].core_h, ai[0].rem_h], [round(web[0].deep), round(web[0].core), round(web[0].rem)])

  // A manual night never shadows a neighbouring Watch night.
  const nextNight = row(at('20', '23:30:00'), at('21', '07:00:00'), 7.0)
  const both = aiNights([watch, ...manualRows, nextNight])
  const webBoth = computeSleepSummary([watch, ...manualRows, nextNight])
  check('manual  · the next Watch night is untouched', both.map(n => [n.date, n.hours]), webBoth.map(n => [n.date, round(n.total)]))
}

// ─── Raw per-stage rows (rule 4): Awake is reported, never added ─────────────
{
  const raw = ['Core', 'REM', 'Deep', 'Awake', 'Asleep'].map((stage, i) => ({
    id: `r${i}`, metric_name: 'sleep_analysis', date: '2026-07-22', source: 'Watch', recorded_at: `2026-07-22T0${i}:00:00Z`,
    value: { value: stage, qty: [3, 1.5, 1, 0.5, 0.25][i] },
  }))
  const ai = aiNights(raw)
  const web = computeSleepSummary(raw)
  check('raw     · total = Core+REM+Deep+Asleep', ai[0].hours, 5.75)
  check('raw     · AGREE', [ai[0].hours, ai[0].awake_h], [round(web[0].total), round(web[0].awake)])
}

// ─── Drift guard: the edge files still carry the mirrored rule ───────────────
// The mirror above is only worth something while it matches the real copies.
{
  const fs = require('fs')
  const path = require('path')
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
  const ai = read('supabase/functions/ai-proxy/index.ts')
  const gw = read('supabase/functions/phone-gateway/index.ts')
  check('drift   · ai-proxy containment + 15-min remainder rule',
    [ai.includes('const SLEEP_CONTAINMENT = 0.9'), ai.includes('const SLEEP_MIN_EXTRA_MS = 15 * 60_000'),
     ai.includes('overlap / span >= SLEEP_CONTAINMENT || span - overlap < SLEEP_MIN_EXTRA_MS')], [true, true, true])
  check('drift   · phone-gateway containment + 15-min remainder rule',
    [gw.includes('const CONTAINMENT = 0.9'), gw.includes('const MIN_EXTRA_MS = 15 * 60_000'),
     gw.includes('overlap / span >= CONTAINMENT || span - overlap < MIN_EXTRA_MS')], [true, true, true])
}

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log('ai-proxy and healthAggregate agree on every sleep fixture.\n')
