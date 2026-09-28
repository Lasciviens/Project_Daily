#!/usr/bin/env node
/*
 * Verification — the goal report (Health → Goal progress): phase-aware pace
 * (bodyGoal.ts), fat vs muscle from the smart scale, goal progress and
 * projected dates, the path copy (goalPath.ts), the assembler (goalReport.ts),
 * the device-local → account goal settings (goalSettings.ts) and
 * athleteProfileApi's migration-111 fallback. Real modules through sucrase,
 * synthetic data only, no test framework.
 *
 * Run: node scripts/verify-body-goal.cjs
 */
require('sucrase/register')
const Module = require('module')
const BG = require('../src/features/health/goal/bodyGoal.ts')
const GP = require('../src/features/health/goal/goalPath.ts')
const GR = require('../src/features/health/goal/goalReport.ts')
const GS = require('../src/features/health/goal/goalSettings.ts')
const { addDays } = require('../src/features/health/goal/energyBalance.ts')

let passed = 0
const failures = []
function check(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++
  else failures.push(`${label}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`)
}
function near(label, actual, expected, tol) {
  if (actual != null && Math.abs(actual - expected) <= tol) passed++
  else failures.push(`${label}\n    expected ${expected} ±${tol}\n    actual   ${actual}`)
}
const ok = (label, cond, info) => check(label + (cond ? '' : ` (${JSON.stringify(info)})`), !!cond, true)

const FROM = '2026-08-01'
const D = 7700

// ── §1 Pace bands per phase (signed %BW/week, + = gaining) ─────────────────
const C = (p, v) => BG.classifyRate(p, v)
check('§1.1 cut: gaining', C('cut', 0.3), 'wrong_way')
check('§1.2 cut: barely moving is too slow', C('cut', -0.05), 'too_slow')
check('§1.3 cut: 0.3 %/wk too slow', C('cut', -0.3), 'too_slow')
check('§1.4 cut: 0.5 is the slow edge of the range', C('cut', -0.5), 'on_track')
check('§1.5 cut: 0.75 on track', C('cut', -0.75), 'on_track')
check('§1.6 cut: 1.0 still on track', C('cut', -1.0), 'on_track')
check('§1.7 cut: 1.2 too fast (Garthe: lean mass held, not grown)', C('cut', -1.2), 'too_fast')
check('§1.8 cut: 1.4 is the last "too fast"', C('cut', -1.4), 'too_fast')
check('§1.9 cut: beyond 1.4 way too fast', C('cut', -1.6), 'way_too_fast')
check('§1.10 gain: losing', C('gain', -0.3), 'wrong_way')
check('§1.11 gain: 0.1 too slow', C('gain', 0.1), 'too_slow')
check('§1.12 gain: 0.25 on track', C('gain', 0.25), 'on_track')
check('§1.13 gain: 0.5 on track', C('gain', 0.5), 'on_track')
check('§1.14 gain: 0.6 too fast', C('gain', 0.6), 'too_fast')
check('§1.15 gain: 0.9 way too fast', C('gain', 0.9), 'way_too_fast')
check('§1.16 maintain: ±0.25 stable', [C('maintain', -0.25), C('maintain', 0), C('maintain', 0.25)], ['stable', 'stable', 'stable'])
check('§1.17 maintain: drifting', [C('maintain', -0.4), C('maintain', 0.4)], ['drifting_down', 'drifting_up'])

// A minimal EnergyReport for the rate verdict.
function energyStub({ kgPerWeek, meanKg = 90, meanKcal = 2400, loggedDays = 28, days = 28, protein = null, band = null, earlyPhase = false }) {
  return {
    days, intake: { loggedDays, partialDays: 0, completeness: loggedDays / days, meanKcal, meanProteinG: protein },
    apple: { days, meanActive: 700, meanBasal: 1900, meanTdee: 2600 }, loggedDeficit: 200,
    weight: { weighIns: 20, spanDays: days, series: [], slopeKgPerDay: kgPerWeek / 7, slopeSe: 0.001, kgPerWeek, pctPerWeek: (-kgPerWeek / meanKg) * 100, meanKg, currentTrendKg: meanKg, changeKg: kgPerWeek * 4 },
    expectedChangeKg: null, observedTdee: null, tdeeGap: null, verdict: null, reasons: [], confidence: null, confidenceNotes: [], missing: [],
    earlyPhase, hasTrend: true, protein: { gPerKg: protein != null ? protein / meanKg : null, band, gPerKgFfm: null }, plannedDeficit: null,
  }
}

// ── §2 kcal advice: the nearest edge of the range (and the middle) ────────
{
  // Cut at 0.3 %/wk at 90 kg → edge 0.5 %: 0.2 % × 90 kg × 7700 / 7 = 198 → 200 less;
  // middle 0.75 %: 445.5 → 450 less.
  const r = BG.buildRateVerdict('cut', energyStub({ kgPerWeek: -0.27 }), { intakeReliable: true })
  check('§2.1 too slow', r.status, 'too_slow')
  check('§2.2 eat ~200 kcal/day less to reach 0.5 %', [r.adjust.kcal, r.adjust.pct], [-200, -0.5])
  check('§2.3 ~450 less aims at the middle', [r.adjustMid.kcal, r.adjustMid.pct], [-450, -0.75])
  check('§2.4 suggested logged intake 2,400 − 200', r.suggestedIntake, 2200)
  near('§2.5 0.5 % of 90 kg a week', r.adjust.kgPerWeek, -0.45, 1e-9)
  const fast = BG.buildRateVerdict('cut', energyStub({ kgPerWeek: -1.35 }), { intakeReliable: false })
  check('§2.6 1.5 %/wk → way too fast', fast.status, 'way_too_fast')
  check('§2.7 back to 1 %: ~500 more; to 0.75 %: ~750 more', [fast.adjust.kcal, fast.adjustMid.kcal], [500, 750])
  check('§2.8 no suggested intake when the diary is thin', fast.suggestedIntake, null)
  const on = BG.buildRateVerdict('cut', energyStub({ kgPerWeek: -0.63 }), { intakeReliable: true })
  check('§2.9 on track → no adjustment', [on.status, on.adjust, on.adjustMid, on.suggestedIntake], ['on_track', null, null, null])
  const gain = BG.buildRateVerdict('gain', energyStub({ kgPerWeek: 0.09, meanKg: 80 }), { intakeReliable: true })
  // 0.1125 % → edge 0.25: 0.1375 % × 80 × 1100 = 121 → 100 more; middle: 231 → 250
  check('§2.10 gain too slow → 100 more (250 for the middle)', [gain.status, gain.adjust.kcal, gain.adjustMid.kcal], ['too_slow', 100, 250])
  const drift = BG.buildRateVerdict('maintain', energyStub({ kgPerWeek: -0.36, meanKg: 80 }), { intakeReliable: true })
  // −0.45 %/wk → 0: 0.45 % × 80 × 1100 = 396 → 400 more; maintain has no "middle" step
  check('§2.11 maintain drifting down → back to steady: 400 more', [drift.status, drift.adjust.kcal, drift.adjustMid], ['drifting_down', 400, null])
  const near05 = BG.buildRateVerdict('cut', energyStub({ kgPerWeek: -0.44 }), { intakeReliable: true })
  check('§2.12 a hair outside the range still gets a 50 kcal step, never 0', near05.adjust.kcal, -50)
  const none = energyStub({ kgPerWeek: -0.5 }); none.hasTrend = false
  check('§2.13 no trend → no verdict', BG.buildRateVerdict('cut', none, { intakeReliable: true }), null)
  check('§2.14 kcalForPace: 1 % of 70 kg a week ≈ 770 → 750; a tiny step is 50', [BG.kcalForPace(0, -1, 70), BG.kcalForPace(0, 0.01, 70)], [-750, 50])
}

// ── §3 Scale readings: one per source and day, never mixed ─────────────────
const A = (metric, date, source, value, hh = '07') => ({ metric, date, recordedAt: `${date}T${hh}:00:00Z`, source, value })
{
  const pts = [
    A('weight_body_mass', FROM, 'ScaleApp', 80), A('body_fat_percentage', FROM, 'ScaleApp', 20), A('lean_body_mass', FROM, 'ScaleApp', 63.9),
    A('weight_body_mass', FROM, 'ScaleApp', 79.6, '08'), // a later weigh-in wins
    A('weight_body_mass', FROM, 'OtherApp', 80), A('body_fat_percentage', FROM, 'OtherApp', 0.22), // fraction → %
    A('weight_body_mass', addDays(FROM, 1), 'ScaleApp', 79.8), // no fat that day
  ]
  const rs = BG.compositionReadings(pts, [{ date: FROM, weightKg: 80, fatPct: 20, fatMassKg: 16, leanMassKg: 64, musclePct: 70 }])
  const scale = rs.find(r => r.source === 'ScaleApp' && r.date === FROM)
  check('§3.1 latest weight of the day', scale.weightKg, 79.6)
  near('§3.2 fat mass = weight × fat %', scale.fatMassKg, 15.92, 0.001)
  check('§3.3 the measured lean mass is used when there is one', scale.leanMassKg, 63.9)
  const other = rs.find(r => r.source === 'OtherApp')
  check('§3.4 fraction body fat becomes a %', other.fatPct, 22)
  near('§3.5 no lean mass → weight − fat mass', other.leanMassKg, 62.4, 0.001)
  check('§3.6 a weight-only day has no fat mass', rs.find(r => r.date === addDays(FROM, 1)).fatMassKg, null)
  const rep = rs.find(r => r.source === BG.REPORT_SOURCE)
  check('§3.7 report muscle mass = weight × muscle %', rep.muscleMassKg, 56)
  check('§3.8 four readings (two sources, two days, one report)', rs.length, 4)
  check('§3.9 an impossible weight is dropped', BG.compositionReadings([A('weight_body_mass', FROM, 'X', 900)], []).length, 0)
  const joined = BG.compositionReadings([A('weight_body_mass', FROM, 'ScaleApp|Phone', 80), A('body_fat_percentage', FROM, 'Phone|ScaleApp|Phone', 20)], [])
  check('§3.10 the same joined source in another order is one source', [joined.length, joined[0].source, joined[0].fatPct], [1, 'Phone|ScaleApp', 20])
}

/** Daily readings from one source: weight, fat and lean moving linearly. */
function series({ n = 28, source = 'ScaleApp', w0 = 90, wPerDay = 0, fat0 = 18, fatPerDay = 0, lean0 = null, leanPerDay = 0, noise = 0, every = 1, muscle = false }) {
  const out = []
  for (let i = 0; i < n; i += every) {
    const e = noise ? (i % 2 ? noise : -noise) : 0
    const fat = fat0 + fatPerDay * i + e
    const lean = (lean0 ?? (w0 - fat0)) + leanPerDay * i - e
    const kg = fat + lean
    out.push({ date: addDays(FROM, i), source, weightKg: kg, fatPct: (fat / kg) * 100, fatMassKg: fat, leanMassKg: lean, muscleMassKg: muscle ? lean * 0.93 : null })
  }
  return out
}
const TO = addDays(FROM, 28)

// ── §4 Trend fitting: 4+ readings over 14+ days, significance vs noise ─────
{
  check('§4.1 three readings → no trend', BG.fitSeries([{ date: FROM, value: 1 }, { date: addDays(FROM, 10), value: 2 }, { date: addDays(FROM, 20), value: 3 }], 0.5), null)
  check('§4.2 span under 14 days → no trend', BG.fitSeries([0, 3, 6, 9, 12].map(d => ({ date: addDays(FROM, d), value: d })), 0.5), null)
  const t = BG.fitSeries([0, 7, 14, 21].map(d => ({ date: addDays(FROM, d), value: 20 - d * 0.05 })), 0.5)
  near('§4.3 fitted change', t.change, -1.05, 1e-9)
  near('§4.4 per week', t.perWeek, -0.35, 1e-9)
  check('§4.5 a clean 1 kg drop is significant', t.significant, true)
  const small = BG.fitSeries([0, 7, 14, 21].map(d => ({ date: addDays(FROM, d), value: 20 - d * 0.01 })), 0.5)
  check('§4.6 0.2 kg is inside the noise floor', small.significant, false)
  const noisy = BG.fitSeries([0, 1, 2, 3, 14, 15].map((d, i) => ({ date: addDays(FROM, d), value: 20 + (i % 2 ? 1.5 : -1.5) - d * 0.05 })), 0.5)
  check('§4.7 a 0.75 kg change buried in ±1.5 kg swings is not significant', noisy.significant, false)
}

// ── §5 Fat vs muscle verdicts ──────────────────────────────────────────────
{
  const V = rs => BG.analyseComposition(rs, FROM, TO)
  const keep = V(series({ fatPerDay: -0.05 }))
  check('§5.1 fat down, lean flat → losing fat, keeping muscle', keep.verdict, 'fat_loss_lean_kept')
  check('§5.2 high confidence with daily readings over 27 days', keep.confidence, 'medium')
  check('§5.3 recomposition', V(series({ fatPerDay: -0.05, leanPerDay: 0.04 })).verdict, 'recomp')
  const some = V(series({ fatPerDay: -0.06, leanPerDay: -0.03 }))
  check('§5.4 fat and some lean down', some.verdict, 'fat_loss_some_lean')
  near('§5.5 lean share of the loss ≈ 1/3', some.leanShare, 0.33, 0.01)
  check('§5.6 more lean than fat lost → losing muscle', V(series({ fatPerDay: -0.02, leanPerDay: -0.05 })).verdict, 'losing_lean')
  check('§5.7 lean down, fat flat → losing muscle', V(series({ leanPerDay: -0.05 })).verdict, 'losing_lean')
  check('§5.8 lean up, fat flat → gaining lean mass', V(series({ leanPerDay: 0.04 })).verdict, 'lean_gain')
  check('§5.9 both up, mostly lean', V(series({ fatPerDay: 0.02, leanPerDay: 0.05 })).verdict, 'lean_gain_some_fat')
  check('§5.10 both up, mostly fat', V(series({ fatPerDay: 0.06, leanPerDay: 0.03 })).verdict, 'mostly_fat_gain')
  check('§5.11 fat up, lean flat', V(series({ fatPerDay: 0.05 })).verdict, 'mostly_fat_gain')
  check('§5.12 fat up, lean down', V(series({ fatPerDay: 0.05, leanPerDay: -0.04 })).verdict, 'fat_gain_lean_loss')
  check('§5.13 nothing beyond noise → stable', V(series({ fatPerDay: 0.005, leanPerDay: -0.005 })).verdict, 'stable')
  const few = V(series({ n: 28, every: 10, fatPerDay: -0.05 }))
  check('§5.14 three readings → not enough data, says why', [few.verdict, /needs 4/.test(few.missing)], ['not_enough_data', true])
  const short = V(series({ n: 10, fatPerDay: -0.1 }))
  check('§5.15 10 days of readings → not enough span', [short.verdict, /needs 14/.test(short.missing)], ['not_enough_data', true])
  check('§5.16 no scale at all', V([]).missing, 'No smart-scale readings with body fat in this window.')
  // Two apps reading the same weigh-ins 2 % body fat apart must not look like fat loss.
  const a = series({ n: 12, source: 'OldApp', fat0: 19 }), b = series({ n: 28, source: 'NewApp', fat0: 17.2 }).filter(r => r.date >= addDays(FROM, 11))
  const mixed = V([...a, ...b])
  check('§5.17 the source with more readings wins', mixed.source, 'NewApp')
  check('§5.18 the other is named, not mixed in', mixed.otherSources, ['OldApp'])
  const withReport = V([...series({ n: 28 }), ...series({ n: 28, every: 3, source: BG.REPORT_SOURCE })])
  check('§5.18b the scale\'s own photo reports are not named as another scale', withReport.otherSources, [])
  check('§5.19 no fake fat loss from the switch', mixed.verdict, 'stable')
  check('§5.20 low confidence on 4 weekly readings', V(series({ n: 28, every: 7, fatPerDay: -0.08 })).confidence, 'low')
  check('§5.20b medium on 6 readings over 25 days', V(series({ n: 28, every: 5, fatPerDay: -0.06 })).confidence, 'medium')
  const withMuscle = V([...series({ fatPerDay: -0.05, source: BG.REPORT_SOURCE, muscle: true, leanPerDay: 0.03 })])
  ok('§5.21 report muscle trend follows its lean mass', withMuscle.muscle && withMuscle.muscle.change > 0.5, withMuscle.muscle)
  // Weigh-ins the scale saved without a body fat % don't count as fat readings.
  const noFat = [...series({ n: 28, every: 10, fatPerDay: -0.05 }), ...series({ n: 28, every: 3 }).map(r => ({ ...r, fatPct: null, fatMassKg: null }))]
  const nf = V(noFat)
  check('§5.23 fat-less weigh-ins are not counted as readings', [nf.verdict, nf.readings, /3 scale readings with body fat/.test(nf.missing)], ['not_enough_data', 3, true])
  check('§5.22 twelve daily readings over 28+ days → high confidence', V(series({ n: 29, fatPerDay: -0.05 })).confidence, 'high')
}

// ── §6 Goal progress and projected dates ───────────────────────────────────
{
  const pts = [0, 7, 14, 21, 28].map(d => ({ date: addDays(FROM, d), value: 90 - d * 0.1 }))
  const trend = { slopePerDay: -0.1, current: 87.2, lastDate: addDays(FROM, 28), significant: true }
  const g = BG.goalProgress('weight', 85, { points: pts, trend }, FROM)
  check('§6.1 moving toward the goal', g.status, 'moving_toward')
  check('§6.2 2.2 kg at 0.1 kg/day → 22 days', g.eta.days, 22)
  check('§6.3 projected date', g.eta.date, addDays(addDays(FROM, 28), 22))
  check('§6.4 baseline = first week after the phase start (one reading here)', [g.start, g.startDate], [90, FROM])
  near('§6.4b baseline averages the first week', BG.startValue([0, 2, 4, 9].map(d => ({ date: addDays(FROM, d), value: 90 - d })), FROM).value, 88, 1e-9)
  near('§6.5 progress share', g.progress, (87.2 - 90) / (85 - 90), 1e-9)
  check('§6.6 already past the goal → reached', BG.goalProgress('weight', 88, { points: pts, trend }, FROM).status, 'reached')
  check('§6.7 moving away', BG.goalProgress('weight', 95, { points: pts, trend }, null).status, 'moving_away')
  check('§6.8 flat trend', BG.goalProgress('weight', 85, { points: pts, trend: { ...trend, significant: false } }, null).status, 'flat')
  check('§6.9 no trend but a reading', BG.goalProgress('bodyFat', 15, { points: [{ date: FROM, value: 20 }], trend: null }, null).status, 'no_trend')
  check('§6.10 no readings', BG.goalProgress('muscle', 60, { points: [], trend: null }, null).status, 'no_data')
  check('§6.11 no goal set', BG.goalProgress('muscle', null, { points: [], trend: null }, null), null)
  check('§6.12 years away', BG.goalProgress('weight', 20 + 60, { points: pts, trend: { ...trend, slopePerDay: -0.005 } }, null).eta, 'too_far')
  check('§6.13 within tolerance counts as reached', BG.goalProgress('bodyFat', 20.3, { points: [{ date: FROM, value: 20 }], trend: null }, null).status, 'reached')
  const up = BG.goalProgress('muscle', 60, { points: [{ date: FROM, value: 55 }], trend: { slopePerDay: 0.02, current: 56, lastDate: addDays(FROM, 30), significant: true } }, FROM)
  check('§6.14 a muscle goal above the current value moves up', [up.status, up.eta.days], ['moving_toward', 200])
  check('§6.15 no start before the phase start date', BG.startValue(pts, addDays(FROM, 40)), null)
}

// ── §7 Path: headline + steps by phase ─────────────────────────────────────
{
  const comp = v => ({ verdict: v, source: 'S', otherSources: [], readings: 20, spanDays: 27, fat: null, lean: null, fatPct: null, muscle: null, leanShare: null, confidence: 'medium', missing: v === 'not_enough_data' ? '2 scale readings in this window — needs 4.' : null })
  const rate = (phase, kgPerWeek, meanKg = 90, opts = { intakeReliable: true }) => BG.buildRateVerdict(phase, energyStub({ kgPerWeek, meanKg }), opts)
  const P = (phase, r, v, e = energyStub({ kgPerWeek: -0.6, protein: 170, band: 'in_range' })) => GP.buildPath({ phase, rate: r, comp: comp(v), energy: e, weightKg: 90 })

  const good = P('cut', rate('cut', -0.63), 'fat_loss_lean_kept')
  check('§7.1 cut on track, keeping muscle', [good.title, good.tone], ['On track: losing fat, keeping muscle', 'success'])
  check('§7.2 …says keep going first', good.steps[0].key, 'keep')
  ok('§7.3 …pace sentence names the range', /inside the 0\.5–1 %/.test(good.summary[0]), good.summary)
  const slow = P('cut', rate('cut', -0.27), 'fat_loss_lean_kept')
  check('§7.4 cut slow → can speed up', slow.title, 'Losing fat, keeping muscle — you can speed up')
  ok('§7.5 …by a concrete amount, with the middle as the alternative', /To speed up: eat about 200 kcal a day less \(around 2,200 kcal logged a day\) to reach 0\.5 % a week \(0\.45 kg\); about 450 less aims at the middle of the range, 0\.75 %\./.test(slow.steps[0].text), slow.steps[0])
  const fast = P('cut', rate('cut', -1.35), 'fat_loss_some_lean', energyStub({ kgPerWeek: -1.35, protein: 120, band: 'below_floor' }))
  check('§7.6 cut way too fast → muscle at risk', [fast.title, fast.tone], ['Too fast — muscle is at risk', 'danger'])
  ok('§7.7 …slow down step', /To slow down and protect muscle: eat about 500 kcal a day more \(around 2,900 kcal logged a day\) to reach 1 % a week \(0\.9 kg\)/.test(fast.steps[0].text), fast.steps[0])
  ok('§7.8 …protein step with grams (1.6 → 144 g, 2.2 → 198 g)', fast.steps.some(s => s.key === 'protein' && /144 g a day/.test(s.text) && /198 g/.test(s.text)), fast.steps)
  ok('§7.9 …lift heavy', fast.steps.some(s => s.key === 'training' && /lifting heavy/.test(s.text)), fast.steps)
  check('§7.10 losing lean outranks pace', P('cut', rate('cut', -0.63), 'losing_lean').title, 'Losing muscle faster than fat')
  const someLean = P('cut', rate('cut', -0.9), 'fat_loss_some_lean')
  check('§7.10b in-range pace but some muscle going → headline', someLean.title, 'Losing fat and some muscle')
  ok('§7.10c …slow from 1 % to the gentle end (0.5 % of 90 kg ≈ 495 → 500 kcal more)', someLean.steps.some(s => s.key === 'calories' && /To protect muscle, slow down: eat about 500 kcal a day more to lose about 0\.5 % a week \(0\.45 kg\)/.test(s.text)), someLean.steps)
  ok('§7.10d …push protein toward 2.2 g/kg', someLean.steps.some(s => s.key === 'protein' && /2\.2 g per kg/.test(s.text)), someLean.steps)
  ok('§7.10e …keep lifting heavy', someLean.steps.some(s => s.key === 'training' && /lifting heavy/.test(s.text)), someLean.steps)
  check('§7.11 cut but gaining', P('cut', rate('cut', 0.3), 'not_enough_data').title, 'Weight is going up, not down')
  const recomp = P('cut', rate('cut', -0.27), 'recomp')
  check('§7.12 recomposition beats "too slow"', recomp.title, 'Recomposition: fat down, muscle up')
  check('§7.13 gain on track, lean', P('gain', rate('gain', 0.3, 80), 'lean_gain_some_fat').title, 'On track: gaining lean mass')
  const gFat = P('gain', rate('gain', 0.3, 80), 'mostly_fat_gain')
  check('§7.14 gain mostly fat', [gFat.title, gFat.tone], ['Gaining mostly fat', 'warn'])
  ok('§7.15 …trim the surplus even though the pace is in range', gFat.steps.some(s => s.key === 'calories' && /Trim the surplus/.test(s.text)), gFat.steps)
  check('§7.16 gain too fast', P('gain', rate('gain', 0.5, 80), 'not_enough_data').title, 'A bit fast — more of the gain will be fat')
  check('§7.17 maintain steady', P('maintain', rate('maintain', 0.05, 80), 'stable').title, 'Holding steady')
  check('§7.18 maintain drifting up', P('maintain', rate('maintain', 0.36, 80), 'not_enough_data').title, 'Drifting up')
  const up = P('maintain', rate('maintain', 0.36, 80), 'not_enough_data')
  ok('§7.18b …with a plain "hold steady" step', up.steps[0].text === 'To hold steady: eat about 400 kcal a day less (around 2,000 kcal logged a day).', up.steps[0])
  ok('§7.18c …and a readable pace sentence', /above the ±0\.25 % a week range\.$/.test(up.summary[0]), up.summary)
  check('§7.18d cut on track without scale data: keep the pace (no claim about composition)', P('cut', rate('cut', -0.63), 'not_enough_data').steps[0].text, 'Keep doing what you are doing — this is the pace to aim for.')
  const none = P('cut', null, 'not_enough_data', energyStub({ kgPerWeek: 0 }))
  check('§7.19 nothing to go on', none.title, 'Not enough data for a verdict yet')
  ok('§7.20 …asks for weigh-ins and scale readings', none.steps.filter(s => s.key === 'data').length === 2, none.steps)
  const early = P('gain', rate('gain', 0.4, 80), 'not_enough_data', energyStub({ kgPerWeek: 0.4, meanKg: 80, earlyPhase: true, protein: 150, band: 'in_range' }))
  ok('§7.21 early gain water note', early.steps.some(s => s.key === 'early' && /glycogen and water/.test(s.text)), early.steps)
  check('§7.22 composition-only headline when there is no pace', P('maintain', null, 'recomp').title, 'Recomposition at maintenance: fat down, muscle up')
  ok('§7.23 every composition verdict has a sentence', Object.keys(GP.COMPOSITION_SENTENCE).length === 10, Object.keys(GP.COMPOSITION_SENTENCE))
}

// ── §8 The assembled report ────────────────────────────────────────────────
{
  const n = 28, to = addDays(FROM, n - 1)
  const days = Array.from({ length: n }, (_, i) => addDays(FROM, i))
  // Losing 0.09 kg/day at 90 kg ≈ 0.7 %/wk, of which fat −0.08 and lean −0.01.
  const readings = series({ n: n + 1, w0: 90, fat0: 18, fatPerDay: -0.08, leanPerDay: -0.01 })
  const r = GR.buildGoalReport({
    from: FROM, to, phase: 'cut', phaseStartDate: FROM,
    intake: days.map(date => ({ date, kcal: 2000, proteinG: 170 })),
    energy: days.map(date => ({ date, activeKcal: 793, basalKcal: 1900 })),
    weights: readings.map(x => ({ date: x.date, kg: x.weightKg })),
    weightHistory: readings.map(x => ({ date: x.date, kg: x.weightKg })),
    readings,
    goals: { weightKg: 85, bodyFatPct: 15, muscleMassKg: null },
  })
  check('§8.1 pace on track', r.rate.status, 'on_track')
  check('§8.2 fat down, lean inside the noise', r.comp.verdict, 'fat_loss_lean_kept')
  check('§8.3 headline', r.path.title, 'On track: losing fat, keeping muscle')
  check('§8.4 weight goal projected', r.goals.weight.status, 'moving_toward')
  check('§8.5 body-fat goal projected from the fat % trend', r.goals.bodyFat.status, 'moving_toward')
  check('§8.6 muscle goal not set', r.goals.muscle, null)
  near('§8.7 lean mass feeds protein per kg FFM', r.energy.protein.gPerKgFfm, 170 / r.latest.leanKg, 0.01)
  check('§8.8 energy verdict still there', r.energy.verdict, 'on_track')
  // A 14-day window: fat vs muscle still reads the last 28 days.
  const short = GR.buildGoalReport({
    from: addDays(FROM, 14), to, phase: 'cut', phaseStartDate: null,
    intake: [], energy: [], weights: readings.map(x => ({ date: x.date, kg: x.weightKg })), weightHistory: [], readings,
    goals: { weightKg: null, bodyFatPct: null, muscleMassKg: null },
  })
  check('§8.9 composition reads 28 days even in a 14-day window', [short.compFrom, short.comp.verdict], [addDays(to, -26), 'fat_loss_lean_kept'])
}

// ── §9 Goal settings: account first, device values fill the gaps ──────────
{
  const legacy = JSON.stringify({ goalWeightKg: 80, cutStartDate: '2026-08-01' })
  check('§9.1 the old cut report settings are read', GS.parseLocalGoals(legacy), { goalWeightKg: 80, goalBodyFatPct: null, goalMuscleMassKg: null, phaseStartDate: '2026-08-01' })
  check('§9.2 junk is ignored', GS.parseLocalGoals('{"goalWeightKg":8,"phaseStartDate":"soon"}'), GS.EMPTY_GOAL_SETTINGS)
  check('§9.3 broken JSON is ignored', GS.parseLocalGoals('{'), GS.EMPTY_GOAL_SETTINGS)
  const local = GS.parseLocalGoals(legacy)
  const pre = GS.resolveGoalSettings(null, local)
  check('§9.4 no account values → device values, flagged', [pre.settings.goalWeightKg, pre.fromDevice], [80, true])
  const acct = { goal_weight_kg: 78, goal_body_fat_pct: 14, goal_muscle_mass_kg: null, phase_start_date: null }
  const mix = GS.resolveGoalSettings(acct, local)
  check('§9.5 the account wins, the device fills the gap', [mix.settings.goalWeightKg, mix.settings.goalBodyFatPct, mix.settings.phaseStartDate, mix.fromDevice], [78, 14, '2026-08-01', true])
  check('§9.6 nothing on the device → not flagged', GS.resolveGoalSettings(acct, GS.EMPTY_GOAL_SETTINGS).fromDevice, false)
  check('§9.7 patch uses the column names', Object.keys(GS.toProfilePatch(mix.settings)), ['goal_weight_kg', 'goal_body_fat_pct', 'goal_muscle_mass_kg', 'phase_start_date'])
  check('§9.8 ranges match the migration CHECKs', [GS.validGoal('goalBodyFatPct', '2.5'), GS.validGoal('goalBodyFatPct', '12,34'), GS.validGoal('goalMuscleMassKg', 151)], [null, 12.3, null])
}

// ── §10 athleteProfileApi: migration-111 columns ───────────────────────────
async function verifyProfileApi() {
  const origResolve = Module._resolveFilename
  let calls = []
  let handler = () => ({ data: null, error: null })
  const builder = table => {
    const state = { table, op: null, row: null }
    const b = {
      upsert(row) { state.op = 'upsert'; state.row = { ...row }; return b },
      select() { if (!state.op) state.op = 'select'; return b },
      single() { calls.push({ ...state }); return Promise.resolve(handler(state)) },
      maybeSingle() { calls.push({ ...state }); return Promise.resolve(handler(state)) },
    }
    return b
  }
  Module._resolveFilename = function (request, parent, ...rest) {
    if (/integrations\/supabase\/client$/.test(request)) return 'stub:supabase'
    if (/shared\/utils\/requireUser$/.test(request)) return 'stub:requireUser'
    return origResolve.call(this, request, parent, ...rest)
  }
  require.cache['stub:supabase'] = { id: 'stub:supabase', filename: 'stub:supabase', loaded: true, exports: { supabase: { from: builder } } }
  require.cache['stub:requireUser'] = { id: 'stub:requireUser', filename: 'stub:requireUser', loaded: true, exports: { requireUser: async () => ({ id: 'u' }) } }
  const api = require('../src/features/training/api/athleteProfileApi')
  Module._resolveFilename = origResolve

  const GOAL = ['goal_weight_kg', 'goal_body_fat_pct', 'goal_muscle_mass_kg', 'phase_start_date']
  const pre111 = st => (st.op === 'upsert' && GOAL.some(k => k in st.row)
    ? { data: null, error: { code: 'PGRST204', message: "Could not find the 'goal_weight_kg' column of 'athlete_profile' in the schema cache" } }
    : { data: { user_id: 'u', goal: st.row?.goal ?? null, updated_at: 'now' }, error: null })
  const rejects = async (fn, re) => { try { await fn(); return false } catch (e) { return re.test(e.message) } }

  handler = pre111
  const read = await api.fetchAthleteProfile()
  check('§10.1 pre-111 read: goal columns are explicit nulls', [read.goal_weight_kg, read.goal_body_fat_pct, read.goal_muscle_mass_kg, read.phase_start_date], [null, null, null, null])
  calls = []
  ok('§10.2 pre-111 goal write: named migration-111 error', await rejects(() => api.upsertAthleteProfile({ goal_weight_kg: 80 }), /migration 111/))
  check('§10.3 …no empty second write', calls.length, 1)
  calls = []
  ok('§10.4 mixed write keeps the other fields, then names 111', await rejects(() => api.upsertAthleteProfile({ goal: 'strength', goal_body_fat_pct: 15 }), /migration 111/))
  check('§10.5 …the retry drops only the goal columns', calls.length === 2 && calls[1].row.goal === 'strength' && !('goal_body_fat_pct' in calls[1].row), true)
  calls = []
  const cleared = await api.upsertAthleteProfile({ goal_weight_kg: null, goal_body_fat_pct: null, goal_muscle_mass_kg: null, phase_start_date: null })
  check('§10.6 clearing goals pre-111 is a quiet no-op', cleared.user_id, 'u')

  handler = st => ({ data: { user_id: 'u', updated_at: 'now', ...st.row, goal_weight_kg: String(st.row.goal_weight_kg), phase_start_date: st.row.phase_start_date }, error: null })
  const saved = await api.upsertAthleteProfile({ goal_weight_kg: 80.5, phase_start_date: '2026-08-01' })
  check('§10.7 post-111: numeric string → number, date kept', [saved.goal_weight_kg, saved.phase_start_date], [80.5, '2026-08-01'])

  // Both groups missing: 110's message comes first, nothing else is lost.
  const HEALTH = ['birth_year', 'sex', 'height_cm']
  handler = st => {
    if (st.op !== 'upsert') return { data: { user_id: 'u' }, error: null }
    const miss = HEALTH.find(k => k in st.row) ?? GOAL.find(k => k in st.row)
    return miss ? { data: null, error: { code: 'PGRST204', message: `Could not find the '${miss}' column` } } : { data: { user_id: 'u', ...st.row }, error: null }
  }
  calls = []
  ok('§10.8 pre-110 and pre-111 together: named 110 error', await rejects(() => api.upsertAthleteProfile({ height_cm: 180, goal_weight_kg: 80, notes: 'x' }), /migration 110/))
  check('§10.9 …notes still saved on the third call', calls.length === 3 && calls[2].row.notes === 'x' && !('goal_weight_kg' in calls[2].row), true)
}

verifyProfileApi().then(() => {
  if (failures.length) {
    console.error(`✗ ${failures.length} failed, ${passed} passed\n\n` + failures.join('\n\n'))
    process.exit(1)
  }
  console.log(`✓ verify-body-goal: ${passed} assertions passed`)
}, err => { console.error(err); process.exit(1) })
