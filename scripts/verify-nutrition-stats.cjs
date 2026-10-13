#!/usr/bin/env node
/* Verification — the words of Food · Today's "Last 7 / 14 / 28 days" card
 * (src/features/recipes/nutritionStats.ts over weeklyNutrition.ts).
 * Run: node scripts/verify-nutrition-stats.cjs */
require('sucrase/register')
const { summarizePeriod } = require('../src/features/recipes/weeklyNutrition')
const { buildFindings } = require('../src/features/recipes/nutritionStats')
let passed = 0, failed = 0
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`) }
}
const T = { calories: 2000, protein: 150 }
// 2026-09-28 is a Monday; the 7 days run Tue 22 → Mon 28 (Sat 26, Sun 27 = weekend).
const row = (date, kcal, p, fat = 60, fiber = 22) => ({ date, calories: kcal, protein_g: p, carbs_g: 200, fat_g: fat, fiber_g: fiber, sugar_g: 30 })
const rows = [
  row('2026-09-22', 1950, 160), row('2026-09-23', 2050, 155), row('2026-09-24', 2000, 120),
  row('2026-09-25', 2100, 150), row('2026-09-26', 2700, 110), row('2026-09-27', 2650, 130),
  row('2026-09-10', 3000, 60),  // outside 7, inside 28
]
const find = (fs, k) => fs.find(f => f.key === k)
const run = (opts = {}) => {
  const s = summarizePeriod(opts.rows ?? rows, opts.end ?? '2026-09-28', opts.period ?? 7, opts.targets ?? T)
  return buildFindings({ summary: s, targets: opts.targets ?? T, goal: opts.goal ?? 'cut', weightKg: opts.weightKg === undefined ? 83 : opts.weightKg })
}

console.log('7 days on a cut')
const f = run()
check('rows in order', f.map(x => x.key), ['calories', 'protein', 'logging', 'weekend', 'fiber', 'best', 'hardest'])
check('calories: average / target', find(f, 'calories').value, '2,242 / 2,000 kcal')
check('calories over on a cut → warn, says how much and what to look at',
  [find(f, 'calories').tone, /^242 kcal a day over target; 2 of 6 days were 10%\+ over\. That slows the cut/.test(find(f, 'calories').sentence)], ['warn', true])
check('protein: average / target', find(f, 'protein').value, '138 / 150 g')
check('protein: hits and the shortfall in shakes (30, 40, 20 → 30 g ≈ one shake)',
  [find(f, 'protein').tone, find(f, 'protein').sentence], ['warn', 'Target reached on 3 of 6 days; the other days were 30 g short on average — about one protein shake.'])
check('logging: the gap is named by date', [find(f, 'logging').value, find(f, 'logging').sentence], ['6 of 7', 'Not logged: Mon 28.09.2026.'])
check('logging with one gap and 6 counted (≥ 5) → neutral', find(f, 'logging').tone, 'neutral')
check('weekend gap > 500 on a cut → warn with the weekly cost',
  [find(f, 'weekend').value, find(f, 'weekend').tone, /about 1,300 kcal extra a week; planning one weekend meal ahead/.test(find(f, 'weekend').sentence)], ['+650 kcal', 'warn', true])
check('fibre below 25 g → shown with what adds it (and why on a cut)', [find(f, 'fiber').value, find(f, 'fiber').tone, /keep you full on a cut/.test(find(f, 'fiber').sentence)], ['22 g a day', 'neutral', true])
check('fat at 60 g ≥ 0.6 × 83 → no fat row', find(f, 'fat'), undefined)
check('best day: the date and its numbers', [find(f, 'best').value, find(f, 'best').date, find(f, 'best').sentence],
  ['Wed 23.09.2026', '2026-09-23', '2,050 kcal (+50) · 155 g protein — closest to both targets.'])
check('hardest day, with both misses signed', [find(f, 'hardest').value, find(f, 'hardest').date, find(f, 'hardest').sentence],
  ['Sat 26.09.2026', '2026-09-26', '2,700 kcal (+700) · 110 g protein (−40) — furthest from them.'])
check('no jargon pills: no evidence tier on any row', f.some(x => 'tier' in x), false)

console.log('the switch changes every line')
{
  const f28 = run({ period: 28 })
  check('28 days: calories average includes the older day', find(f28, 'calories').value, '2,350 / 2,000 kcal')
  check('28 days: protein average changes', find(f28, 'protein').value, '126 / 150 g')
  check('28 days: logging counts 7 of 28 and says the averages are rough', [find(f28, 'logging').value, find(f28, 'logging').tone, /With 7 full days the averages are a rough guide; 20 make them reliable\./.test(find(f28, 'logging').sentence)], ['7 of 28', 'warn', true])
  check('28 days: many gaps are summed up, not listed', /Not logged: 21 days, the latest Mon 28\.09\.2026\./.test(find(f28, 'logging').sentence), true)
  const f14 = run({ period: 14 })
  check('14 days: 6 of 14', find(f14, 'logging').value, '6 of 14')
}

console.log('goals and edges')
{
  const onT = run({ rows: [row('2026-09-24', 2000, 150, 60, 30), row('2026-09-25', 2050, 160, 60, 30), row('2026-09-26', 1950, 155, 60, 30), row('2026-09-27', 2020, 150, 60, 30), row('2026-09-23', 1990, 151, 60, 30), row('2026-09-22', 2000, 150, 60, 30), row('2026-09-28', 2010, 150, 60, 30)] })
  check('on target → success and plain words', [find(onT, 'calories').tone, find(onT, 'calories').sentence], ['success', 'On target on average; 7 of 7 days within 10%. Keep it up.'])
  check('protein every day → success', [find(onT, 'protein').tone, find(onT, 'protein').sentence], ['success', 'Target reached on all 7 days — this protects your muscle.'])
  check('every day logged → success, "solid"', [find(onT, 'logging').tone, find(onT, 'logging').sentence], ['success', 'Every day logged — these averages are solid.'])
  check('fibre ≥ 25 → no fibre row', find(onT, 'fiber'), undefined)
  const gain = run({ goal: 'gain' })
  check('over target while gaining → neutral, "fine while gaining"', [find(gain, 'calories').tone, /fine while gaining/.test(find(gain, 'calories').sentence)], ['neutral', true])
  const under = run({ rows: rows.map(r => ({ ...r, calories: r.calories - 600 })) })
  check('under target on a cut → neutral (more deficit than planned)', [find(under, 'calories').tone, /under target.*More deficit than planned/.test(find(under, 'calories').sentence)], ['neutral', true])
  const underGain = run({ goal: 'gain', rows: rows.map(r => ({ ...r, calories: r.calories - 600 })) })
  check('under target while gaining → warn', find(underGain, 'calories').tone, 'warn')
  const lowFat = run({ rows: rows.map(r => ({ ...r, fat_g: 30 })) })
  check('fat under 0.6 g/kg → warn with the floor', [find(lowFat, 'fat').value, find(lowFat, 'fat').tone, /Under ~50 g/.test(find(lowFat, 'fat').sentence)], ['30 g a day', 'warn', true])
  const nearly = run({ rows: rows.map(r => ({ ...r, protein_g: 145 })) })
  check('a few grams short → "almost there", not a whole shake', /were 5 g short on average — almost there\.$/.test(find(nearly, 'protein').sentence), true)
  check('no weight → no fat row', find(run({ rows: rows.map(r => ({ ...r, fat_g: 30 })), weightKg: null }), 'fat'), undefined)
  const half = run({ rows: [...rows, row('2026-09-28', 700, 40)] })
  check('a half-logged day is named and left out', /Under 1,200 kcal, so probably not fully logged and left out of the averages: Mon 28\.09\.2026\./.test(find(half, 'logging').sentence), true)
  check('nothing logged → no findings', run({ rows: [] }).length, 0)
  const noTargets = run({ targets: { calories: 0, protein: 0 } })
  check('no targets → no calories/protein rows', [find(noTargets, 'calories'), find(noTargets, 'protein')], [undefined, undefined])
  const sameWeekend = run({ rows: [row('2026-09-22', 2000, 150), row('2026-09-23', 2000, 150), row('2026-09-26', 2100, 150)] })
  check('weekend within 200 kcal → success, "no weekend drift"', [find(sameWeekend, 'weekend').tone, /no weekend drift/.test(find(sameWeekend, 'weekend').sentence)], ['success', true])
}
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
