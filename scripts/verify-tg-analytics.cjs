// Throwaway verification for the Analytics KPI drill-downs
// (src/features/games/test-game/components/tgAnalyticsModel.ts): every tile's
// list adds up to that tile's number. No unit test framework here (CLAUDE.md).
//   node scripts/verify-tg-analytics.cjs
require('sucrase/register')
const assert = require('assert')
const A = require('../src/features/games/test-game/components/tgAnalyticsModel.ts')

let n = 0
const ok = (a, b, what) => { assert.deepStrictEqual(a, b, what); n++ }
let seq = 0
const game = (over = {}) => ({
  id: 'g' + (++seq), title: over.title ?? 'Game ' + seq, genres: null, play_status: 'backlog', rating: null,
  play_order: null, library: 'retro', play_seconds: null, play_count: null, last_played_at: null,
  started_at: null, finished_at: null, esde_playcount: null, esde_last_played: null, esde_playtime_seconds: null,
  platforms: [], platformKey: 'snes', hidden: false, steamAppId: null, notAGame: false, ...over,
})

const lib = [
  game({ title: 'Horizon', play_status: 'playing', play_seconds: 7200, last_played_at: '2026-09-20T10:00:00Z', rating: 8 }),
  game({ title: 'Hogwarts', play_status: 'completed', play_seconds: 21600, last_played_at: '2026-03-01T10:00:00Z', finished_at: '2026-03-01T10:00:00Z', rating: 9 }),
  game({ title: 'Old one', play_status: 'completed', play_seconds: 3600, last_played_at: '2024-05-01T10:00:00Z', finished_at: '2024-05-01T10:00:00Z' }),
  game({ title: 'Unplayed', play_status: 'backlog' }),
  game({ title: 'No status', play_status: null, play_seconds: 600, last_played_at: '2026-02-01T10:00:00Z', rating: 5 }),
  game({ title: 'Wish', play_status: 'wishlist' }),
  game({ title: 'Hidden', play_status: 'playing', hidden: true, play_seconds: 99999, last_played_at: '2026-09-01T10:00:00Z' }),
]
const today = new Date(2026, 8, 25).getTime()
const secs = gs => gs.reduce((s, g) => s + (g.play_seconds ?? 0), 0)

for (const w of ['all', 'year', '30d', '12m']) {
  const start = A.windowStart(w, today)
  const scoped = A.scopeByWindow(A.libraryGames(lib, 'all'), start)
  const k = A.computeKpis(scoped, start)
  const t = kind => A.tileGames(kind, scoped, start)
  ok(t('games').length, k.games, `${w}: Games list = tile`)
  ok(t('playing').length, k.playing, `${w}: Playing list = tile`)
  ok(t('completed').length, k.completed, `${w}: Completed list = tile`)
  ok(t('backlog').length, k.backlog, `${w}: Backlog list = tile`)
  ok(t('rating').length, k.rated, `${w}: Rated list = tile count`)
  ok(t('playtime').length, k.playedGames, `${w}: Playtime list count = tile`)
  ok(secs(t('playtime')), k.playtimeSeconds, `${w}: Playtime list sums to the tile`)
  ok(t('games').some(g => g.hidden), false, `${w}: hidden games never counted`)
}

const yStart = A.windowStart('year', today)
const year = A.scopeByWindow(A.libraryGames(lib, 'all'), yStart)
ok(A.tileGames('playtime', year, yStart).map(g => g.title), ['Hogwarts', 'Horizon', 'No status'], 'this year: playtime desc, only games played this year')
ok(A.tileGames('completed', year, yStart).map(g => g.title), ['Hogwarts'], 'this year: finished in the window only')
ok(A.tileGames('completed', A.libraryGames(lib, 'all'), null).map(g => g.title), ['Hogwarts', 'Old one'], 'all time: status Completed, newest finish first')
ok(A.tileGames('rating', year, yStart).map(g => g.title), ['Hogwarts', 'Horizon', 'No status'], 'ratings high to low')
ok(A.tileGames('backlog', A.libraryGames(lib, 'all'), null).map(g => g.title), ['No status', 'Unplayed'], 'backlog includes no-status games, latest session first')
ok(A.computeKpis(year, yStart).avgStars, Math.round(((4 + 4.5 + 2.5) / 3) * 100) / 100, 'average rating of the rated list')

// ── One completion rule (isCompletion) for the tile, its list and the chart ──
const S = require('../src/features/games/test-game/components/tgAnalyticsSeries.ts')
const end = A.windowEnd(today)
const replay = game({ title: 'Replay', play_status: 'playing', finished_at: '2026-06-01T10:00:00Z', last_played_at: '2026-09-10T10:00:00Z' })
const future = game({ title: 'Typo', play_status: 'completed', finished_at: '2027-01-15T10:00:00Z' })
const undated = game({ title: 'Undated', play_status: 'completed' })
const lib2 = [...lib, replay, future, undated]
const all2 = A.libraryGames(lib2, 'all')
ok(A.windowEnd(today), new Date(2026, 8, 26).getTime(), 'window end = next local midnight')
ok(A.isCompletion(replay, yStart, end), false, 'a finish date on a game no longer Completed is not a completion')
ok(A.isCompletion(future, yStart, end), false, 'a future finish date is in no window')
ok(A.isCompletion(future, null, end), true, 'all time: every Completed game counts')
ok(A.tileGames('completed', A.scopeByWindow(all2, yStart, end), yStart, end).map(g => g.title), ['Hogwarts'], 'this year: the replay and the typo are not completions')
for (const w of ['all', 'year', '30d', '12m']) {
  const st = A.windowStart(w, today)
  const sc = A.scopeByWindow(all2, st, end)
  const series = S.completionSeries(all2, w, today)
  const tile = A.computeKpis(sc, st, end).completed
  if (w === 'all') ok(series.total + series.earlier + series.undated + series.future, tile, 'all time: chart + earlier + undated + future = the Completed tile')
  else ok(series.total, tile, `${w}: the chart total = the Completed tile`)
}
ok(S.completionSeries(all2, 'all', today).future, 1, 'future finish dates are counted, not plotted')

console.log(`verify-tg-analytics: ${n} assertions passed`)
