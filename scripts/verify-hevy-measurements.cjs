#!/usr/bin/env node
/*
 * Verification — Health → Body's "Logged in Hevy" card
 * (src/features/health/hevyMeasurements.ts) against the REAL module loaded
 * through sucrase (no unit-test runner by this repo's convention). Synthetic
 * rows shaped like hevy_body_measurements (weight/fat most days, tape
 * measurements now and then).
 *
 *   Run:  node scripts/verify-hevy-measurements.cjs
 */
require('sucrase/register')
const M = require('../src/features/health/hevyMeasurements')
const { ALL_FIELDS } = require('../src/features/training/bodyMeasurementFields')

let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`) }
}

const rows = [
  { date: '2026-08-20', weight_kg: 84.4, fat_percent: 24.1, waist_cm: 91 },
  { date: '2026-08-27', weight_kg: 83.1, fat_percent: 23.8, lean_mass_kg: 63.3 },
  { date: '2026-08-10', weight_kg: 85, chest_cm: 104 },
  { date: '2026-08-01', weight_kg: null, fat_percent: null },
  { date: '2026-08-24', weight_kg: 83.8, waist_cm: 90.2 },
]
const sorted = M.sortedEntries(rows, ALL_FIELDS)
check('newest first, whatever order the rows came in', sorted.map(r => r.date).join() === '2026-08-27,2026-08-24,2026-08-20,2026-08-10', sorted.map(r => r.date))
check('an entry with no values at all is left out', !sorted.some(r => r.date === '2026-08-01'))

const latest = M.entryLines(sorted, 0, ALL_FIELDS)
check('latest entry lists every recorded value in field order', latest.map(l => l.key).join() === 'weight_kg,fat_percent,lean_mass_kg', latest.map(l => l.key))
const w = latest.find(l => l.key === 'weight_kg')
check('weight change vs the previous entry (83.8 → 83.1 = −0.7, one decimal)', w.delta === -0.7 && w.prev.date === '2026-08-24', w)
const f = latest.find(l => l.key === 'fat_percent')
check('body fat compares with the last entry that HAD body fat (skips 24 Aug)', f.prev.date === '2026-08-20' && f.delta === -0.3, f)
check('a first-ever value has no change', latest.find(l => l.key === 'lean_mass_kg').prev === null && latest.find(l => l.key === 'lean_mass_kg').delta === null)
const second = M.entryLines(sorted, 1, ALL_FIELDS)
check('waist on 24 Aug compares with 20 Aug (−0.8 cm)', second.find(l => l.key === 'waist_cm').delta === -0.8)
check('the oldest entry has no changes', M.entryLines(sorted, 3, ALL_FIELDS).every(l => l.delta === null))
check('out of range index → []', M.entryLines(sorted, 9, ALL_FIELDS).length === 0)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
