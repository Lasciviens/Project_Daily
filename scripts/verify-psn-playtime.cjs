/**
 * verify-psn-playtime.cjs — sucrase-run assertions against the REAL
 * `parsePlayDurationMinutes` in src/features/games/api/psnApi.ts.
 *
 * Why this exists: PSN reports playtime as an ISO 8601 duration string
 * ("PT228H56M33S") and that is the ONLY playtime figure the whole API
 * exposes — every hour shown on the PlayStation tab, every sort, and the
 * library's total all run through this one parser. A silent bug here would
 * misreport hours everywhere with nothing to catch it (this repo ships no
 * unit-test framework — see CLAUDE.md's Session Workflow; the precedent is
 * scripts/verify-health-source-resolver.cjs).
 *
 * Run: node scripts/verify-psn-playtime.cjs
 */
require('sucrase/register')

// The module imports the live Supabase client transitively, which cannot be
// constructed here — stub the import so the pure function stays requirable.
const Module = require('module')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.endsWith('integrations/supabase/client')) {
    return require.resolve('./__psn_supabase_stub.cjs')
  }
  return origResolve.call(this, request, ...rest)
}

const { parsePlayDurationMinutes } = require('../src/features/games/api/psnApi.ts')

let pass = 0, fail = 0
function eq(actual, expected, label) {
  if (actual === expected) { pass++; return }
  fail++
  console.error(`✗ ${label}\n    expected ${expected}, got ${actual}`)
}

// ── Real values observed in Sony's own responses ────────────────────────
eq(parsePlayDurationMinutes('PT228H56M33S'), 13737, '228h 56m 33s → minutes (rounds the 33s up)')
eq(parsePlayDurationMinutes('PT340H46M13S'), 20446, '340h 46m 13s → minutes')

// ── Each component alone ────────────────────────────────────────────────
eq(parsePlayDurationMinutes('PT1H'), 60, 'hours only')
eq(parsePlayDurationMinutes('PT30M'), 30, 'minutes only')
eq(parsePlayDurationMinutes('PT45S'), 1, 'seconds only, rounded to a minute')
eq(parsePlayDurationMinutes('PT29S'), 0, 'under 30s rounds down to zero')
eq(parsePlayDurationMinutes('PT2H30M'), 150, 'hours + minutes, no seconds')

// ── A day component: not seen in the wild, but ISO 8601 allows it and
//    silently dropping it would under-report by whole days. ─────────────
eq(parsePlayDurationMinutes('P1DT2H'), 1560, 'day + hour components')

// ── Degenerate input must be 0, never NaN — these feed a sort comparator
//    and a running total, where a NaN would poison the whole column. ────
eq(parsePlayDurationMinutes(undefined), 0, 'undefined → 0')
eq(parsePlayDurationMinutes(''), 0, 'empty string → 0')
eq(parsePlayDurationMinutes('garbage'), 0, 'unparseable → 0')
eq(parsePlayDurationMinutes('PT'), 0, 'empty duration → 0')

// ── Ordering is what the library grid actually depends on ───────────────
const sorted = ['PT30M', 'PT228H56M33S', 'PT2H', undefined]
  .sort((a, b) => parsePlayDurationMinutes(b) - parsePlayDurationMinutes(a))
eq(sorted[0], 'PT228H56M33S', 'longest playtime sorts first')
eq(sorted[3], undefined, 'missing playtime sorts last')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
