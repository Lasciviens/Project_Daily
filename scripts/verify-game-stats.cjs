// Throwaway verification for src/features/games/gameStats.ts — no unit-test
// framework in this repo (see CLAUDE.md), so this runs the REAL module through
// sucrase and asserts against it.  node scripts/verify-game-stats.cjs
require('sucrase/register')
const assert = require('assert')
const {
  formatPlaytime, formatPlaytimeShort, hasPlayData, computePlaytimeStats,
} = require('../src/features/games/gameStats.ts')

let n = 0
const ok = (actual, expected, what) => { assert.deepStrictEqual(actual, expected, what); n++ }

// ── formatPlaytime ──────────────────────────────────────────────────────────
ok(formatPlaytime(8040), '2h 14m', 'hours + minutes')
ok(formatPlaytime(2700), '45m', 'under an hour keeps its minutes')
ok(formatPlaytime(7200), '2h', 'a whole number of hours drops the 0m')
ok(formatPlaytime(30), '<1m', 'under a minute is still real play time')
ok(formatPlaytime(0), null, 'zero is no play time')
ok(formatPlaytime(null), null, 'null')
ok(formatPlaytime(undefined), null, 'undefined')
ok(formatPlaytime(-5), null, 'a negative value is not play time')
ok(formatPlaytime(NaN), null, 'NaN never reaches the UI as a string')
// The bug this module exists for: the old Math.round(s/3600) printed "0h".
assert.notStrictEqual(formatPlaytime(2400), '0h'); n++

// ── formatPlaytimeShort ─────────────────────────────────────────────────────
ok(formatPlaytimeShort(8040), '2h', 'short form truncates to hours')
ok(formatPlaytimeShort(2700), '45m', 'short form keeps sub-hour minutes')
ok(formatPlaytimeShort(30), '<1m', 'short form never claims a full minute it does not have')
ok(formatPlaytimeShort(3599), '59m', 'short form floors, so 59:59 is not an hour')
ok(formatPlaytimeShort(0), null, 'short form: zero')

// ── hasPlayData ─────────────────────────────────────────────────────────────
ok(hasPlayData({ esde_playcount: 3, esde_playtime_seconds: null, esde_last_played: null }), true, 'a play count alone counts')
ok(hasPlayData({ esde_playcount: null, esde_playtime_seconds: 60, esde_last_played: null }), true, 'play time alone counts')
ok(hasPlayData({ esde_playcount: null, esde_playtime_seconds: null, esde_last_played: '2026-01-01T00:00:00Z' }), true, 'a last-played date alone counts')
ok(hasPlayData({ esde_playcount: 0, esde_playtime_seconds: 0, esde_last_played: null }), false, 'all-zero is no play data')

// ── computePlaytimeStats ────────────────────────────────────────────────────
const rows = [
  { id: 'a', title: 'Contra',        esde_playcount: 4, esde_playtime_seconds: 7200, esde_last_played: '2026-02-01T10:00:00Z' },
  { id: 'b', title: 'Sonic 2',       esde_playcount: 1, esde_playtime_seconds: 1800, esde_last_played: '2026-03-05T10:00:00Z' },
  { id: 'c', title: 'Never touched', esde_playcount: null, esde_playtime_seconds: null, esde_last_played: null },
  { id: 'd', title: 'Opened once',   esde_playcount: 1, esde_playtime_seconds: 0,    esde_last_played: '2026-01-01T10:00:00Z' },
]
const s = computePlaytimeStats(rows)
ok(s.totalSeconds, 9000, 'total sums only positive play time')
ok(s.playedCount, 3, 'a launch with no recorded duration still counts as played')
ok(s.neverPlayedCount, 1, 'never-played is the remainder')
ok(s.lastPlayed, '2026-03-05T10:00:00Z', 'last played is the max, not the last row')
ok(s.topPlayed.map(t => t.title), ['Contra', 'Sonic 2'], 'top list is play-time ordered and excludes zero-time rows')
ok(s.topPlayed[0].playcount, 4, 'top list carries the play count')
ok(computePlaytimeStats([]).lastPlayed, null, 'empty library has no last-played')
ok(computePlaytimeStats([]).neverPlayedCount, 0, 'empty library has nothing unplayed')
ok(computePlaytimeStats(rows, 1).topPlayed.length, 1, 'topN is honoured')

console.log(`✅ ${n} assertions passed`)
