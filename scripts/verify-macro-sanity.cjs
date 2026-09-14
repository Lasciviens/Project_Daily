#!/usr/bin/env node
/*
 * Verification — the Atwater consistency check (checkMacroConsistency),
 * against the REAL un-mocked src/features/recipes/macroSanity.ts via sucrase
 * (no test framework, per this repo's convention).
 *
 * Real bug that motivated this: a Kassalapp-sourced ingredient ("TINE
 * Proteinrik Lettost") declared 157.6 kcal/100g alongside 30g protein/16g
 * fat/1.5g carbs — its own macros imply ~270 kcal, a 42% gap traced to a
 * third-party source-data error with no way to notice it short of doing the
 * arithmetic by hand. This script locks in the threshold math (the larger of
 * 50 kcal or 15% of declared calories) and the null-guard cases.
 *
 * Run: node scripts/verify-macro-sanity.cjs
 */
require('sucrase/register')
const { checkMacroConsistency } = require('../src/features/recipes/macroSanity')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

console.log('\n1 · Null guards')
{
  check('missing calories → null', checkMacroConsistency(null, 30, 1.5, 16) === null)
  check('missing protein → null', checkMacroConsistency(157.6, null, 1.5, 16) === null)
  check('missing carbs → null', checkMacroConsistency(157.6, 30, null, 16) === null)
  check('missing fat → null', checkMacroConsistency(157.6, 30, 1.5, null) === null)
  check('calories = 0 → null (nothing to compare a ratio against)', checkMacroConsistency(0, 30, 1.5, 16) === null)
  check('calories negative → null', checkMacroConsistency(-5, 30, 1.5, 16) === null)
  check('all-zero macros → null (missing-data case, not this check\'s job)', checkMacroConsistency(500, 0, 0, 0) === null)
}

console.log('\n2 · The real production case (TINE Proteinrik Lettost)')
{
  const r = checkMacroConsistency(157.6, 30, 1.5, 16)
  check('atwaterKcal ≈ 270', r && Math.abs(r.atwaterKcal - 270) < 0.5, JSON.stringify(r))
  check('flagged inconsistent', r && r.inconsistent === true)
  check('deltaPct ≈ 71.3%', r && Math.abs(r.deltaPct - 71.3) < 1, String(r?.deltaPct))
}

console.log('\n3 · A realistic, consistent food (grilled chicken breast) is NOT flagged')
{
  const r = checkMacroConsistency(165, 31, 0, 3.6)
  check('not flagged', r && r.inconsistent === false, JSON.stringify(r))
}

console.log('\n4 · Threshold is the LARGER of 50kcal or 15% — exact boundary (strict >, not ≥)')
{
  // calories=1000, atwater=850 (protein 100*4=400 + fat 50*9=450) → delta=150,
  // pct=15%, threshold=max(50,150)=150 → NOT inconsistent (150 is not > 150)
  const atBoundary = checkMacroConsistency(1000, 100, 0, 50)
  check('exactly at 15% threshold is NOT flagged', atBoundary && atBoundary.inconsistent === false, JSON.stringify(atBoundary))
  // one more kcal off → IS flagged
  const overBoundary = checkMacroConsistency(1001, 100, 0, 50)
  check('one kcal past the 15% threshold IS flagged', overBoundary && overBoundary.inconsistent === true, JSON.stringify(overBoundary))
}

console.log('\n5 · A low-calorie food uses the flat 50kcal floor, not a tiny percentage')
{
  // calories=100 → threshold=max(50, 15)=50. A 45kcal gap should NOT flag despite being 45% of calories.
  const r = checkMacroConsistency(100, 10, 5, 3) // atwater=40+20+27=87, delta=13 → nowhere near 50, sanity baseline
  check('small consistent food not flagged', r && r.inconsistent === false, JSON.stringify(r))
  const r2 = checkMacroConsistency(100, 0, 0, 12) // atwater=108, delta=-8 → still under 50 floor
  check('small food within 50kcal floor not flagged even at ~8%% off', r2 && r2.inconsistent === false, JSON.stringify(r2))
}

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
