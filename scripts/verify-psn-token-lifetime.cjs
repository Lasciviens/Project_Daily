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
const inMinutes = m => new Date(NOW + m * 60_000).toISOString()
/** state + days only — the minute field is asserted separately below. */
const sd = at => { const l = npssoLifetime(at, NOW); return [l.state, l.days] }

// A missing expiry is UNKNOWN, never expired — a bare-token paste and every
// pre-migration-101 row have none, and nothing may be gated on that.
const UNKNOWN = { state: 'unknown', days: null, minutes: null }
check('null         ', npssoLifetime(null, NOW), UNKNOWN)
check('undefined    ', npssoLifetime(undefined, NOW), UNKNOWN)
check('empty        ', npssoLifetime('', NOW), UNKNOWN)
check('garbage      ', npssoLifetime('not a date', NOW), UNKNOWN)

// The real thing: Sony's expires_in is 5183980s ≈ 59.9 days.
check('sony 60d     ', sd(new Date(NOW + 5183980 * 1000).toISOString()), ['ok', 59])

check('30 days      ', sd(inDays(30)), ['ok', 30])
check('window+1     ', sd(inDays(NPSSO_RENEW_WINDOW_DAYS + 1)), ['ok', NPSSO_RENEW_WINDOW_DAYS + 1])
// Boundary: exactly at the window is already "renew soon", not "fine".
check('window exact ', sd(inDays(NPSSO_RENEW_WINDOW_DAYS)), ['soon', NPSSO_RENEW_WINDOW_DAYS])
check('3 days       ', sd(inDays(3)), ['soon', 3])
check('2 hours      ', sd(inMinutes(120)), ['soon', 0])
check('exactly now  ', sd(new Date(NOW).toISOString()), ['expired', 0])
check('1 day past   ', sd(inDays(-1)), ['expired', -1])
check('60 days past ', sd(inDays(-60)), ['expired', -60])

// Minutes are what the label is built from, so they carry their own checks.
check('minutes 2h   ', npssoLifetime(inMinutes(120), NOW).minutes, 120)
check('minutes past ', npssoLifetime(inMinutes(-90), NOW).minutes, -90)

// ── Labels: days/hours/minutes, the same units the rest of Games uses ───────
check('label unknown', npssoLifetimeLabel(npssoLifetime(null, NOW)), null)
check('label expired', npssoLifetimeLabel(npssoLifetime(inDays(-2), NOW)), 'expired')
check('label days   ', npssoLifetimeLabel(npssoLifetime(inDays(42), NOW)), '42d')
check('label one day', npssoLifetimeLabel(npssoLifetime(inDays(1), NOW)), '1d')
check('label hours  ', npssoLifetimeLabel(npssoLifetime(inMinutes(60), NOW)), '1h')
check('label minutes', npssoLifetimeLabel(npssoLifetime(inMinutes(41), NOW)), '41m')
// The reported shape, in full. A bare day count would render this as "64 days
// left" at 64d 5h and again at 64d 0h 1m -- the last day would be invisible.
check('label d h m  ', npssoLifetimeLabel(npssoLifetime(inMinutes(64 * 1440 + 5 * 60 + 41), NOW)), '64d 5h 41m')

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log('npsso lifetime arithmetic holds.\n')
