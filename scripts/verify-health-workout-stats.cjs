#!/usr/bin/env node
/*
 * Verification — a logged workout's deeper numbers, against the REAL
 * un-mocked modules loaded through sucrase (no unit-test runner by this
 * repo's convention). Fixtures are synthetic but shaped like Health Auto
 * Export's per-minute heart-rate samples ("2026-09-24 17:00:00 +0200").
 *   health/workoutStats.ts  — time in each ACSM heart-rate zone, per-minute rates
 *   health/workoutRaw.ts    — heartRateTimeline (timestamps from the raw payload)
 *   training/workoutHealthMatch.ts — the same match rule read from the Apple side
 *
 *   Run:  node scripts/verify-health-workout-stats.cjs
 */
require('sucrase/register')
process.env.TZ = 'Europe/Oslo'

const S = require('../src/features/health/workoutStats')
const raw = require('../src/features/health/workoutRaw')
const B = require('../src/features/health/benchmarks/healthBenchmarks')
const { matchHealthWorkout } = require('../src/features/training/workoutHealthMatch')

let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`) }
}
const T0 = Date.parse('2026-09-24T15:00:00Z')
const min = n => T0 + n * 60_000
const zone = (sum, id) => sum.zones.find(z => z.id === id)

console.log('\n§1 Zone edges (ACSM % of max heart rate)')
const hrMax = B.estimatedMaxHr(27) // 208 − 0.7 × 27 = 189
check('estimated max HR at 27 → 189 (Tanaka)', hrMax === 189, hrMax)
check('zoneFor: 107 bpm (56.6%) → very light', S.zoneFor(107, 189).id === 'very_light')
check('zoneFor: 108 bpm (57.1%) → light', S.zoneFor(108, 189).id === 'light')
check('zoneFor: 121 bpm (64.0%) → moderate — same edge as heartRateZones().moderate[0]', S.zoneFor(121, 189).id === 'moderate' && B.heartRateZones(27).moderate[0] === 121)
check('zoneFor: 145 bpm (76.7%) → moderate; 146 (77.2%) → vigorous', S.zoneFor(145, 189).id === 'moderate' && S.zoneFor(146, 189).id === 'vigorous')
check('zoneFor: 182 bpm (96.3%) → near max', S.zoneFor(182, 189).id === 'max')

console.log('\n§2 timeInZones')
const samples = [
  ...Array.from({ length: 10 }, (_, i) => ({ t: min(i), bpm: 100 })),      // very light
  ...Array.from({ length: 20 }, (_, i) => ({ t: min(10 + i), bpm: 130 })), // moderate
  ...Array.from({ length: 5 }, (_, i) => ({ t: min(30 + i), bpm: 160 })),  // vigorous
]
const sum = S.timeInZones(samples, 189, { endMs: min(35) })
check('35 one-minute samples → 35 min covered', sum && sum.totalSeconds === 35 * 60, sum && sum.totalSeconds)
check('10 min very light, 20 moderate, 5 vigorous', zone(sum, 'very_light').seconds === 600 && zone(sum, 'moderate').seconds === 1200 && zone(sum, 'vigorous').seconds === 300)
check('shares add up to 1', Math.abs(sum.zones.reduce((a, z) => a + z.share, 0) - 1) < 1e-9)
check('moderate-or-harder = 25 min', sum.moderatePlusSeconds === 25 * 60, sum.moderatePlusSeconds)
check('zone bpm ranges at 189: moderate 121–145, vigorous 146–181, near max 182+', zone(sum, 'moderate').lowBpm === 121 && zone(sum, 'moderate').highBpm === 145
  && zone(sum, 'vigorous').lowBpm === 146 && zone(sum, 'vigorous').highBpm === 181 && zone(sum, 'max').lowBpm === 182 && zone(sum, 'max').highBpm === null,
  sum.zones.map(z => [z.id, z.lowBpm, z.highBpm]))
check('every labelled edge agrees with zoneFor (low in, low−1 out)', [150, 160, 175, 189, 200].every(m => S.timeInZones(samples, m).zones.every((z, i, all) =>
  S.zoneFor(z.lowBpm, m).id === z.id && (i === 0 || S.zoneFor(z.lowBpm - 1, m).id === all[i - 1].id))))
const gap = S.timeInZones([{ t: min(0), bpm: 130 }, { t: min(20), bpm: 130 }], 189, { endMs: min(21) })
check('a 20-minute dropout counts at most 3 min, the last sample 1 min', gap.totalSeconds === S.MAX_SAMPLE_SECONDS + 60, gap.totalSeconds)
const last = S.timeInZones([{ t: min(0), bpm: 130 }], 189, { endMs: min(0) + 20_000 })
check('the last sample stops at the workout end (20 s)', last.totalSeconds === 20, last.totalSeconds)
check('the last sample with no end counts 60 s', S.timeInZones([{ t: min(0), bpm: 130 }], 189).totalSeconds === 60)
check('unsorted samples are sorted first', S.timeInZones([{ t: min(1), bpm: 160 }, { t: min(0), bpm: 100 }], 189, { endMs: min(2) }).totalSeconds === 120)
check('no max heart rate (no age) → null', S.timeInZones(samples, null) === null && S.timeInZones(samples, 50) === null)
check('no samples → null', S.timeInZones([], 189) === null)
check('zero and non-finite readings are ignored', S.timeInZones([{ t: min(0), bpm: 0 }, { t: NaN, bpm: 120 }], 189) === null)

console.log('\n§3 heartRateTimeline (HAE raw)')
const hae = { heartRateData: [
  { Avg: 97.25, Max: 99, Min: 96, date: '2026-09-24 17:01:00 +0200' },
  { Avg: 91, Max: 94, Min: 86, date: '2026-09-24 17:00:00 +0200' },
  { Avg: { qty: 120 }, date: '2026-09-24 17:02:00 +0200' },
  { Avg: null, date: '2026-09-24 17:03:00 +0200' },
  { Avg: 100, date: 'garbage' },
] }
const tl = raw.heartRateTimeline(hae)
check('reads plain and {qty} readings, drops unreadable rows', tl.length === 3, tl.length)
check('sorted oldest first with real timestamps (+0200 honoured)', tl[0].t === Date.parse('2026-09-24T15:00:00Z') && tl[0].bpm === 91 && tl[2].bpm === 120)
check('no heartRateData → []', raw.heartRateTimeline({}).length === 0 && raw.heartRateTimeline({ heartRateData: 'x' }).length === 0)

console.log('\n§4 workoutRates')
const r = S.workoutRates({ activeKcal: 248, appleSeconds: 3014, workingSets: 20, volumeKg: 9000, hevySeconds: 3012 })
check('248 kcal over 50.2 min → 4.9 kcal/min', r.kcalPerMin === 4.9, r)
check('20 sets over 50.2 min → 0.4 sets/min, 2.5 min per set', r.setsPerMin === 0.4 && r.minPerSet === 2.5, r)
check('9,000 kg over 50.2 min → 179 kg/min', r.kgPerMin === 179, r)
const none = S.workoutRates({ activeKcal: null, appleSeconds: 30, workingSets: 0, volumeKg: null, hevySeconds: null })
check('missing inputs or under a minute → all null', none.kcalPerMin === null && none.setsPerMin === null && none.minPerSet === null && none.kgPerMin === null, none)

console.log('\n§5 Matching from the Apple side')
const apple = { start_time: '2026-09-24T15:00:40Z', end_time: '2026-09-24T15:50:54Z' }
const hevy = [
  { id: 'lift', start_time: '2026-09-24T15:00:39Z', end_time: '2026-09-24T15:50:52Z' },
  { id: 'other-day', start_time: '2026-09-23T15:00:39Z', end_time: '2026-09-23T15:50:52Z' },
]
check('an Apple strength workout finds its Hevy session', matchHealthWorkout(apple, hevy)?.id === 'lift')
check('an evening walk that doesn’t overlap finds none', matchHealthWorkout({ start_time: '2026-09-24T18:00:00Z', end_time: '2026-09-24T18:30:00Z' }, hevy) === null)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
