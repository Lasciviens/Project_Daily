#!/usr/bin/env node
/*
 * Verification — resolveExerciseGif (exerciseMedia.tsx), the manual-override
 * lookup added 2026-09-01 after the user reported wrong GIF matches and
 * asked for a way to fix them.
 *
 * Proves, against the REAL un-mocked module (loaded via sucrase — no unit
 * test runner by this repo's convention):
 *   1. An override, when present for the exercise's own template id, always
 *      wins over the fuzzy matcher — no threshold, no fallback needed.
 *   2. No override -> falls through to the fuzzy matcher exactly as before.
 *   3. No override AND no fuzzy match -> null (never a guess).
 *   4. An override is keyed by templateId, not title — a different exercise
 *      with the same or a similar title never accidentally inherits it.
 *
 *   Run:  node scripts/verify-exercise-gif-overrides.cjs
 */
require('sucrase/register')

const { resolveExerciseGif } = require('../src/features/training/exerciseGifResolver')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

const db = [
  { name: 'Barbell Bench Press', tokens: new Set(['barbell', 'bench', 'press']), equipment: 'barbell', gifUrl: 'https://example.com/bench.gif', instructions: ['Lie down', 'Press up'] },
  { name: 'Barbell Squat', tokens: new Set(['barbell', 'squat']), equipment: 'barbell', gifUrl: 'https://example.com/squat.gif', instructions: [] },
]

console.log('\n== resolveExerciseGif ==')
{
  const overrides = new Map([['tpl-1', 'https://my-fix.example.com/correct.gif']])

  const withOverride = resolveExerciseGif('tpl-1', 'Bench Press (Barbell)', overrides, db)
  check('an override for this templateId wins, no fuzzy match attempted', withOverride && withOverride.gifUrl === 'https://my-fix.example.com/correct.gif' && withOverride.overridden === true)

  const noOverride = resolveExerciseGif('tpl-2', 'Bench Press (Barbell)', overrides, db)
  check('a different templateId with no override falls through to the fuzzy matcher', noOverride && noOverride.gifUrl === 'https://example.com/bench.gif' && noOverride.overridden === false)

  const noMatchAtAll = resolveExerciseGif('tpl-3', 'Some Totally Unrelated Movement Xyz', overrides, db)
  check('no override and no fuzzy match -> null, never a guess', noMatchAtAll === null)

  const noTemplateId = resolveExerciseGif(undefined, 'Bench Press (Barbell)', overrides, db)
  check('templateId omitted (older call sites) -> override lookup skipped cleanly, fuzzy match still runs', noTemplateId && noTemplateId.overridden === false)

  // Same exercise TITLE, but a different template id (e.g. a renamed/duplicate
  // Hevy entry) must never inherit an override meant for a different id.
  const sameTitleDifferentId = resolveExerciseGif('tpl-999', 'Bench Press (Barbell)', overrides, db)
  check('an override never leaks across template ids sharing a similar title', sameTitleDifferentId.overridden === false)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
