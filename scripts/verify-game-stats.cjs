// Throwaway verification for src/features/games/gameStats.ts — no unit-test
// framework in this repo (see CLAUDE.md), so this runs the REAL module through
// sucrase and asserts against it.  node scripts/verify-game-stats.cjs
require('sucrase/register')
const assert = require('assert')
const {
  formatPlaytime, formatPlaytimeShort, hasPlayData, computePlaytimeStats,
  isRealPlay, sortByRecentlyPlayed, MIN_REAL_PLAY_SECONDS, playStatsOf,
  withinWindow, STATS_WINDOWS, shouldAutoMarkPlaying, AUTO_PLAYING_SECONDS,
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

// ── isRealPlay / sortByRecentlyPlayed ───────────────────────────────────────
ok(MIN_REAL_PLAY_SECONDS, 300, 'the real-play floor is five minutes')
ok(isRealPlay(300), true, 'exactly five minutes counts')
ok(isRealPlay(299), false, 'just under does not')
ok(isRealPlay(null), false, 'no recorded time is not real play')

const recent = sortByRecentlyPlayed([
  { id: 'old-real',  esde_last_played: '2026-01-01T00:00:00Z', esde_playtime_seconds: 9000 },
  { id: 'brief',     esde_last_played: '2026-09-01T00:00:00Z', esde_playtime_seconds: 60 },
  { id: 'new-real',  esde_last_played: '2026-05-01T00:00:00Z', esde_playtime_seconds: 600 },
  { id: 'unplayed',  esde_last_played: null,                   esde_playtime_seconds: null },
])
ok(recent.map(g => g.id), ['new-real', 'old-real', 'brief', 'unplayed'],
  'real play sorts by recency first; a 1-minute peek never outranks it')
ok(sortByRecentlyPlayed([]).length, 0, 'empty input')
// NEVER_HIDES: a sort reorders, it never drops a row.
ok(sortByRecentlyPlayed([
  { id: 'x', esde_last_played: null, esde_playtime_seconds: null },
]).length, 1, 'an unplayed game is still in the list')

// ── playStatsOf: neutral columns win, ES-DE is the pre-096 fallback ─────────
ok(playStatsOf({ id: 'a', title: 'x', play_seconds: 600, esde_playtime_seconds: 60 }).seconds, 600,
  'the source-neutral column wins over the ES-DE one')
ok(playStatsOf({ id: 'a', title: 'x', esde_playtime_seconds: 60, esde_playcount: 2, esde_last_played: 'z' }),
  { seconds: 60, count: 2, last: 'z' },
  'before migration 096 the ES-DE figures are still read')
ok(playStatsOf({ id: 'a', title: 'x' }), { seconds: null, count: null, last: null },
  'a row with neither reports nothing rather than zero')
// A Steam row has no esde_* at all — it must still count.
ok(computePlaytimeStats([
  { id: 's', title: 'Steam game', play_seconds: 7200, play_count: 3, last_played_at: '2026-09-01T00:00:00Z' },
]).totalSeconds, 7200, 'a provider row with only neutral columns is counted')

// ── withinWindow ────────────────────────────────────────────────────────────
const NOW = new Date('2026-09-16T12:00:00Z')
const days = (d) => new Date(NOW.getTime() - d * 86400000).toISOString()
const windowRows = [
  { id: 'yesterday', title: 'a', last_played_at: days(1) },
  { id: 'lastmonth', title: 'b', last_played_at: days(40) },
  { id: 'lastyear',  title: 'c', last_played_at: days(300) },
  { id: 'never',     title: 'd', last_played_at: null },
]
ok(withinWindow(windowRows, '7d', NOW).map(g => g.id), ['yesterday'], 'a week')
ok(withinWindow(windowRows, '90d', NOW).map(g => g.id), ['yesterday', 'lastmonth'], 'three months')
ok(withinWindow(windowRows, '365d', NOW).map(g => g.id), ['yesterday', 'lastmonth', 'lastyear'], 'a year')
ok(withinWindow(windowRows, 'all', NOW).length, 4, 'all time keeps the never-played row too')
ok(withinWindow(windowRows, '30d', NOW).some(g => g.id === 'never'), false,
  'a game with no last-played date is in no dated window')
ok(STATS_WINDOWS.map(w => w.key), ['7d', '30d', '90d', '365d', 'all'], 'the five offered windows')

// ── shouldAutoMarkPlaying ───────────────────────────────────────────────────
ok(AUTO_PLAYING_SECONDS, 1800, 'thirty minutes')
ok(shouldAutoMarkPlaying('backlog', 1800), true, 'exactly thirty minutes promotes a backlog game')
ok(shouldAutoMarkPlaying('backlog', 1799), false, 'just under does not')
ok(shouldAutoMarkPlaying('backlog', null), false, 'no recorded time does not')
// Every other status is something the user said, and a sync never argues.
ok(shouldAutoMarkPlaying('completed', 999999), false, 'replaying a finished game does not un-complete it')
ok(shouldAutoMarkPlaying('dropped', 999999), false, 'nor does it undrop one')
ok(shouldAutoMarkPlaying('wishlist', 999999), false, 'nor promote a wishlist entry')
ok(shouldAutoMarkPlaying('playing', 999999), false, 'and a game already playing needs no change')

console.log(`✅ ${n} assertions passed`)
