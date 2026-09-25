#!/usr/bin/env node
/*
 * Verification — the saved-library projection the PlayStation grid paints from
 * while Sony is still being reached (src/features/games/api/psnLibraryFallback.ts).
 *
 * Run: node scripts/verify-psn-library-fallback.cjs
 */
require('sucrase/register')

// psnApi.ts transitively imports the live Supabase client, which cannot be
// constructed here — the same stub verify-psn-playtime.cjs already uses. The
// real parser is what matters: the whole point of the projection below is that
// it reads back through it identically to a live row.
const Module = require('module')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.endsWith('integrations/supabase/client')) {
    return require.resolve('./__psn_supabase_stub.cjs')
  }
  return origResolve.call(this, request, ...rest)
}

const {
  secondsToIsoDuration, psnGamesFromLibrary, psnRecentlyPlayed,
} = require('../src/features/games/api/psnLibraryFallback.ts')
const { parsePlayDurationMinutes } = require('../src/features/games/api/psnApi.ts')

let n = 0
const failures = []
const ok = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) n++
  else failures.push(`${label}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`)
}

// ── secondsToIsoDuration ────────────────────────────────────────────────────
ok(secondsToIsoDuration(0), 'PT0H0M0S', 'zero')
ok(secondsToIsoDuration(59), 'PT0H0M59S', 'seconds only')
ok(secondsToIsoDuration(3600), 'PT1H0M0S', 'exactly an hour')
ok(secondsToIsoDuration(824193), 'PT228H56M33S', "Sony's own example round-trips")
ok(secondsToIsoDuration(null), 'PT0H0M0S', 'null is zero, never NaN')
ok(secondsToIsoDuration(-5), 'PT0H0M0S', 'a negative can never reach the screen')

// The point of round-tripping through Sony's format: the SAME parser the live
// rows use must read the saved ones identically, or the fallback would be a
// second, subtly different library.
// The invariant that matters is EQUALITY WITH THE LIVE ROW, not a hand-picked
// number: Sony's own string and our projection of the same span must parse to
// the identical figure, whatever rounding the parser applies to the seconds.
ok(parsePlayDurationMinutes(secondsToIsoDuration(824193)),
   parsePlayDurationMinutes('PT228H56M33S'),
  'a projected duration and Sony\'s own string parse identically')

// ── psnGamesFromLibrary ─────────────────────────────────────────────────────
const lib = [
  { external_ref: 'CUSA1', title: 'Bloodborne', primary_cover_url: 'u1',
    play_seconds: 7200, play_count: 12, last_played_at: '2026-09-20T10:00:00Z' },
  { external_ref: null, title: 'No id — cannot be keyed', play_seconds: 60 },
  { external_ref: 'CUSA2', title: 'Returnal', primary_cover_url: null,
    play_seconds: null, play_count: null, last_played_at: null },
]
const projected = psnGamesFromLibrary(lib)
ok(projected.map(g => g.titleId), ['CUSA1', 'CUSA2'],
  'a row with no provider id is dropped — it could never be matched back')
ok(projected[0].playDuration, 'PT2H0M0S', 'seconds become a Sony duration')
ok(parsePlayDurationMinutes(projected[0].playDuration), 120, 'and read back as real minutes')
ok(projected[1].playDuration, 'PT0H0M0S', 'a never-played row is zero, not missing')
ok(projected[0].imageUrl, 'u1', 'the saved cover is used')
ok(projected[1].imageUrl, undefined, 'and a missing one stays missing rather than becoming ""')
ok(projected[0].category, undefined,
  'category is NEVER guessed — it drives is-this-a-game, and inventing it would hide or reveal rows on a fact we do not have')

// ── psnRecentlyPlayed ───────────────────────────────────────────────────────
const NOW = Date.parse('2026-09-25T08:00:00Z')
const daysAgo = d => new Date(NOW - d * 86_400_000).toISOString()
const played = [
  { titleId: 'old',    lastPlayedDateTime: daysAgo(30) },
  { titleId: 'recent', lastPlayedDateTime: daysAgo(2) },
  { titleId: 'edge',   lastPlayedDateTime: daysAgo(14) },
  { titleId: 'never',  lastPlayedDateTime: undefined },
  { titleId: 'junk',   lastPlayedDateTime: 'not a date' },
  { titleId: 'mid',    lastPlayedDateTime: daysAgo(7) },
]
ok(psnRecentlyPlayed(played, 14, NOW).map(g => g.titleId), ['recent', 'mid', 'edge'],
  'inside the window, most recent first; the 14-day edge is inclusive')
ok(psnRecentlyPlayed(played, 3, NOW).map(g => g.titleId), ['recent'], 'a narrower window')
ok(psnRecentlyPlayed([], 14, NOW), [], 'nothing played')
ok(psnRecentlyPlayed(played, 14, NOW).some(g => g.titleId === 'junk'), false,
  'an unparseable date is excluded rather than sorting as 1970')

console.log(`\n${n} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log('PSN saved-library projection holds.\n')
