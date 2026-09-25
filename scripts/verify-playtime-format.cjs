#!/usr/bin/env node
/*
 * Verification — playtime formatting (src/features/games/api/playtimeFormat.ts).
 * No unit-test framework here; sucrase against the real module, the
 * scripts/verify-health-source-resolver.cjs convention.
 *
 * Run: node scripts/verify-playtime-format.cjs
 */
require('sucrase/register')
const { formatPlaytime } = require('../src/features/games/api/playtimeFormat.ts')

let passed = 0
const failures = []
const check = (label, actual, expected) => {
  if (actual === expected) passed++
  else failures.push(`${label}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`)
}

// The reported case: the Steam/PSN library total.
check('1542 hours  ', formatPlaytime(1542 * 60), '64d 6h')
// A real PSN duration ("PT228H56M33S" -> 13736 min).
check('228h56m     ', formatPlaytime(13736), '9d 12h 56m')

check('0           ', formatPlaytime(0), '0m')
check('1 min       ', formatPlaytime(1), '1m')
check('45 min      ', formatPlaytime(45), '45m')
check('59 min      ', formatPlaytime(59), '59m')
check('exactly 1h  ', formatPlaytime(60), '1h')
check('1h 15m      ', formatPlaytime(75), '1h 15m')
check('23h 59m     ', formatPlaytime(1439), '23h 59m')
// Day boundary: a zero unit is skipped, a real remainder is never dropped.
check('exactly 1d  ', formatPlaytime(1440), '1d')
check('1d 0h 1m    ', formatPlaytime(1441), '1d 1m')
check('1d 1h       ', formatPlaytime(1500), '1d 1h')
// A whole-day multiple must not print an empty hour unit.
check('exactly 2d  ', formatPlaytime(2880), '2d')

// Rounding, and never a negative or NaN leaking to the screen.
check('30 seconds  ', formatPlaytime(0.5), '1m')
check('20 seconds  ', formatPlaytime(0.33), '0m')
check('negative    ', formatPlaytime(-100), '0m')
check('NaN         ', formatPlaytime(NaN), '—')
check('Infinity    ', formatPlaytime(Infinity), '—')

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log('playtime formatting holds.\n')
