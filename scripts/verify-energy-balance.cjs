#!/usr/bin/env node
/*
 * Verification — src/features/health/goal/energyBalance.ts, the energy half
 * of the goal report (food diary vs Apple energy vs the weight trend). Real module through
 * sucrase, no test framework.
 *
 * Run: node scripts/verify-energy-balance.cjs
 */
require('sucrase/register')
const EB = require('../src/features/health/goal/energyBalance.ts')
const { buildEnergyReport: buildCutReport, linearFit, movingAverage7, proteinBand, addDays, neededDays, ENERGY_DENSITY_KCAL_PER_KG: D } = EB

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

const FROM = '2026-08-01'
const days = n => Array.from({ length: n }, (_, i) => addDays(FROM, i))

/** A synthetic window: `intake` eaten per logged day, Apple `tdee`, and a
 *  straight weight line losing `kgPerDay` from `startKg` (weigh-ins every day
 *  incl. the morning after the window). `noise` alternates ± on the weights. */
function scenario({ n = 28, intake = 2000, tdee = 2700, kgPerDay, startKg = 90, logEvery = 1, noise = 0, protein = 160, phaseStartDate = null, goal = 'cut' }) {
  const ds = days(n)
  const to = ds[ds.length - 1]
  return {
    from: FROM, to,
    intake: ds.filter((_, i) => i % logEvery === 0).map(date => ({ date, kcal: intake, proteinG: protein })),
    energy: ds.map(date => ({ date, activeKcal: tdee - 1900, basalKcal: 1900 })),
    weights: [...ds, addDays(to, 1)].map((date, i) => ({ date, kg: startKg + kgPerDay * i + (noise ? (i % 2 ? noise : -noise) : 0) })),
    phaseStartDate, goal,
  }
}

// §1 Perfect match: a 700 kcal/day logged deficit and the matching loss
{
  const r = buildCutReport(scenario({ kgPerDay: -700 / D }))
  check('§1.1 verdict on track', r.verdict, 'on_track')
  check('§1.2 logged deficit', r.loggedDeficit, 700)
  near('§1.3 expected ≈ actual change', r.expectedChangeKg, r.weight.changeKg, 0.02)
  near('§1.4 observed TDEE = Apple TDEE', r.observedTdee, 2700, 1)
  near('§1.5 gap ≈ 0', r.tdeeGap, 0, 1)
  check('§1.6 no missing data', r.missing, [])
  check('§1.7 high confidence (28 days, daily logs + weigh-ins, clean trend)', r.confidence, 'high')
  near('§1.8 kg/week', r.weight.kgPerWeek, -7 * 700 / D, 0.01)
}

// §2 Observed TDEE math: intake 2,000, losing 0.1 kg/day → 2,000 + 770 = 2,770
{
  const r = buildCutReport(scenario({ kgPerDay: -0.1, tdee: 2770 }))
  near('§2.1 observed TDEE = intake + loss × 7700', r.observedTdee, 2770, 1)
  check('§2.2 matches Apple → on track', r.verdict, 'on_track')
  near('§2.3 %BW/week uses the mean weight', r.weight.pctPerWeek, (0.7 / (90 - 0.1 * 14.5)) * 100, 0.02)
}

// §3 Under-logging: you ate ~400 kcal/day more than the diary says, so the
//    scale loses LESS than the logged deficit predicts (700 logged, 300 real)
//    → slower than your numbers say.
{
  const r = buildCutReport(scenario({ kgPerDay: -300 / D }))
  check('§3.1 verdict slower', r.verdict, 'slower')
  near('§3.2 observed TDEE 2,300 vs Apple 2,700', r.observedTdee, 2300, 1)
  near('§3.3 gap −400 kcal/day', r.tdeeGap, -400, 1)
  check('§3.4 reasons name logging and Apple, logging first', r.reasons, ['intake_underlogged', 'apple_overestimates'])
  check('§3.5 expected loss bigger than actual', r.expectedChangeKg < r.weight.changeKg, true)
}

// §4 Overestimated expenditure: logging is complete, Apple reads 500 high →
//    same "slower" verdict; with gaps in the diary, partial logging leads.
{
  const r = buildCutReport(scenario({ tdee: 3000, kgPerDay: -500 / D }))
  check('§4.1 Apple 500 high → slower', r.verdict, 'slower')
  near('§4.2 observed TDEE is the real 2,500', r.observedTdee, 2500, 1)
  const p = buildCutReport(scenario({ tdee: 3000, kgPerDay: -500 / D, logEvery: 1, n: 28 }))
  check('§4.3 complete diary → no partial-logging reason', p.reasons.includes('partial_logging'), false)
  const s = scenario({ tdee: 3000, kgPerDay: -500 / D })
  s.intake = s.intake.filter((_, i) => i % 5 !== 0) // 22 of 28 days logged
  const q = buildCutReport(s)
  check('§4.4 gaps in the diary → partial logging named first', q.reasons[0], 'partial_logging')
  check('§4.5 completeness', q.intake.completeness, 0.79)
}

// "Actual loss > expected" (the owner's "better than my numbers") → faster
{
  const r = buildCutReport(scenario({ kgPerDay: -1100 / D }))
  check('§4.6 loss beyond the logged deficit → faster', r.verdict, 'faster')
  check('§4.7 a 28-day window without a cut start → no early/short reasons', r.reasons, ['apple_underestimates', 'intake_overlogged'])
}

// §5 Too little data → no verdict, and it says what's missing
{
  const s = scenario({ kgPerDay: -0.1 })
  s.intake = s.intake.slice(0, 5)
  s.weights = s.weights.filter((_, i) => i % 10 === 0) // 3 weigh-ins
  s.energy = s.energy.slice(0, 6)
  const r = buildCutReport(s)
  check('§5.1 no verdict', r.verdict, null)
  check('§5.2 no confidence', r.confidence, null)
  check('§5.3 three things missing', r.missing.length, 3)
  check('§5.4 names the food shortfall', /Food logged on 5 of 28 days/.test(r.missing[0]), true)
  check('§5.5 no pace trend from 3 weigh-ins', r.hasTrend, false)
  // Half-logged days (a coffee) don't count as logged
  const t = scenario({ kgPerDay: -0.1 })
  t.intake = t.intake.map((x, i) => (i < 20 ? { ...x, kcal: 300 } : x))
  const u = buildCutReport(t)
  check('§5.6 days under 800 kcal are partial, not logged', [u.intake.loggedDays, u.intake.partialDays], [8, 20])
  check('§5.7 …and block the verdict', u.verdict, null)
  // Apple days with the watch off (under 1,550 kcal) don't count
  const w = scenario({ kgPerDay: -0.1 })
  w.energy = w.energy.map((e, i) => (i < 20 ? { ...e, activeKcal: 0, basalKcal: 900 } : e))
  check('§5.8 incomplete Apple days are skipped', buildCutReport(w).apple.days, 8)
  // Weigh-ins bunched at one end
  const b = scenario({ kgPerDay: -0.1 })
  b.weights = b.weights.slice(0, 6)
  check('§5.9 weigh-ins spanning 5 days → no verdict', buildCutReport(b).verdict, null)
}

// §6 Water-weight early window: fast loss in the first weeks of a cut
{
  const r = buildCutReport(scenario({ n: 14, kgPerDay: -1500 / D, phaseStartDate: FROM }))
  check('§6.1 early phase flagged', r.earlyPhase, true)
  check('§6.2 verdict faster', r.verdict, 'faster')
  check('§6.3 water/glycogen named first, then the short window', r.reasons.slice(0, 2), ['early_water', 'short_window'])
  check('§6.4 confidence capped below high', r.confidence !== 'high', true)
  const late = buildCutReport(scenario({ n: 28, kgPerDay: -1500 / D, phaseStartDate: '2026-06-01' }))
  check('§6.5 a cut started two months ago is not early', late.earlyPhase, false)
}

// §7 Early weeks follow the phase: a gain's water refill shows as "slower"
//    (more weight than the surplus predicts), maintain has no early phase
{
  const g = buildCutReport(scenario({ n: 14, goal: 'gain', intake: 3000, tdee: 2700, kgPerDay: 900 / D, phaseStartDate: FROM }))
  check('§7.1 gain early phase flagged', g.earlyPhase, true)
  check('§7.2 gaining faster than a 300 kcal surplus predicts → slower verdict', g.verdict, 'slower')
  check('§7.3 …with glycogen/water named first', g.reasons[0], 'early_water')
  check('§7.4 gain water note in the confidence notes', g.confidenceNotes.some(n => /gain/.test(n)), true)
  const m = buildCutReport(scenario({ n: 14, goal: 'maintain', kgPerDay: -1500 / D, phaseStartDate: FROM }))
  check('§7.5 maintain has no early phase', m.earlyPhase, false)
  check('§7.6 a surplus reads as a negative logged deficit', g.loggedDeficit, -300)
  check('§7.7 neededDays', [neededDays(14), neededDays(28), neededDays(56)], [9, 17, 34])
}

// §8 Protein g/kg (Morton 2018 floor 1.6, upper ~2.2) and per kg FFM (Helms)
check('§8.1 below floor', proteinBand(1.4), 'below_floor')
check('§8.2 in range', proteinBand(1.8), 'in_range')
check('§8.3 high', proteinBand(2.5), 'high')
{
  const s = scenario({ kgPerDay: -0.05, protein: 144, startKg: 80 })
  s.leanMassKg = 63.7
  const r = buildCutReport(s)
  near('§8.4 g/kg from the trend weight', r.protein.gPerKg, 144 / (80 - 0.05 * 28), 0.01)
  near('§8.5 g/kg FFM from the scale lean mass', r.protein.gPerKgFfm, 144 / 63.7, 0.01)
  check('§8.6 no lean mass → no FFM figure', buildCutReport(scenario({ kgPerDay: -0.05 })).protein.gPerKgFfm, null)
}

// §10 Helpers
{
  const f = linearFit([0, 1, 2, 3], [10, 9, 8, 7])
  check('§10.1 OLS slope', f.slope, -1)
  check('§10.2 OLS SE of a perfect line', f.se, 0)
  const ma = movingAverage7([{ date: '2026-08-01', kg: 80 }, { date: '2026-08-02', kg: 82 }, { date: '2026-08-09', kg: 84 }])
  check('§10.3 7-day moving average of weigh-ins only', ma.map(p => p.avg7), [80, 81, 84])
  const noisy = buildCutReport(scenario({ kgPerDay: -700 / D, noise: 1.5 }))
  check('§10.4 a noisy trend lowers confidence', noisy.confidence !== 'high', true)
  check('§10.5 a noisy trend still matches when centred', noisy.verdict, 'on_track')
}

if (failures.length) {
  console.error(`✗ ${failures.length} failed, ${passed} passed\n\n` + failures.join('\n\n'))
  process.exit(1)
}
console.log(`✓ verify-energy-balance: ${passed} assertions passed`)
