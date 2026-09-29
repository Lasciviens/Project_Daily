#!/usr/bin/env node
/*
 * Verification — Muscle watch (Health → Goal progress): the lean-mass-risk
 * reading in src/features/health/goal/muscleWatch.ts, incl. the owner's own
 * numbers (cut since 13.08.2026, scale muscle 58.9 → 58.1 kg, body fat
 * 24.7 → 24.6 %, weight 84.1 → 82.5 kg, muscle goal 67 kg), plus an
 * integration pass through bodyGoal.analyseComposition. Real modules through
 * sucrase, synthetic data only, no test framework.
 *
 * Run: node scripts/verify-muscle-watch.cjs
 */
require('sucrase/register')
const MW = require('../src/features/health/goal/muscleWatch.ts')
const BG = require('../src/features/health/goal/bodyGoal.ts')

let passed = 0
const failures = []
function check(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++
  else failures.push(`${label}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`)
}
const ok = (label, cond, info) => check(label + (cond ? '' : ` (${JSON.stringify(info)})`), !!cond, true)

const START = '2026-08-13'
const TODAY = '2026-09-29'
const add = MW.addDays

// Readings every 3 days from the start: the first week holds the start values,
// the last week the end values, a straight line between.
function ownerReadings({ w0 = 84.1, w1 = 82.5, f0 = 24.7, f1 = 24.6, m0 = 58.9, m1 = 58.1, days = 47, source = 'report' } = {}) {
  const out = []
  for (let d = 0; d <= days; d += 3) {
    const t = d < 7 ? 0 : d > days - 7 ? 1 : (d - 6) / (days - 13)
    const w = w0 + (w1 - w0) * t, f = f0 + (f1 - f0) * t, m = m0 + (m1 - m0) * t
    const fatMass = (w * f) / 100
    out.push({ date: add(START, d), source, weightKg: w, fatPct: f, fatMassKg: fatMass, leanMassKg: w - fatMass, muscleMassKg: m })
  }
  return out
}
const noTrendComp = source => ({ verdict: 'stable', source, otherSources: [], readings: 0, spanDays: 0, fat: null, lean: null, fatPct: null, muscle: null, leanShare: null, confidence: null, missing: null })

function input(over = {}) {
  return {
    today: TODAY, phase: 'cut', from: START,
    readings: ownerReadings(), comp: noTrendComp('report'),
    ratePctPerWeek: -0.9, weightKg: 82.5,
    protein: { meanG: 107, loggedDays: 20, neededDays: 17 },
    lifts: [
      { name: 'Bench', changePct: -6 }, { name: 'Squat', changePct: -7.5 }, { name: 'Row', changePct: -5.5 },
      { name: 'Press', changePct: 1 }, { name: 'RDL', changePct: 3 },
    ],
    sessions: [], targetSessionsPerWeek: null, muscleGoalKg: 67,
    ...over,
  }
}
const reason = (w, signal) => w.reasons.find(r => r.signal === signal)

// ── §1 helpers ─────────────────────────────────────────────────────────────
check('§1.1 DD.MM.YYYY', MW.ddmmyyyy('2026-08-13'), '13.08.2026')
check('§1.2 first-week mean', MW.firstWeekMean([{ date: '2026-08-13', value: 10 }, { date: '2026-08-18', value: 12 }, { date: '2026-08-25', value: 99 }], START).value, 11)
check('§1.3 last-week mean', MW.lastWeekMean([{ date: '2026-09-01', value: 1 }, { date: '2026-09-20', value: 4 }, { date: '2026-09-26', value: 6 }], TODAY).value, 5)
check('§1.4 no change under a week apart', MW.massChange([{ date: START, value: 1 }, { date: add(START, 3), value: 2 }], START, TODAY, null), null)
{
  const m = MW.massChange([{ date: START, value: 60 }, { date: add(START, 40), value: 58.8 }], START, TODAY, null)
  check('§1.5 scale drop 1.2 kg over 40 days counts', MW.scaleDropped(m), true)
  check('§1.6 1.2 kg over 20 days does not (needs 4 weeks)', MW.scaleDropped(MW.massChange([{ date: START, value: 60 }, { date: add(START, 20), value: 58.8 }], START, TODAY, null)), false)
  check('§1.7 0.9 kg over 40 days does not (inside ~1 kg noise)', MW.scaleDropped(MW.massChange([{ date: START, value: 60 }, { date: add(START, 40), value: 59.1 }], START, TODAY, null)), false)
  check('§1.8 a fitted trend supplies the current value', MW.massChange([{ date: START, value: 60 }, { date: add(START, 40), value: 59 }], START, TODAY, { current: 58.5 }).change, -1.5)
}

// ── §2 strength summary ────────────────────────────────────────────────────
{
  const s = MW.summarizeStrength([{ name: 'a', changePct: -6 }, { name: 'b', changePct: -5.1 }, { name: 'c', changePct: 4 }])
  check('§2.1 two lifts down >5 % → strength down', [s.judged, s.downBig, s.up, s.strengthDown], [3, 2, 1, true])
  check('§2.2 exactly −5 % is not "more than 5 %"', MW.summarizeStrength([{ name: 'a', changePct: -5 }, { name: 'b', changePct: -5 }]).strengthDown, false)
  check('§2.3 one lift down is not enough', MW.summarizeStrength([{ name: 'a', changePct: -9 }, { name: 'b', changePct: 0 }]).strengthDown, false)
  check('§2.4 holding: 2+ lifts, none down 2.5 %', MW.summarizeStrength([{ name: 'a', changePct: -2 }, { name: 'b', changePct: 1 }]).holding, true)
  check('§2.5 one lift can\'t be "holding"', MW.summarizeStrength([{ name: 'a', changePct: 3 }]).holding, false)
}

// ── §3 training summary ────────────────────────────────────────────────────
{
  const prev = [30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52].map(d => ({ date: add(TODAY, -d), workingSets: 18 }))
  const last = [3, 10, 17, 24].map(d => ({ date: add(TODAY, -d), workingSets: 18 }))
  const t = MW.summarizeTraining([...prev, ...last], TODAY, null)
  check('§3.1 sessions a week, last 4 vs 4 before', [t.perWeek, t.prevPerWeek], [1, 3])
  check('§3.2 a 3 → 1 drop is flagged', t.dropped, true)
  check('§3.3 below the plan', MW.summarizeTraining(last, TODAY, 3).belowTarget, true)
}

// ── §4 the owner's numbers ─────────────────────────────────────────────────
{
  const w = MW.buildMuscleWatch(input())
  check('§4.1 strength down + lean drop + low protein → likely losing muscle', w.level, 'likely_loss')
  ok('§4.2 headline starts plainly', w.headline.startsWith('You may be losing muscle: 3 of 5 main lifts down more than 5 %'), w.headline)
  ok('§4.3 headline names scale muscle since the phase start', w.headline.includes('scale muscle −0.8 kg since 13.08.2026'), w.headline)
  ok('§4.4 headline names lean mass (−1.1 kg on the scale: fat only −0.5)', w.headline.includes('lean mass −1.1 kg since 13.08.2026'), w.headline)
  ok('§4.5 headline names protein vs the 2.2 aim', w.headline.includes('protein 1.3 g/kg (aim 2.2)'), w.headline)
  check('§4.6 muscle −0.8 kg is inside the ~1 kg noise (neutral)', reason(w, 'muscle').tone, 'neutral')
  ok('§4.7 …and says so', reason(w, 'muscle').text.includes('58.9 → 58.1 kg') && reason(w, 'muscle').text.includes('inside the scale'), reason(w, 'muscle').text)
  check('§4.8 lean −1.1 kg over 4+ weeks is past the noise (warn)', reason(w, 'scale').tone, 'warn')
  ok('§4.9 lean share of the weight lost ≈ 70 %', /about 7\d %/.test(reason(w, 'share').text), reason(w, 'share').text)
  check('§4.10 protein under 1.6 → danger, evidence tier', [reason(w, 'protein').tone, reason(w, 'protein').evidenceTier], ['danger', 'evidence'])
  ok('§4.11 protein aim ≈ 180 g for 82.5 kg', reason(w, 'protein').text.includes('≈180 g') && !reason(w, 'protein').text.includes('200 g'), reason(w, 'protein').text)
  check('§4.12 strength reason is danger', reason(w, 'strength').tone, 'danger')
  check('§4.13 pace 0.9 %/wk is inside the limit', reason(w, 'rate').tone, 'success')
  ok('§4.14 action: protein to about 180 g', w.actions[0].startsWith('Raise protein to about 180 g a day'), w.actions)
  ok('§4.15 action: slow the cut to 0.5 %/wk (+350 kcal)', w.actions.some(a => a.includes('about 350 kcal a day more') && a.includes('0.5 %')), w.actions)
  ok('§4.16 action: keep heavy compound sets', w.actions.some(a => a.includes('heavy compound')), w.actions)
  check('§4.17 confidence: strength + 2 others → high', w.confidence, 'high')
  const g = reason(w, 'goal')
  ok('§4.18 67 kg on a cut is called a long-term target', g && g.text.includes('67.0 kg') && g.text.includes('long-term target, not this phase') && g.text.includes('8.9 kg'), g)
  check('§4.19 window echoed', w.from, START)
  ok('§4.20 no NaN or undefined in any text', ![w.headline, ...w.reasons.map(r => r.text), ...w.actions].some(t => /NaN|undefined/.test(t)), w)
  ok('§4.21 every reason carries a tier', w.reasons.every(r => ['measured', 'evidence', 'heuristic'].includes(r.evidenceTier)), w.reasons)
}

// ── §5 the rules around it ─────────────────────────────────────────────────
{
  const noLifts = MW.buildMuscleWatch(input({ lifts: [] }))
  check('§5.1 owner without lift data → watch, never "losing"', noLifts.level, 'watch')
  ok('§5.2 …and says lifts would decide it', noLifts.headline.includes("can't be judged yet"), noLifts.headline)
  const scaleOnly = MW.buildMuscleWatch(input({ lifts: [], protein: { meanG: 180, loggedDays: 20, neededDays: 17 } }))
  check('§5.3 a scale drop alone is only watch', scaleOnly.level, 'watch')
  const holding = MW.buildMuscleWatch(input({ lifts: [{ name: 'a', changePct: 1 }, { name: 'b', changePct: 3 }], protein: { meanG: 180, loggedDays: 20, neededDays: 17 } }))
  check('§5.4 scale down, lifts holding → watch', holding.level, 'watch')
  ok('§5.5 …with "more likely water"', holding.headline.includes('lifts are holding') && holding.headline.includes('water'), holding.headline)
  const strengthOnly = MW.buildMuscleWatch(input({ readings: [], comp: noTrendComp(null), protein: { meanG: 180, loggedDays: 20, neededDays: 17 } }))
  check('§5.6 strength down alone → watch', strengthOnly.level, 'watch')
  const strengthFast = MW.buildMuscleWatch(input({ readings: [], comp: noTrendComp(null), protein: { meanG: 180, loggedDays: 20, neededDays: 17 }, ratePctPerWeek: -1.2 }))
  check('§5.7 strength down + too fast → likely losing', strengthFast.level, 'likely_loss')
  check('§5.8 rate over 1 %/wk alone → watch', MW.buildMuscleWatch(input({ readings: [], comp: noTrendComp(null), lifts: [], protein: { meanG: 180, loggedDays: 20, neededDays: 17 }, ratePctPerWeek: -1.2 })).level, 'watch')
  check('§5.9 1.2 %/wk is fast (warn), not yet outside the studied range', reason(strengthFast, 'rate').tone, 'warn')
  check('§5.10 low protein alone → watch', MW.buildMuscleWatch(input({ readings: [], comp: noTrendComp(null), lifts: [] })).level, 'watch')
  const fine = MW.buildMuscleWatch(input({
    readings: ownerReadings({ m1: 59.0, w1: 82.9, f1: 23.4 }), protein: { meanG: 180, loggedDays: 20, neededDays: 17 },
    lifts: [{ name: 'a', changePct: 2 }, { name: 'b', changePct: 4 }], ratePctPerWeek: -0.6,
  }))
  check('§5.11 lean held, lifts up, protein ok → ok', fine.level, 'ok')
  ok('§5.12 ok headline says muscle looks protected', fine.headline.startsWith('Muscle looks protected'), fine.headline)
  check('§5.13 ok has no actions', fine.actions, [])
  const nothing = MW.buildMuscleWatch(input({ readings: [], comp: noTrendComp(null), lifts: [], ratePctPerWeek: null, protein: { meanG: null, loggedDays: 0, neededDays: 17 }, muscleGoalKg: null }))
  check('§5.14 nothing readable → not enough data', nothing.level, 'not_enough_data')
  const halfLogged = MW.buildMuscleWatch(input({ protein: { meanG: 50, loggedDays: 5, neededDays: 17 }, readings: [], comp: noTrendComp(null), lifts: [] }))
  check('§5.15 too few logged days: protein isn\'t judged; pace alone can\'t clear muscle', [reason(halfLogged, 'protein').tone, halfLogged.level], ['neutral', 'not_enough_data'])
  check('§5.16 gain phase: 5 kg to go (10 months) is not flagged', reason(MW.buildMuscleWatch(input({ phase: 'gain', muscleGoalKg: 63.1 })), 'goal'), undefined)
  ok('§5.17 gain phase: 8.9 kg to go (18 months) is flagged', reason(MW.buildMuscleWatch(input({ phase: 'gain' })), 'goal'), null)
  ok('§5.18 cut: any gain goal is flagged', reason(MW.buildMuscleWatch(input({ muscleGoalKg: 58.8 })), 'goal'), null)
  check('§5.19 cut: a goal already met is not flagged', reason(MW.buildMuscleWatch(input({ muscleGoalKg: 58 })), 'goal'), undefined)
  check('§5.20 protein aim: 2.2 g/kg on a cut, 1.8 otherwise', [MW.proteinAimG('cut', 83), MW.proteinAimG('maintain', 83)], [185, 150])
}

// ── §6 through analyseComposition (one scale, never two mixed) ─────────────
{
  const rep = ownerReadings()
  // A second scale reading ~2 % body fat higher on the same days must not mix in.
  const other = ownerReadings({ f0: 26.7, f1: 26.6, source: 'Other scale' }).filter((_, i) => i % 2 === 0).map(r => ({ ...r, muscleMassKg: null }))
  const readings = [...rep, ...other]
  const comp = BG.analyseComposition(readings, START, TODAY)
  check('§6.1 the scale with most readings is used', comp.source, 'report')
  const w = MW.buildMuscleWatch(input({ readings, comp }))
  check('§6.2 same level through the real composition analysis', w.level, 'likely_loss')
  ok('§6.3 lean change read from the report scale only', /−1\.[12] kg/.test(reason(w, 'scale').text) && !reason(w, 'scale').text.includes('Other'), reason(w, 'scale').text)
}

if (failures.length) {
  console.error(`✗ ${failures.length} failed, ${passed} passed\n\n` + failures.join('\n\n'))
  process.exit(1)
}
console.log(`✓ verify-muscle-watch: ${passed} assertions passed`)
