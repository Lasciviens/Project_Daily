#!/usr/bin/env node
/* Verification — THE goal decision (src/features/health/goal/cutDecision.ts):
 * protein from lean mass, the calorie floor, the precedence gates, and the
 * path headline it replaces (goalPath.applyDecision).
 * Run: node scripts/verify-cut-decision.cjs */
require('sucrase/register')
const D = require('../src/features/health/goal/cutDecision')
const GP = require('../src/features/health/goal/goalPath')
let passed = 0, failed = 0
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`) }
}
const ok = (name, cond, detail) => check(name + (cond || detail == null ? '' : ` (${JSON.stringify(detail)})`), !!cond, true)

// The owner's case: 83 kg, 24.6 % body fat, −0.29 kg/wk on a cut, target 1,950.
const OWNER = {
  phase: 'cut', today: '2026-09-29', weightKg: 83, bodyFatPct: 24.6,
  pctPerWeek: (-0.29 / 83) * 100, kgPerWeek: -0.29, weighIns: 22, weighInSpanDays: 27, loggedDays7: 6,
  targetKcal: 1950, targetProteinG: 200, loggedIntakeKcal: 1950, appleBurnKcal: 2450,
  scaleBurnKcal: 1950 + Math.round(0.29 * 7700 / 7), muscleWatch: 'ok',
  phaseStartDate: '2026-08-15', lastCalorieAdjust: null, steps7: 7500,
}
const I = (p = {}) => ({ ...OWNER, ...p })

console.log('\n§1 Protein (A)')
{
  const p = D.proteinAdvice('cut', 83, 24.6, 200)
  check('§1.1 owner: target 175 g from 2.8 g/kg lean mass', p.targetG, 175)
  check('§1.2 owner: range 145–195', [p.lowG, p.highG], [145, 195])
  check('§1.3 owner: lean mass 62.6 kg', p.ffmKg, 62.6)
  check('§1.4 owner: 200 g sits outside the range', p.inRange, false)
  check('§1.5 wording', p.text, 'Aim ~175 g (145–195) — more costs calories without clear extra benefit.')
  check('§1.6 no body fat, cut: 2.0 g/kg', D.proteinAdvice('cut', 83, null).targetG, 165)
  check('§1.7 no body fat, maintain: 1.8 g/kg', D.proteinAdvice('maintain', 83, null).targetG, 150)
  check('§1.8 very lean: clamped to 2.2 g/kg bodyweight', D.proteinAdvice('cut', 80, 8).targetG, 175)
  check('§1.9 high body fat: floored at 1.6 g/kg bodyweight', D.proteinAdvice('cut', 120, 45).targetG, 190)
  check('§1.10 inRange when the target is inside', D.proteinAdvice('cut', 83, 24.6, 170).inRange, true)
  check('§1.11 ~0.4 g/kg per meal', D.proteinAdvice('cut', 83, 24.6).perMealG, 35)
}

console.log('\n§2 Calorie floor (B)')
{
  const f = D.calorieFloor(83, 24.6, 2269)
  check('§2.1 owner: Cunningham resting burn sets it (500 + 22 × 62.6)', [f.kcal, f.basis], [1880, 'resting'])
  check('§2.2 no body fat: 24 kcal/kg', D.calorieFloor(83, null, null).kcal, 1990)
  check('§2.3 75 % of the scale burn when higher', [D.calorieFloor(83, 24.6, 2800).kcal, D.calorieFloor(83, 24.6, 2800).basis], [2100, 'scale'])
  check('§2.4 never below 1,500', D.calorieFloor(50, 30, 1600).kcal, 1500)
  ok('§2.5 labelled a heuristic that only limits cutting', /heuristic that only limits cutting/.test(f.text), f.text)
}

console.log('\n§3 Pace labels')
check('§3.1 cut −0.35 → slow but fine (neutral)', D.paceLabel('cut', -0.35), { label: 'Slow but fine', tone: 'neutral' })
check('§3.2 cut −0.2 → slow (warn, never danger)', D.paceLabel('cut', -0.2), { label: 'Slow', tone: 'warn' })
check('§3.3 cut −0.7 → on track', D.paceLabel('cut', -0.7).label, 'On track')
check('§3.4 cut −1.2 → fast', D.paceLabel('cut', -1.2).label, 'Fast')
check('§3.5 cut −1.6 → much too fast (danger)', D.paceLabel('cut', -1.6).tone, 'danger')
check('§3.6 maintain +0.3 → drifting up', D.paceLabel('maintain', 0.3).label, 'Drifting up')
check('§3.7 gain +0.3 → on track', D.paceLabel('gain', 0.3).label, 'On track')

console.log('\n§4 Gate 3 — the owner\'s case')
{
  const d = D.buildGoalDecision(I())
  check('§4.1 gate', d.gate, 'near_floor')
  check('§4.2 exact text', d.text, "Loss is slow (0.35 %/wk) but you're already near your floor. Check logging for a week (oils, drinks, weekends) and add ~2,500 steps/day (~+120 kcal) before eating less.")
  check('§4.3 no calorie cut offered', [d.calorieDelta, d.suggestedCalories], [null, null])
  check('§4.4 tone neutral (slow but fine)', d.tone, 'neutral')
  check('§4.5 no diet break under 12 weeks', d.dietBreak, false)
  ok('§4.6 "diet break" appears nowhere', !/diet break/i.test(JSON.stringify(d)), d)
  check('§4.7 the same decision carries protein 175', d.protein.targetG, 175)
  check('§4.8 the floor it used', d.floor.kcal, 1880)
  check('§4.9 at most two supporting lines', d.lines.length <= 2, true)
  check('§4.10 already at 10k steps: no step nudge', D.buildGoalDecision(I({ steps7: 11000 })).lines[0], 'Check logging for a week (oils, drinks, weekends) before eating less.')
  check('§4.11 no step data: default +2,500', D.stepNudge(null, 83), { steps: 2500, kcal: 120 })
}

console.log('\n§5 Gate 3 — likely under-logging with room above the floor')
{
  const d = D.buildGoalDecision(I({ targetKcal: 2300, loggedIntakeKcal: 1700, appleBurnKcal: 2600, scaleBurnKcal: 2019 }))
  check('§5.1 still gate 3', d.gate, 'near_floor')
  ok('§5.2 says the diary likely misses food', /diary likely misses some food/.test(d.headline), d.headline)
  check('§5.3 likelyUnderlogging rule', D.likelyUnderlogging({ loggedIntakeKcal: 1700, appleBurnKcal: 2600, scaleBurnKcal: 2019 }), true)
  check('§5.4 no Apple/scale → never flags', D.likelyUnderlogging({ loggedIntakeKcal: 1700, appleBurnKcal: null, scaleBurnKcal: 2019 }), false)
}

console.log('\n§6 Gate 4 — slow with room: the smallest DAILY cut')
{
  const d = D.buildGoalDecision(I({ targetKcal: 2300 }))
  check('§6.1 gate', d.gate, 'cut_more')
  check('§6.2 daily delta (0.15 %/wk × 83 kg × 7,700 ÷ 7 ≈ 137 → 150)', d.calorieDelta, -150)
  check('§6.3 suggested', d.suggestedCalories, 2150)
  ok('§6.4 labelled per day, never a weekly figure', /150 kcal\/day less/.test(d.headline) && !/1,0\d\d|1\.\dk/.test(d.text), d.text)
  const c = D.buildGoalDecision(I({ targetKcal: 1990 }))
  check('§6.5 clamped so the target stays above the floor', [c.gate, c.calorieDelta], ['cut_more', -100])
  const cool = D.buildGoalDecision(I({ targetKcal: 2300, lastCalorieAdjust: '2026-09-24' }))
  check('§6.6 14-day cooldown holds', [cool.gate, cool.calorieDelta, cool.cooldownDaysLeft], ['hold', null, 9])
  ok('§6.7 cooldown date in DD.MM.YYYY', /24\.09\.2026/.test(cool.text), cool.text)
}

console.log('\n§7 Gates 1, 2, 5')
{
  const n = D.buildGoalDecision(I({ loggedDays7: 2, weighIns: 6 }))
  check('§7.1 not enough data wins first', n.gate, 'no_data')
  check('§7.2 says exactly what is missing', n.headline, 'Not enough data yet — log 2 more days (2 of the last 7) and weigh in 4 more times.')
  const f = D.buildGoalDecision(I({ pctPerWeek: -1.2, kgPerWeek: -1 }))
  check('§7.3 losing > 1 %/wk → eat more', [f.gate, f.calorieDelta > 0], ['eat_more', true])
  check('§7.4 …back to the middle of the range (0.45 %/wk × 83 × 7,700 ÷ 7 → 400)', f.calorieDelta, 400)
  const m = D.buildGoalDecision(I({ muscleWatch: 'likely_loss' }))
  check('§7.5 muscle likely_loss beats the slow-loss gate', m.gate, 'eat_more')
  check('§7.6 …and is the one case a diet break is named before 12 weeks', m.dietBreak, true)
  const on = D.buildGoalDecision(I({ pctPerWeek: -0.75, kgPerWeek: -0.62 }))
  check('§7.7 0.5–1 %/wk → on track', [on.gate, on.tone, on.calorieDelta], ['on_track', 'success', null])
  const long = D.buildGoalDecision(I({ pctPerWeek: -0.75, phaseStartDate: '2026-06-01' }))
  check('§7.8 12+ weeks in the cut → diet break mentioned', long.dietBreak, true)
  ok('§7.9 …with the maintenance figure', /diet break at maintenance \(~2,270 kcal\)/.test(long.text), long.text)
  const below = D.buildGoalDecision(I({ pctPerWeek: -0.75, targetKcal: 1700 }))
  check('§7.10 below the floor but on track: no nagging to eat less, no diet break', [below.gate, below.dietBreak], ['on_track', false])
}

console.log('\n§8 Maintain / gain')
{
  const up = D.buildGoalDecision(I({ phase: 'maintain', pctPerWeek: 0.4, kgPerWeek: 0.33 }))
  check('§8.1 maintain drifting up → eat less to hold', [up.gate, up.calorieDelta < 0], ['adjust', true])
  const g = D.buildGoalDecision(I({ phase: 'gain', pctPerWeek: 0.1, kgPerWeek: 0.08 }))
  check('§8.2 gain too slow → eat more', [g.gate, g.calorieDelta > 0], ['adjust', true])
  check('§8.3 gain on track', D.buildGoalDecision(I({ phase: 'gain', pctPerWeek: 0.35 })).gate, 'on_track')
  check('§8.4 no fat floor outside a cut', up.fatFloorG, null)
}

console.log('\n§9 Goal progress path reads the same decision')
{
  const d = D.buildGoalDecision(I())
  const path = { title: 'Losing slowly', tone: 'neutral', summary: ['x'], steps: [
    { key: 'calories', text: 'To speed up: eat about 150 kcal a day less.' },
    { key: 'protein', text: 'Push protein toward 2.2 g per kg.' },
    { key: 'training', text: 'Keep lifting.' },
  ] }
  const out = GP.applyDecision(path, d, 150)
  check('§9.1 headline = the decision', out.title, d.headline)
  ok('§9.2 no "speed up" left anywhere', !/speed up/i.test(JSON.stringify(out)), out)
  check('§9.3 protein step = the decision range', out.steps.find(s => s.key === 'protein').text, 'Aim for ~175 g protein a day (145–195 g); you average 150 g.')
  check('§9.4 training step kept', out.steps.some(s => s.key === 'training'), true)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
