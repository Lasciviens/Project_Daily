#!/usr/bin/env node
/*
 * Verification — Health reference ranges and guidance
 * (src/features/health/benchmarks/). Proves every metric's band edges, the
 * age and sex boundaries, the missing-profile fallbacks, the VO2 max
 * explanation numbers, the insight builder and the profile input parsing
 * against the REAL un-mocked modules (loaded via sucrase — this repo has no
 * unit-test runner by convention). It also pins the fact-check corrections
 * (Mandsager ladder, Cole's adjusted RR, Windred's fully adjusted range, the
 * wrist-step direction, the Milanović repetition claim) so they can't regress.
 *
 *   Run:  node scripts/verify-health-benchmarks.cjs
 */
require('sucrase/register')

const B = require('../src/features/health/benchmarks/healthBenchmarks')
const G = require('../src/features/health/benchmarks/healthGuidance')
const T = require('../src/features/health/benchmarks/referenceTables')
const P = require('../src/features/health/benchmarks/profileInput')

let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`) }
}
const band = (m, v, ctx) => { const c = B.classify(m, v, ctx); return c && c.band }
const man = age => ({ age, sex: 'male', heightCm: 180 })
const woman = age => ({ age, sex: 'female', heightCm: 168 })
const nobody = { age: null, sex: null, heightCm: null }

console.log('\n§1 Profile → age / context')
check('ageOn: born 1984, on 2026-09-27 → 42', B.ageOn({ birthYear: 1984 }, '2026-09-27') === 42)
check('ageOn: accepts a full ISO timestamp', B.ageOn({ birthYear: 1984 }, '2026-01-01T10:00:00Z') === 42)
check('ageOn: no birth year → null', B.ageOn({ birthYear: null }, '2026-09-27') === null)
check('ageOn: birth year in the future → null', B.ageOn({ birthYear: 2030 }, '2026-09-27') === null)
check('ageOn: no profile → null', B.ageOn(null, '2026-09-27') === null)
const hp = B.toHealthProfile({ birth_year: 1984, sex: 'male', height_cm: '180.5' })
check('toHealthProfile: numeric string height parsed', hp.birthYear === 1984 && hp.sex === 'male' && hp.heightCm === 180.5, hp)
check('toHealthProfile: unknown sex → null', B.toHealthProfile({ sex: 'other' }).sex === null)
check('toHealthProfile: null row → all null', JSON.stringify(B.toHealthProfile(null)) === JSON.stringify({ birthYear: null, sex: null, heightCm: null }))
const cx = B.contextFor(hp, '2026-09-27')
check('contextFor: age, sex and height carried', cx.age === 42 && cx.sex === 'male' && cx.heightCm === 180.5, cx)

console.log('\n§2 Table helpers')
const vo2m40 = T.VO2_FRIEND_2015.male[2].data
check('percentile: the 50th-percentile value reads 50', T.percentileFromTable(vo2m40, 37.8) === 50)
check('percentile: the 25th-percentile value reads 25', T.percentileFromTable(vo2m40, 31.9) === 25)
check('percentile: far below the ladder clamps to 1', T.percentileFromTable(vo2m40, 5) === 1)
check('percentile: far above the ladder clamps to 99', T.percentileFromTable(vo2m40, 90) === 99)
check('percentile: a quartile-only ladder gives null outside its range', T.percentileFromTable(T.RHR_NHANES.female[0].data, 60) === null)
check('percentile: equal neighbouring values never divide by zero', T.percentileFromTable([[5, 10], [10, 10], [95, 20]], 10) === 5)
check('rowForAge: 19 → 20–29 marked clamped', (() => { const r = T.rowForAge(T.VO2_FRIEND_2015.male, 19); return r.row.min === 20 && r.clamped })())
check('rowForAge: 85 → 70–79 marked clamped', (() => { const r = T.rowForAge(T.VO2_FRIEND_2015.male, 85); return r.row.min === 70 && r.clamped })())
check('rowForAge: 45 → 40–49 not clamped', (() => { const r = T.rowForAge(T.VO2_FRIEND_2015.male, 45); return r.row.min === 40 && !r.clamped })())

console.log('\n§3 VO2 max (FRIEND 2015 + Kodama fallback)')
check('men 40–49: 24.1 < p10 → very_low', band('vo2_max', 24.1, man(42)) === 'very_low')
check('men 40–49: 26.8 = p10 → low', band('vo2_max', 26.8, man(42)) === 'low')
check('men 40–49: 31.8 just below p25 → low', band('vo2_max', 31.8, man(42)) === 'low')
check('men 40–49: 31.9 = p25 → below_average', band('vo2_max', 31.9, man(42)) === 'below_average')
check('men 40–49: 37.8 = p50 → above_average', band('vo2_max', 37.8, man(42)) === 'above_average')
check('men 40–49: 45.0 = p75 → high', band('vo2_max', 45.0, man(42)) === 'high')
check('men 40–49: 55.6 = p95 → very_high', band('vo2_max', 55.6, man(42)) === 'very_high')
check('age boundary: 45.0 at 29 → below_average (20–29)', band('vo2_max', 45.0, man(29)) === 'below_average')
check('age boundary: 45.0 at 30 → above_average (30–39)', band('vo2_max', 45.0, man(30)) === 'above_average')
const vLow = B.classify('vo2_max', 31.85, man(42))
check('displayed percentile stays inside its band (31.85 → ≤24)', vLow.band === 'low' && vLow.percentile <= 24, vLow.percentile)
check('low band tone is warn (not danger — watch error ±7)', vLow.tone === 'warn')
check('low band meaning uses the corrected Mandsager ladder (1.95 / 5.04)', /HR 1\.95/.test(vLow.meaning) && /5\.04/.test(vLow.meaning))
check('no band repeats the wrong 0.71 "vs low" HR', ['very_low', 'low', 'below_average', 'above_average', 'high', 'very_high']
  .every((_, i) => !/0\.71/.test(B.classify('vo2_max', [20, 30, 34, 40, 50, 60][i], man(42)).meaning)))
const vMid = B.classify('vo2_max', 34.1, man(42))
check('34.1 at 42 → below_average, ≈34th percentile', vMid.band === 'below_average' && vMid.percentile === 34, vMid)
check('34.1 next step → average 37.8, gap 3.7', vMid.nextStep.target === 37.8 && vMid.nextStep.gap === 3.7, vMid.nextStep)
check('below_average meaning quotes HR ≈0.51 vs bottom quarter', /0\.51/.test(vMid.meaning))
check('reference names the age band and FRIEND 2015', /Men 40–49/.test(vMid.referenceText) && /FRIEND 2015/.test(vMid.referenceText))
check('very_high has no next step', B.classify('vo2_max', 60, man(42)).nextStep === null)
check('women 30–39: 30.2 = p50 → above_average at the 50th', (() => { const c = B.classify('vo2_max', 30.2, woman(35)); return c.band === 'above_average' && c.percentile === 50 })())
check('age 85 uses the oldest band and says so', /nearest band/.test(B.classify('vo2_max', 25, man(85)).referenceText))
const vGen = B.classify('vo2_max', 34.1, nobody)
check('no profile → Kodama intermediate, no percentile', vGen.band === 'intermediate' && vGen.percentile === null && /Kodama/.test(vGen.referenceText))
check('no sex → generic', band('vo2_max', 34.1, { age: 42, sex: null }) === 'intermediate')
check('under 18 → generic', band('vo2_max', 34.1, man(17)) === 'intermediate')
const vGenLow = B.classify('vo2_max', 27.0, nobody)
check('generic low → next step 27.7 (7.9 METs)', vGenLow.band === 'low' && vGenLow.nextStep.target === 27.7, vGenLow.nextStep)
check('generic high (≥10.9 METs) → no next step', (() => { const c = B.classify('vo2_max', 40, nobody); return c.band === 'high' && c.nextStep === null })())

console.log('\n§4 Resting heart rate (Zhang bands + NHANES percentiles)')
check('58 → low (success)', (() => { const c = B.classify('resting_heart_rate', 58, man(42)); return c.band === 'low' && c.tone === 'success' })())
const r60 = B.classify('resting_heart_rate', 60, man(42))
check('60 → typical, next step under 60 (target 59, gap 1)', r60.band === 'typical' && r60.nextStep.target === 59 && r60.nextStep.gap === 1)
check('80 → typical', band('resting_heart_rate', 80, man(42)) === 'typical')
const r81 = B.classify('resting_heart_rate', 81, man(42))
check('81 → high (warn), next step 80', r81.band === 'high' && r81.tone === 'warn' && r81.nextStep.target === 80)
check('men 40–59: 68 → 50th percentile', B.classify('resting_heart_rate', 68, man(45)).percentile === 50)
check('men 40–59: 61 → 25th percentile', B.classify('resting_heart_rate', 61, man(45)).percentile === 25)
check('men 20–39 vs 40–59: 69 is the 50th at 39, above it at 40', B.classify('resting_heart_rate', 69, man(39)).percentile === 50 && B.classify('resting_heart_rate', 69, man(40)).percentile > 50)
check('women 20–39: 74 → 50th', B.classify('resting_heart_rate', 74, woman(30)).percentile === 50)
check('women: below the quartiles → null percentile, still banded', (() => { const c = B.classify('resting_heart_rate', 60, woman(30)); return c.percentile === null && c.band === 'typical' })())
check('no profile → no percentile, Zhang reference', (() => { const c = B.classify('resting_heart_rate', 65, nobody); return c.percentile === null && /Zhang 2016/.test(c.referenceText) })())
check('meaning quotes RR 1.09 per 10 bpm', /RR 1\.09/.test(r60.meaning))

console.log('\n§5 HRV (baseline first, population only as context)')
const base = { mean: 45, sd: 6 }
check('baseline: 38 < mean−SD → below_baseline (warn)', (() => { const c = B.classify('heart_rate_variability', 38, { ...man(42), baseline: base }); return c.band === 'below_baseline' && c.tone === 'warn' })())
check('baseline: 52 > mean+SD → above_baseline', band('heart_rate_variability', 52, { ...man(42), baseline: base }) === 'above_baseline')
check('baseline: 45 → within_baseline (success)', band('heart_rate_variability', 45, { ...man(42), baseline: base }) === 'within_baseline')
check('population, men 35–44: 20 → low_for_age (neutral)', (() => { const c = B.classify('heart_rate_variability', 20, man(40)); return c.band === 'low_for_age' && c.tone === 'neutral' && c.percentile === null })())
check('population: 70 → high_for_age', band('heart_rate_variability', 70, man(40)) === 'high_for_age')
check('population: 44 → typical_for_age', band('heart_rate_variability', 44, man(40)) === 'typical_for_age')
check('population reference flags the different method', /different method/.test(B.classify('heart_rate_variability', 44, man(40)).referenceText))
check('no sex: averages men and women (45.0 ms at 40)', /45\.0 ±/.test(B.classify('heart_rate_variability', 44, { age: 40, sex: null }).referenceText))
check('no baseline and no age → null', B.classify('heart_rate_variability', 44, nobody) === null)
check('baseline with SD 0 falls back to population', band('heart_rate_variability', 44, { ...man(40), baseline: { mean: 45, sd: 0 } }) === 'typical_for_age')

console.log('\n§6 Steps (Paluch 2022 age-specific plateau)')
check('3,999 → very_low (danger)', (() => { const c = B.classify('step_count', 3999, man(42)); return c.band === 'very_low' && c.tone === 'danger' })())
check('4,000 → low', band('step_count', 4000, man(42)) === 'low')
check('5,999 → low', band('step_count', 5999, man(42)) === 'low')
check('6,000 → moderate (under 60)', band('step_count', 6000, man(42)) === 'moderate')
const s7999 = B.classify('step_count', 7999, man(42))
check('7,999 → moderate, next step 8,000 (gap 1)', s7999.band === 'moderate' && s7999.nextStep.target === 8000 && s7999.nextStep.gap === 1)
check('8,000 → plateau', band('step_count', 8000, man(42)) === 'plateau')
check('9,999 → plateau', band('step_count', 9999, man(42)) === 'plateau')
check('10,000 → above_plateau', band('step_count', 10000, man(42)) === 'above_plateau')
check('age boundary: 7,000 at 59 → moderate', band('step_count', 7000, man(59)) === 'moderate')
check('age boundary: 7,000 at 60 → plateau (6,000–8,000)', band('step_count', 7000, man(60)) === 'plateau')
check('65: 8,000 → above_plateau', band('step_count', 8000, man(65)) === 'above_plateau')
check('no age: under-60 thresholds, asks for birth year', (() => { const c = B.classify('step_count', 7000, nobody); return c.band === 'moderate' && /birth year/.test(c.referenceText) })())

console.log('\n§7 Sleep duration and regularity')
const sl59 = B.classify('sleep_duration', 5.9, man(42))
check('5.9 h → short (warn), next step 7 (gap 1.1), cites Craven', sl59.band === 'short' && sl59.tone === 'warn' && sl59.nextStep.gap === 1.1 && sl59.sources.some(s => /Craven/.test(s.citation)))
check('6.0 h → just_under (neutral)', (() => { const c = B.classify('sleep_duration', 6.0, man(42)); return c.band === 'just_under' && c.tone === 'neutral' })())
check('7.0 h → recommended', band('sleep_duration', 7.0, man(42)) === 'recommended')
check('9.0 h → recommended (18–64)', band('sleep_duration', 9.0, man(42)) === 'recommended')
check('9.1 h → long', band('sleep_duration', 9.1, man(42)) === 'long')
check('65+: 8.5 h → long (7–8 h range)', band('sleep_duration', 8.5, man(70)) === 'long')
check('65+: 8.0 h → recommended', band('sleep_duration', 8.0, man(70)) === 'recommended')
check('Windred quoted with the fully adjusted 20–30%, not 20–48%', /20–30%/.test(sl59.meaning) && !/48%/.test(sl59.meaning))
check('regularity: ±30 min → regular', band('sleep_regularity', 30, nobody) === 'regular')
check('regularity: ±31 min → variable', band('sleep_regularity', 31, nobody) === 'variable')
check('regularity: ±60 min → variable', band('sleep_regularity', 60, nobody) === 'variable')
check('regularity: ±61 min → irregular (warn)', (() => { const c = B.classify('sleep_regularity', 61, nobody); return c.band === 'irregular' && c.tone === 'warn' })())

console.log('\n§8 Body fat (Gallagher 2000)')
check('men 20–39: 7.9 → under', band('body_fat_percentage', 7.9, man(30)) === 'under')
check('men 20–39: 8 → healthy', band('body_fat_percentage', 8, man(30)) === 'healthy')
check('men 20–39: 19.9 → healthy', band('body_fat_percentage', 19.9, man(30)) === 'healthy')
check('men 20–39: 20 → overfat', band('body_fat_percentage', 20, man(30)) === 'overfat')
check('men 20–39: 25 → overfat', band('body_fat_percentage', 25, man(30)) === 'overfat')
check('men 20–39: 25.1 → obese (danger)', (() => { const c = B.classify('body_fat_percentage', 25.1, man(30)); return c.band === 'obese' && c.tone === 'danger' })())
check('age boundary: 21% at 39 → overfat, at 40 → healthy', band('body_fat_percentage', 21, man(39)) === 'overfat' && band('body_fat_percentage', 21, man(40)) === 'healthy')
const bf22 = B.classify('body_fat_percentage', 22, man(45))
check('men 40–59: 22 → overfat, next step 21.9 (gap 0.1)', bf22.band === 'overfat' && bf22.nextStep.target === 21.9 && bf22.nextStep.gap === 0.1, bf22.nextStep)
check('men 60–79: 24.9 healthy, 30.1 obese', band('body_fat_percentage', 24.9, man(65)) === 'healthy' && band('body_fat_percentage', 30.1, man(65)) === 'obese')
check('women 20–39: 20.9 under, 33.9 healthy, 34 overfat, 39.1 obese',
  band('body_fat_percentage', 20.9, woman(30)) === 'under' && band('body_fat_percentage', 33.9, woman(30)) === 'healthy'
  && band('body_fat_percentage', 34, woman(30)) === 'overfat' && band('body_fat_percentage', 39.1, woman(30)) === 'obese')
check('no sex → null', B.classify('body_fat_percentage', 20, nobody) === null)
check('no age → 20–39 range, labelled', /birth year not set/.test(B.classify('body_fat_percentage', 18, { age: null, sex: 'male' }).referenceText))
check('men get the ACE context line', /ACE/.test(bf22.referenceText))

console.log('\n§9 BMI and waist-to-height')
check('computeBmi(80, 180) = 24.7', B.computeBmi(80, 180) === 24.7)
check('computeBmi with missing height → null', B.computeBmi(80, null) === null)
check('BMI edges 18.4/18.5/20/24.99/25/27.5/30/35/40',
  [[18.4, 'underweight'], [18.5, 'low_normal'], [20, 'healthy'], [24.99, 'healthy'], [25, 'overweight_low'], [27.5, 'overweight_high'], [30, 'obesity_1'], [35, 'obesity_2'], [40, 'obesity_3']]
    .every(([v, b]) => band('bmi', v, man(42)) === b))
const bmi26 = B.classify('bmi', 26.8, man(42))
check('BMI next step names a weight at the height (≈81 kg)', /81 kg/.test(bmi26.nextStep.label) && bmi26.nextStep.target === 24.9, bmi26.nextStep)
check('BMI meaning always carries the muscle caveat', /muscle/.test(bmi26.meaning))
check('computeWaistToHeight(90, 180) = 0.5', B.computeWaistToHeight(90, 180) === 0.5)
check('WHtR edges 0.39/0.40/0.49/0.50/0.59/0.60',
  [[0.39, 'below_range'], [0.4, 'healthy'], [0.49, 'healthy'], [0.5, 'increased'], [0.59, 'increased'], [0.6, 'high']]
    .every(([v, b]) => band('waist_to_height', v, man(42)) === b))
const wh = B.classify('waist_to_height', 0.52, man(42))
check('WHtR next step names a waist in cm and men get the WHO line', /90 cm/.test(wh.nextStep.label) && /94 cm/.test(wh.referenceText))

console.log('\n§10 Activity (WHO 2020 / Arem 2015 / Momma 2022)')
check('moderateEquivalentMinutes(60, 15) = 90', B.moderateEquivalentMinutes(60, 15) === 90)
check('moderateEquivalentMinutes(null, null) = 0; negatives clamp', B.moderateEquivalentMinutes(null, null) === 0 && B.moderateEquivalentMinutes(-5, 10) === 20)
check('weekly minutes 0/149/150/299/300/749/750',
  [[0, 'inactive'], [149, 'below_guideline'], [150, 'meets_guideline'], [299, 'meets_guideline'], [300, 'above_guideline'], [749, 'above_guideline'], [750, 'well_above']]
    .every(([v, b]) => band('weekly_exercise_minutes', v, nobody) === b))
check('299 min → next step 300', B.classify('weekly_exercise_minutes', 299, nobody).nextStep.target === 300)
check('strength days 0/1/2', band('strength_days', 0, nobody) === 'none' && band('strength_days', 1, nobody) === 'once' && band('strength_days', 2, nobody) === 'meets_guideline')
check('strength minutes 0/29/30/60/61',
  [[0, 'none'], [29, 'some'], [30, 'sweet_spot'], [60, 'sweet_spot'], [61, 'beyond']].every(([v, b]) => band('strength_minutes', v, nobody) === b))
check('beyond 60 min is info, never a risk tone', (() => { const c = B.classify('strength_minutes', 240, nobody); return c.tone === 'info' && /not a health risk/.test(c.meaning) })())

console.log('\n§11 Cardio recovery, walking speed, respiratory rate, blood oxygen')
const hrr = B.classify('heart_rate_recovery', 12, nobody)
check('HRR 12 → low (warn), next step 13', hrr.band === 'low' && hrr.tone === 'warn' && hrr.nextStep.target === 13)
check('HRR 13 → normal', band('heart_rate_recovery', 13, nobody) === 'normal')
check('Cole quoted as adjusted RR 2.0, not the univariate 4.0', /RR 2\.0/.test(hrr.meaning) && !/4\.0/.test(hrr.meaning))
check('walk 65+: 2.1 km/h → slow', band('walking_speed', 2.1, man(70)) === 'slow')
check('walk 65+: 2.2 km/h → below_median', band('walking_speed', 2.2, man(70)) === 'below_median')
check('walk 65+: 3.0 km/h → median', band('walking_speed', 3.0, man(70)) === 'median')
check('walk 65+: 3.7 km/h → better_than_expected', band('walking_speed', 3.7, man(70)) === 'better_than_expected')
check('walk 65+: 4.4 km/h → exceptional', band('walking_speed', 4.4, man(70)) === 'exceptional')
check('age boundary: 3.0 km/h at 64 → slower, at 65 → median', band('walking_speed', 3.0, man(64)) === 'slower' && band('walking_speed', 3.0, man(65)) === 'median')
check('men 40–49: 5.2 km/h ≥ 1.43 m/s → typical_or_faster', band('walking_speed', 5.2, man(45)) === 'typical_or_faster')
const walk4 = B.classify('walking_speed', 4.0, man(45))
check('men 40–49: 4.0 km/h → normal, next step 5.1 km/h', walk4.band === 'normal' && walk4.nextStep.target === 5.1, walk4.nextStep)
check('women under 65: 4.0 km/h → normal, no next step (no source row)', (() => { const c = B.classify('walking_speed', 4.0, woman(30)); return c.band === 'normal' && c.nextStep === null })())
check('respiratory 11.7/11.8/19.2/19.3',
  [[11.7, 'below_typical'], [11.8, 'typical'], [19.2, 'typical'], [19.3, 'above_typical']].every(([v, b]) => band('respiratory_rate', v, nobody) === b))
check('respiratory: +3 over baseline → above_baseline', band('respiratory_rate', 17, { ...nobody, baseline: { mean: 14 } }) === 'above_baseline')
check('respiratory: +2.9 over baseline → typical', band('respiratory_rate', 16.9, { ...nobody, baseline: { mean: 14 } }) === 'typical')
check('SpO2 97% → normal; 0.97 fraction → normal', band('blood_oxygen', 97, nobody) === 'normal' && band('blood_oxygen', 0.97, nobody) === 'normal')
check('SpO2 94 → slightly_low (neutral), 89 → low (warn)', (() => {
  const a = B.classify('blood_oxygen', 94, nobody), b = B.classify('blood_oxygen', 89, nobody)
  return a.band === 'slightly_low' && a.tone === 'neutral' && b.band === 'low' && b.tone === 'warn'
})())
check('SpO2 0 or 120 → null', B.classify('blood_oxygen', 0, nobody) === null && B.classify('blood_oxygen', 120, nobody) === null)
check('classify: NaN and negatives → null', B.classify('step_count', NaN, nobody) === null && B.classify('step_count', -1, nobody) === null)

console.log('\n§12 Invariants across every metric')
const metrics = Object.keys(B.BENCHMARKS)
const tones = new Set(['danger', 'warn', 'neutral', 'success', 'info'])
const samples = [0.5, 1, 5, 12, 15, 20, 30, 40, 60, 90, 150, 400, 900, 5000, 12000]
let invariantOk = true, invariantDetail = null
for (const m of metrics) for (const v of samples) for (const ctx of [man(42), woman(55), man(72), nobody, { ...man(30), baseline: { mean: 40, sd: 8 } }]) {
  const c = B.classify(m, v, ctx)
  if (!c) continue
  const bad =
    !c.label || !c.band || !tones.has(c.tone) || !c.referenceText || !c.meaning || c.sources.length === 0 ||
    c.sources.some(s => !/^https:\/\//.test(s.url)) || (c.percentile != null && (c.percentile < 1 || c.percentile > 99)) ||
    (c.nextStep && (c.nextStep.gap < 0 || !c.nextStep.label)) || /undefined|NaN/.test(JSON.stringify(c))
  if (bad) { invariantOk = false; invariantDetail = { m, v, ctx, c }; break }
}
check('every classification: label, tone, reference, meaning, https sources, percentile 1–99, gap ≥ 0, no undefined/NaN', invariantOk, invariantDetail)
check('BENCHMARKS covers all 16 metrics with complete copy', metrics.length === 16 && metrics.every(m => {
  const b = B.BENCHMARKS[m]
  return b.title && b.unit && b.whatItMeans && b.howToImprove && b.caveats && b.sources.length > 0
})
)
check('HEALTH_METRIC_BENCHMARK maps Apple names (cardio_recovery → heart_rate_recovery)', B.HEALTH_METRIC_BENCHMARK.cardio_recovery === 'heart_rate_recovery'
  && Object.values(B.HEALTH_METRIC_BENCHMARK).every(m => metrics.includes(m)))
check('steps caveat: wrist counts run HIGH vs hip (fact-check direction)', /more steps than hip/.test(B.BENCHMARKS.step_count.caveats) && !/undercount/i.test(B.BENCHMARKS.step_count.caveats))
check('VO2 copy drops the contradicted "shorter repetitions" claim', !/shorter/i.test(B.BENCHMARKS.vo2_max.howToImprove))

console.log('\n§13 Heart-rate and energy helpers')
check('estimatedMaxHr(42) = 179 (208 − 0.7 × age)', B.estimatedMaxHr(42) === 179)
check('estimatedMaxHr(null / 17) = null', B.estimatedMaxHr(null) === null && B.estimatedMaxHr(17) === null)
const z = B.heartRateZones(42)
check('zones at 42: moderate 115–136, vigorous 138–170, intervals 161–170',
  z.moderate.join() === '115,136' && z.vigorous.join() === '138,170' && z.intervals.join() === '161,170', z)
check('Mifflin: 80 kg / 180 cm / 35 y man = 1,755 kcal', B.expectedRestingEnergyKcal({ weightKg: 80, heightCm: 180, age: 35, sex: 'male' }) === 1755)
check('Mifflin: same numbers, woman = 1,589 kcal', B.expectedRestingEnergyKcal({ weightKg: 80, heightCm: 180, age: 35, sex: 'female' }) === 1589)
check('Mifflin: missing sex → null', B.expectedRestingEnergyKcal({ weightKg: 80, heightCm: 180, age: 35, sex: null }) === null)
check('mlKgMinToMets(35) = 10', B.mlKgMinToMets(35) === 10)

console.log('\n§14 vo2Explain (hero tile)')
const e = B.vo2Explain(34.1, { ...man(42), weightKg: 88, targetWeightKg: 82 })
check('34.1 at 42: 34th percentile, average 37.8, good 45', e.percentile === 34 && e.average === 37.8 && e.good === 45 && e.ageGroup === 'Men 40–49', e)
check('gap to average 3.7 ml/kg/min = 1.1 METs, ≈14% (0.87^1.1)', e.gapToAverage.mlKgMin === 3.7 && e.gapToAverage.mets === 1.1 && /14%/.test(e.gapToAverage.riskText))
check('gap to good 10.9 = 3.1 METs, ≈35%', e.gapToGood.mlKgMin === 10.9 && e.gapToGood.mets === 3.1 && /35%/.test(e.gapToGood.riskText))
check('risk text frames it as an association', /association, not a promise/.test(e.gapToAverage.riskText))
check('watch band ±7 → 27.1–41.1', e.watchBand.low === 27.1 && e.watchBand.high === 41.1)
check('watch caveat: −4.5 to −6.3 across studies, no correction for low fitness', /4\.5–6\.3/.test(e.watchCaveat) && /no correction/.test(e.watchCaveat) && /−2\.4/.test(e.watchCaveat))
check('expected gain +3 to +6, quoting Milanović 4.9 / 5.5', e.expectedGain.low === 3 && e.expectedGain.high === 6 && /4\.9/.test(e.expectedGain.text) && /5\.5/.test(e.expectedGain.text))
check('HUNT3 men 40–49: 47.2 ± 7.7 → 4th percentile', e.norwegianAverage.mean === 47.2 && e.norwegianAverage.sd === 7.7 && e.norwegianAverage.percentile === 4, e.norwegianAverage)
check('small gap → one 8–12-week block', /8–12-week block/.test(e.timeFrame))
check('plan carries the 4×4 protocol and interval heart rates (161–170)', /4 × 4/.test(e.plan) && /161–170/.test(e.plan))
check('same absolute VO2 at 82 kg → 36.6', e.atTargetWeight === 36.6)
check('at/above average: no gap, maintenance time frame', (() => { const x = B.vo2Explain(40, man(42)); return x.gapToAverage === null && /at or above the average/.test(x.timeFrame) })())
check('large gap (25 y, 30.0 → 48.0): 4 blocks', /4 blocks/.test(B.vo2Explain(30, man(25)).timeFrame))
const eg = B.vo2Explain(34.1, nobody)
check('no profile: generic class, no averages, Kodama next-step time frame', eg.average === null && eg.ageGroup === null && eg.norwegianAverage === null && /8–12-week block/.test(eg.timeFrame))
check('no profile, high fitness → maintenance time frame', /high-fitness line/.test(B.vo2Explain(45, nobody).timeFrame))
check('women: no HUNT3 context', B.vo2Explain(30, woman(35)).norwegianAverage === null)
check('men 60–69: HUNT3 mean without SD → no percentile', (() => { const n = B.vo2Explain(30, man(65)).norwegianAverage; return n.mean === 39 && n.sd === null && n.percentile === null })())
check('invalid value → null', B.vo2Explain(NaN, man(42)) === null)

console.log('\n§15 Insights')
const full = {
  age: 42, sex: 'male', heightCm: 180, vo2max: 34.1, restingHr: 63, restingHrBaseline: 60, hrvSdnn: 38, hrvBaseline: { mean: 45, sd: 6 },
  avgSteps7: 6200, avgSleepH7: 6.4, sleepRegularity: 45, bodyFatPct: 23.5, weightKg: 88, waistCm: 90,
  weeklyModerateMin: 60, weeklyVigorousMin: 15, strengthDaysPerWeek: 3, strengthMinPerWeek: 180, cardioSessionsPerWeek: 1,
}
const ins = G.buildHealthInsights(full)
const ids = ins.map(i => i.id)
const expected = ['vo2-standing', 'vo2-modifiable', 'strength-health', 'lifting-plus-cardio', 'cardio-no-interference', 'cardio-intensity',
  'heart-rate-zones', 'steps', 'sleep-duration', 'sleep-regularity', 'resting-hr', 'hrv', 'waist-to-height', 'body-fat', 'bmi']
check('full input produces every insight family', expected.every(id => ids.includes(id)), ids)
check('sorted: attention → own readings → tips → reassurance', ins.every((x, i) => i === 0 || G.INSIGHT_TONE_ORDER[ins[i - 1].tone] <= G.INSIGHT_TONE_ORDER[x.tone]))
check('deterministic (same input → same output)', JSON.stringify(ins) === JSON.stringify(G.buildHealthInsights(full)))
check('every insight has text, why and sources; no undefined/NaN', ins.every(i => i.title && i.text && i.why && i.sources.length > 0) && !/undefined|NaN/.test(JSON.stringify(ins)))
check('strength insight quotes Momma 10–17% and the 30–60 min peak', /10–17%/.test(ins.find(i => i.id === 'strength-health').text) && /30–60/.test(ins.find(i => i.id === 'strength-health').text))
check('lifting + cardio: Saeidifard 21% vs 40%, action adds 60 min', (() => { const i = ins.find(x => x.id === 'lifting-plus-cardio'); return /21%/.test(i.text) && /40%/.test(i.text) && /60 min/.test(i.action) })())
check('cardio intensity quotes Milanović and the Zone 2 review', /5\.5/.test(ins.find(i => i.id === 'cardio-intensity').text) && /Zone 2/.test(ins.find(i => i.id === 'cardio-intensity').text))
check('sleep 6.4 h → "Just under" wording (not the ≤6 h claim as a label)', /^Just under/.test(ins.find(i => i.id === 'sleep-duration').text))
check('sleep 5.5 h → "Short sleep" wording', /^Short sleep/.test(G.buildHealthInsights({ ...full, avgSleepH7: 5.5 }).find(i => i.id === 'sleep-duration').text))
check('sleep 7.5 h → success, no action', (() => { const i = G.buildHealthInsights({ ...full, avgSleepH7: 7.5 }).find(x => x.id === 'sleep-duration'); return i.tone === 'success' && i.action === null })())
const rise = G.buildHealthInsights({ ...full, restingHr: 66, restingHrBaseline: 60 })
check('resting HR +6 on baseline → resting-hr-rise (warn) instead of resting-hr', rise.some(i => i.id === 'resting-hr-rise' && i.tone === 'warn') && !rise.some(i => i.id === 'resting-hr'))
check('no strength days → strength-health warns', G.buildHealthInsights({ ...full, strengthDaysPerWeek: 0 }).find(i => i.id === 'strength-health').tone === 'warn')
check('aerobic ≥ 150 with lifting → combined success, no action', (() => { const i = G.buildHealthInsights({ ...full, weeklyModerateMin: 120, weeklyVigorousMin: 20 }).find(x => x.id === 'lifting-plus-cardio'); return i.tone === 'success' && i.action === null })())
check('aerobic known, strength unknown → weekly-activity instead', (() => { const x = G.buildHealthInsights({ ...full, strengthDaysPerWeek: null }); return x.some(i => i.id === 'weekly-activity') && !x.some(i => i.id === 'lifting-plus-cardio') })())
check('no VO2 reading → modifiable card asks for an outdoor walk/run', /outdoor/.test(G.buildHealthInsights({ ...full, vo2max: null }).find(i => i.id === 'vo2-modifiable').action))
check('high VO2 (50 at 42) → no modifiable or intensity nudges', (() => { const x = G.buildHealthInsights({ ...full, vo2max: 50 }); return !x.some(i => i.id === 'vo2-modifiable' || i.id === 'cardio-intensity') })())
check('BMI ≥ 25 with a healthy waist → "your waist says healthy" (neutral)', (() => { const i = G.buildHealthInsights({ ...full, waistCm: 85, weightKg: 88 }).find(x => x.id === 'bmi'); return i.tone === 'neutral' && /waist says healthy/.test(i.title) })())
check('empty input → only the general fitness card', JSON.stringify(G.buildHealthInsights({ age: null, sex: null, heightCm: null }).map(i => i.id)) === '["vo2-modifiable"]')
check('no age → no heart-rate zones', !G.buildHealthInsights({ ...full, age: null }).some(i => i.id === 'heart-rate-zones'))
check('disclaimer says it is not medical advice', /not medical advice/.test(G.HEALTH_DISCLAIMER))

console.log('\n§16 Profile inputs')
check('parseBirthYear 1984 → 1984', JSON.stringify(P.parseBirthYear('1984', 2026)) === JSON.stringify({ ok: true, value: 1984 }))
check('parseBirthYear "" → clears (null)', P.parseBirthYear('  ', 2026).ok && P.parseBirthYear('', 2026).value === null)
check('parseBirthYear rejects 1899, 2027, "84", "19a4"', ['1899', '2027', '84', '19a4'].every(t => !P.parseBirthYear(t, 2026).ok))
check('parseHeightCm "180" → 180; "180,5" → 180.5; "180.54" → 180.5',
  P.parseHeightCm('180').value === 180 && P.parseHeightCm('180,5').value === 180.5 && P.parseHeightCm('180.54').value === 180.5)
check('parseHeightCm "1.82" → asks for centimetres', !P.parseHeightCm('1.82').ok && /centimetres/.test(P.parseHeightCm('1.82').error))
check('parseHeightCm rejects 99 and 251, clears on ""', !P.parseHeightCm('99').ok && !P.parseHeightCm('251').ok && P.parseHeightCm('').value === null)

// §17 needs the real athleteProfileApi, which imports the live Supabase
// client. Resolve that import (and requireUser) to in-memory fakes so the
// migration-110 retry logic runs exactly as shipped, with scripted responses.
async function verifyProfileApi() {
  console.log('\n§17 athleteProfileApi — migration 110 fallback')
  const Module = require('module')
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

  const HEALTH = ['birth_year', 'sex', 'height_cm']
  const pre110 = st => {
    if (st.op === 'upsert' && HEALTH.some(k => k in st.row)) {
      return { data: null, error: { code: 'PGRST204', message: "Could not find the 'birth_year' column of 'athlete_profile' in the schema cache" } }
    }
    return { data: { user_id: 'u', goal: st.row?.goal ?? 'strength', notes: null, updated_at: 'now' }, error: null }
  }
  const post110 = st => ({ data: { user_id: 'u', goal: null, updated_at: 'now', ...(st.row ?? {}), height_cm: st.row?.height_cm != null ? String(st.row.height_cm) : null }, error: null })
  const rejects = async (fn, re) => { try { await fn(); return false } catch (e) { return re.test(e.message) } }

  handler = pre110; calls = []
  const pre = await api.fetchAthleteProfile()
  check('pre-110 read: missing columns come back as explicit nulls', pre.birth_year === null && pre.sex === null && pre.height_cm === null && pre.goal === 'strength', pre)

  handler = () => ({ data: { user_id: 'u', sex: 'male', height_cm: '180.5', birth_year: 1984, updated_at: 'now' }, error: null })
  const post = await api.fetchAthleteProfile()
  check('read: numeric(5,1) string height becomes a number', post.height_cm === 180.5 && post.sex === 'male' && post.birth_year === 1984, post)

  handler = pre110; calls = []
  await api.upsertAthleteProfile({ goal: 'hypertrophy' })
  check('pre-110 write without health fields: one call, no retry', calls.length === 1)

  calls = []
  check('pre-110 write of a birth year: named migration-110 error', await rejects(() => api.upsertAthleteProfile({ birth_year: 1984 }), /migration 110/))
  check('…and no empty second write', calls.length === 1, calls.length)

  calls = []
  check('pre-110 mixed write: other fields saved, then migration-110 error', await rejects(() => api.upsertAthleteProfile({ goal: 'strength', height_cm: 180 }), /migration 110/))
  check('…the retry carries the goal but not the height', calls.length === 2 && calls[1].row.goal === 'strength' && !('height_cm' in calls[1].row), calls)

  calls = []
  const cleared = await api.upsertAthleteProfile({ sex: null })
  check('pre-110 clearing a field is a quiet no-op (no error)', cleared.user_id === 'u' && calls.length === 2)

  handler = post110; calls = []
  const saved = await api.upsertAthleteProfile({ birth_year: 1984, height_cm: 180 })
  check('post-110 write: one call, normalized result', calls.length === 1 && saved.birth_year === 1984 && saved.height_cm === 180, saved)

  handler = () => ({ data: null, error: { code: '42501', message: 'permission denied' } })
  check('other errors pass through unchanged', await rejects(() => api.upsertAthleteProfile({ birth_year: 1984 }), /permission denied/))
  handler = () => ({ data: null, error: { code: '42P01', message: 'relation does not exist' } })
  check('missing table still reports migration 070', await rejects(() => api.upsertAthleteProfile({ goal: 'strength' }), /migration 070/))
}

verifyProfileApi().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}, err => {
  console.error(err)
  process.exit(1)
})
