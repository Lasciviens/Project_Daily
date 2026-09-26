// Throwaway verification for the Analytics Overview tab's own pure pieces:
// the Activity chart rows and words (tgAnalyticsActivity.ts) and the KPI /
// idle / hidden copy (tgAnalyticsDrillCopy.ts). No unit test framework here
// (CLAUDE.md).
//   node scripts/verify-tg-analytics-overview.cjs
require('sucrase/register')
const assert = require('assert')
const dir = '../src/features/games/test-game/components/'
const A = require(dir + 'tgAnalyticsModel.ts')
const S = require(dir + 'tgAnalyticsSeries.ts')
const V = require(dir + 'tgAnalyticsActivity.ts')
const C = require(dir + 'tgAnalyticsDrillCopy.ts')

let n = 0
const ok = (a, b, what) => { assert.deepStrictEqual(a, b, what); n++ }
let seq = 0
const game = (over = {}) => ({
  id: 'g' + (++seq), title: over.title ?? 'Game ' + seq, genres: null, play_status: 'backlog', rating: null,
  play_order: null, library: 'retro', play_seconds: null, play_count: null, last_played_at: null,
  started_at: null, finished_at: null, esde_playcount: null, esde_last_played: null, esde_playtime_seconds: null,
  platforms: [], platformKey: 'snes', hidden: false, steamAppId: null, notAGame: false, ...over,
})
const today = new Date(2026, 8, 25).getTime()

// ── Activity rows ──
const lib = [
  game({ library: 'retro', play_seconds: 3600, last_played_at: '2026-09-20T10:00:00Z' }),
  game({ library: 'steam', play_seconds: 7200, last_played_at: '2026-09-21T10:00:00Z' }),
  game({ library: 'retro', play_seconds: 600, last_played_at: '2026-08-02T10:00:00Z', play_status: 'completed', finished_at: '2026-06-10T10:00:00Z' }),
  game({ library: 'steam', play_seconds: 120, last_played_at: '2026-09-22T10:00:00Z' }), // a launch, not play
  game({ library: 'retro', play_seconds: 3600, last_played_at: '2022-01-01T10:00:00Z' }), // older than 24 months
]
const all = S.activitySeries(lib, 'all', today)
const rows = V.activityRows(all)
ok(rows.length, all.columns.length, 'one row per column')
ok(rows.every(r => r.retro + r.steam + r.playstation === r.count), true, 'flattened parts add up to the column')
const sep = rows.find(r => r.key === '2026-09')
ok([sep.retro, sep.steam, sep.top], [1, 1, 'steam'], 'September: retro and steam, steam on top (stacking order)')
const aug = rows.find(r => r.key === '2026-08')
ok([aug.retro, aug.steam, aug.top, aug.done], [1, 0, 'retro', null], 'August: only retro, so retro gets the rounded end; no completion')
const jun = rows.find(r => r.key === '2026-06')
ok([jun.count, jun.top, jun.done], [0, null, 1], 'June: no session but a completion — a marker on an empty column')
ok(all.libraries, ['retro', 'steam'], 'only libraries on the chart are stacked')
ok(V.activityMeta(all), '3 games · 1 completion', 'meta: games and completions')
ok(V.activityNote(all), 'Not shown: 1 game last played before this chart starts.', 'note for the older game')
ok(V.activityNote(S.activitySeries(lib, '30d', today)), null, 'windows never count "earlier"')
ok(V.isActivityEmpty(all), false, 'not empty')
ok(V.isActivityEmpty(S.activitySeries([], '7d', today)), true, 'empty with nothing played or finished')
const onlyDone = S.activitySeries([game({ play_status: 'completed', finished_at: '2026-09-24T10:00:00Z' })], '7d', today)
ok(V.isActivityEmpty(onlyDone), false, 'a completion alone keeps the chart')
ok([V.markerFits(240, 10), V.markerFits(230, 10), V.markerFits(500, 0)], [true, false, false], 'pill needs 24px per column')
ok(V.libLine('playstation', 1), 'PlayStation: 1 game', 'library line')

// ── KPI copy ──
const k = (over = {}) => ({
  games: 10, platforms: 2, playing: 3, queued: 2, completed: 2, completionBase: 8, playtimeSeconds: 0, playedGames: 0,
  avgStars: null, rated: 0, backlog: 4, backlogUnplayed: 3, played: 6, started: 5, stalePlaying: 0, ...over,
})
ok(C.playingSub(k()), '2 in your play queue', 'playing: queue when nothing is idle')
ok(C.playingSub(k({ queued: 0 })), 'Nothing queued next', 'playing: empty queue')
ok(C.playingSub(k({ stalePlaying: 2 })), '2 with no session in 60+ days', 'playing: idle count wins')
ok(C.completedShare(k(), false), 2 / 5, 'all time: share of started')
ok(C.completedShare(k(), true), 2 / 8, 'window: share of games played')
ok(C.completedShare(k({ started: 0, completed: 0 }), false), null, 'no ring with nothing started')
ok(C.completedSub(k(), false), '40% of games you’ve started · 25% of owned', 'all time copy')
ok(C.completedSub(k(), true), '25% of games played', 'window copy unchanged')
ok(C.completedSub(k({ started: 0, completed: 0 }), false), 'Nothing started yet', 'all time, nothing started')
ok(C.playedSub(k()), '40% with no recorded play', 'played: the share without play')
ok(C.playedSub(k({ played: 10 })), 'Every game has recorded play', 'played: everything')

// The Played tile and its drill-down are the same list.
const scoped = A.libraryGames(lib, 'all')
const kp = A.computeKpis(scoped, null, null, today)
ok(A.tileGames('played', scoped, null).length, kp.played, 'Played tile = its drill-down')

// ── Idle and hidden ──
ok([C.idleLabel(94), C.idleLabel(1), C.idleLabel(null)], ['idle 94 days', 'idle 1 day', 'no session recorded'], 'idle labels')
ok(C.idleSplit({ chosen: 2, auto: 3 }), '2 with a start date · 3 with none (often an import)', 'idle split says what the data shows')
ok(C.hiddenNote({ total: 3, explicit: 2, auto: 1 }), '3 hidden titles aren’t counted here (2 hidden by you, 1 app or non-game)', 'hidden: both kinds')
ok(C.hiddenNote({ total: 1, explicit: 1, auto: 0 }), '1 hidden title isn’t counted here (1 hidden by you)', 'hidden: singular, one kind')
ok(C.hiddenNote({ total: 4, explicit: 0, auto: 4 }), '4 hidden titles aren’t counted here (4 apps and non-games)', 'hidden: apps only')

console.log(`verify-tg-analytics-overview: ${n} assertions passed`)
