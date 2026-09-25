#!/usr/bin/env node
/*
 * Verification — npsso lifetime arithmetic (src/features/games/api/psnTokenLifetime.ts).
 *
 * No unit-test framework in this repo; this is the sucrase-against-the-real-
 * module convention (scripts/verify-health-source-resolver.cjs et al.).
 *
 * Run: node scripts/verify-psn-token-lifetime.cjs
 */
require('sucrase/register')
const {
  npssoLifetime, npssoLifetimeLabel, NPSSO_RENEW_WINDOW_DAYS,
} = require('../src/features/games/api/psnTokenLifetime.ts')

let passed = 0
const failures = []
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++
  else failures.push(`${label}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`)
}

const NOW = Date.parse('2026-09-25T08:00:00Z')
const inDays = d => new Date(NOW + d * 86_400_000).toISOString()

// A missing expiry is UNKNOWN, never expired — a bare-token paste and every
// pre-migration-101 row have none, and nothing may be gated on that.
check('null        ', npssoLifetime(null, NOW), { state: 'unknown', days: null })
check('undefined   ', npssoLifetime(undefined, NOW), { state: 'unknown', days: null })
check('empty       ', npssoLifetime('', NOW), { state: 'unknown', days: null })
check('garbage     ', npssoLifetime('not a date', NOW), { state: 'unknown', days: null })

// The real thing: Sony's expires_in is 5183980s ≈ 59.9 days.
const sony = new Date(NOW + 5183980 * 1000).toISOString()
check('sony 60d    ', npssoLifetime(sony, NOW), { state: 'ok', days: 59 })

check('30 days     ', npssoLifetime(inDays(30), NOW), { state: 'ok', days: 30 })
check('window+1    ', npssoLifetime(inDays(NPSSO_RENEW_WINDOW_DAYS + 1), NOW),
  { state: 'ok', days: NPSSO_RENEW_WINDOW_DAYS + 1 })
// Boundary: exactly at the window is already "renew soon", not "fine".
check('window exact', npssoLifetime(inDays(NPSSO_RENEW_WINDOW_DAYS), NOW),
  { state: 'soon', days: NPSSO_RENEW_WINDOW_DAYS })
check('3 days      ', npssoLifetime(inDays(3), NOW), { state: 'soon', days: 3 })
check('2 hours     ', npssoLifetime(new Date(NOW + 2 * 3600_000).toISOString(), NOW),
  { state: 'soon', days: 0 })
check('exactly now ', npssoLifetime(new Date(NOW).toISOString(), NOW), { state: 'expired', days: 0 })
check('1 day past  ', npssoLifetime(inDays(-1), NOW), { state: 'expired', days: -1 })
check('60 days past', npssoLifetime(inDays(-60), NOW), { state: 'expired', days: -60 })

// Labels
check('label unknown', npssoLifetimeLabel(npssoLifetime(null, NOW)), null)
check('label ok     ', npssoLifetimeLabel(npssoLifetime(inDays(42), NOW)), '42 days left')
check('label one    ', npssoLifetimeLabel(npssoLifetime(inDays(1), NOW)), '1 day left')
check('label today  ', npssoLifetimeLabel(npssoLifetime(new Date(NOW + 3600_000).toISOString(), NOW)), 'expires today')
check('label expired', npssoLifetimeLabel(npssoLifetime(inDays(-2), NOW)), 'expired')

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log('npsso lifetime arithmetic holds.\n')
