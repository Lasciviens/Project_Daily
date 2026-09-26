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

for (const w of ['all', 'year', '90d', '30d', '12m', '7d']) {
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
for (const w of ['all', 'year', '90d', '30d', '12m', '7d']) {
  const st = A.windowStart(w, today)
  const sc = A.scopeByWindow(all2, st, end)
  const series = S.completionSeries(all2, w, today)
  const tile = A.computeKpis(sc, st, end).completed
  if (w === 'all') ok(series.total + series.earlier + series.undated + series.future, tile, 'all time: chart + earlier + undated + future = the Completed tile')
  else ok(series.total, tile, `${w}: the chart total = the Completed tile`)
}
ok(S.completionSeries(all2, 'all', today).future, 1, 'future finish dates are counted, not plotted')

// ── Timelines: 7 days, 30 days, 90 days (weeks) ──
const t7 = S.buildTimeline('7d', today), t30 = S.buildTimeline('30d', today), t90 = S.buildTimeline('90d', today)
ok([t7.columns.length, t7.unit, t30.columns.length], [7, 'day', 30], '7 and 30 days plot one column a day')
ok([t90.unit, t90.first], ['week', A.windowStart('90d', today)], '90 days plots weeks from the window start')
ok(t90.columns.length, 14, '90 days back from a Friday spans 14 Monday weeks')
ok(t90.columns[0].full, 'Week of 28 Jun 2026', 'the first week is clipped to the window start')
ok(t90.keyOf(new Date(2026, 8, 24).getTime()), t90.columns[t90.columns.length - 1].key, 'a Thursday falls in its Monday week')

// ── Activity: every played game once, at its latest session ──
const actLib = [
  game({ title: 'R1', library: 'retro', play_seconds: 3600, last_played_at: '2026-09-20T10:00:00Z' }),
  game({ title: 'S1', library: 'steam', play_seconds: 7200, last_played_at: '2026-09-21T10:00:00Z' }),
  game({ title: 'P1', library: 'playstation', play_seconds: 600, last_played_at: '2026-09-02T10:00:00Z', play_status: 'completed', finished_at: '2026-09-03T10:00:00Z' }),
  game({ title: 'Peek', library: 'retro', play_seconds: 40, last_played_at: '2026-09-22T10:00:00Z' }),
  game({ title: 'Old', library: 'retro', play_seconds: 9000, last_played_at: '2023-01-01T10:00:00Z' }),
  game({ title: 'Never', library: 'retro' }),
]
const act30 = S.activitySeries(actLib, '30d', today)
ok(act30.total, 3, '30 days: three real sessions (a 40-second peek is not play)')
ok(act30.columns.reduce((n, c) => n + c.parts.retro + c.parts.steam + c.parts.playstation, 0), act30.total, 'library parts add up to the total')
ok(act30.columns.every(c => c.count === c.parts.retro + c.parts.steam + c.parts.playstation), true, 'each column’s count is its parts')
ok([act30.completed, act30.libraries], [1, ['retro', 'steam', 'playstation']], 'window completions alongside; libraries in stacking order')
const actAll = S.activitySeries(actLib, 'all', today)
ok(actAll.total + actAll.earlier, 4, 'all time: plotted + earlier = every game with a real session')

// ── The Played tile, started games and stale Playing ──
const M = require('../src/features/games/test-game/components/tgAnalyticsMore.ts')
const kAll = A.computeKpis(A.libraryGames(lib, 'all'), null, null, today)
ok(kAll.played, A.tileGames('played', A.libraryGames(lib, 'all'), null).length, 'Played list = tile')
ok(kAll.played, 4, 'played = recorded play time, launches or a session date')
ok(kAll.started, 4, 'started = played or a started status')
const stale = game({ title: 'Stale', play_status: 'playing', last_played_at: '2026-05-01T10:00:00Z' })
const fresh = game({ title: 'Fresh', play_status: 'playing', started_at: '2026-09-01T10:00:00Z', last_played_at: '2026-09-20T10:00:00Z' })
const ghost = game({ title: 'Ghost', play_status: 'playing' })
ok(A.computeKpis([stale, fresh, ghost], null, null, today).stalePlaying, 2, 'stale = no session for 60+ days, or none at all')
const pb = M.playingBreakdown([stale, fresh, ghost], today)
ok([pb.total, pb.chosen, pb.auto, pb.stale.map(x => x.game.title)], [3, 1, 2, ['Ghost', 'Stale']], 'Playing: chosen (has a start date) vs set by an import; longest idle first')

// ── Play coverage ──
const cov = M.playCoverage(A.libraryGames(lib, 'all'))
ok([cov.total, cov.played + cov.unplayed], [6, 6], 'played + no recorded play = total')
ok(cov.rows.reduce((n, r) => n + r.count, 0), cov.total, 'platform rows add up to the total')
ok(cov.rows.reduce((n, r) => n + (r.part ?? 0), 0), cov.played, 'the filled parts add up to the played games')

// ── Community score, buckets, worth playing next ──
const plat = (over = {}) => ({ id: 'p' + (++seq), system: 'snes', is_primary_variant: false, rating: null, ...over })
const scored = [
  game({ title: 'A', platforms: [plat({ is_primary_variant: true, rating: 92 }), plat({ rating: 99 })], release_year: 1994 }),
  game({ title: 'B', platforms: [plat({ rating: 85 }), plat({ rating: 70 })], release_year: 1999 }),
  game({ title: 'C', platforms: [plat({ is_primary_variant: true, rating: 100 })], play_seconds: 600, last_played_at: '2026-01-01T10:00:00Z' }),
  game({ title: 'D', platforms: [plat({ is_primary_variant: true, rating: 95 })], play_status: 'dropped' }),
  game({ title: 'E', platforms: [plat({ is_primary_variant: true, rating: 40 })] }),
  game({ title: 'F', platforms: [plat({ is_primary_variant: true, rating: 180 })] }),
]
ok(scored.map(M.communityScore), [92, 85, 100, 95, 40, null], 'primary variant’s score, else the best other; out-of-range ignored')
const ss = M.scoreSeries(scored)
ok([ss.scored, ss.buckets.reduce((n, b) => n + b.count, 0), ss.buckets[9].count, ss.median], [5, 5, 3, 92], '100 lands in 90–100; buckets add up; median')
ok(M.topUnplayedByScore(scored).map(x => x.game.title), ['A', 'B'], 'worth playing next: unplayed, not dropped, score ≥ 80, best first')

// ── Libraries compared, platforms by metric ──
const lc = M.libraryComparison(actLib)
ok(lc.map(r => r.library), ['retro', 'steam', 'playstation'], 'one row per library in view')
ok(lc.reduce((n, r) => n + r.games, 0), actLib.length, 'library rows add up to the games')
ok(lc.find(r => r.library === 'steam').launches, null, 'Steam reports no launches: null, not 0')
ok(lc.find(r => r.library === 'retro').medianSeconds, 3600, 'median of the games with play time')
const byHours = M.platformRowsBy(actLib.map(g => ({ ...g, platformKey: g.library === 'retro' ? 'snes' : g.library })), 'hours', s2 => `${s2}s`)
ok(byHours.map(r => [r.key, r.count, r.valueLabel]), [['snes', 12640, '12640s'], ['steam', 7200, '7200s'], ['playstation', 600, '600s']], 'play time ranks by seconds, labelled as time')
const byShare = M.platformRowsBy(actLib.map(g => ({ ...g, platformKey: g.library === 'retro' ? 'snes' : g.library })), 'played', () => '')
ok(byShare.find(r => r.key === 'snes'), { key: 'snes', label: 'SNES', count: 4, part: 3, valueLabel: '75%', title: '3 of 4 played', target: 'snes' }, 'played share: two-tone bar of the platform’s games')
ok(M.platformRowsBy([game({ platformKey: 'snes' })], 'completed', () => '').length, 0, 'a platform with nothing for the metric drops out')

// ── Launches, decades, studios, play-time spread ──
const lz = [game({ title: 'L1', esde_playcount: 4, esde_playtime_seconds: 4 * 1800 }), game({ title: 'L2', esde_playcount: 9 }), game({ title: 'L3' })]
ok(lz.map(M.avgSessionSeconds), [1800, null, null], 'average session needs play time and launches')
ok(M.mostLaunched(lz).map(x => x.game.title), ['L2', 'L1'], 'most launched first')
const dec = M.decadeRows([game({ release_year: 1994 }), game({ release_year: 1998, play_seconds: 60 }), game({ release_year: 2004 }), game({})])
ok([dec.rows.map(r => [r.label, r.owned, r.played]), dec.undated], [[['1990s', 2, 1], ['2000s', 1, 0]], 1], 'decades oldest first with played; undated counted')
const st = M.studioRows([game({ developer: 'Nintendo' }), game({ developer: 'NINTENDO' }), game({ developer: 'Nintendo' }), game({ developer: 'Sega' }), game({})], 'developer')
ok([st.rows.map(r => [r.label, r.count, r.target]), st.studios, st.missing], [[['Nintendo', 3, 'Nintendo'], ['Sega', 1, 'Sega']], 2, 1], 'studios case-fold under their most common spelling')
const bk = M.playtimeBuckets([game({ play_seconds: 3599 }), game({ play_seconds: 3600 }), game({ play_seconds: 50 * 3600, library: 'steam' }), game({})])
ok(bk.map(b => b.count), [1, 1, 0, 0, 1], 'play-time buckets: 1h is in 1–5h, 50h in 50h+, no play time left out')
ok(bk[4].parts, { retro: 0, steam: 1, playstation: 0 }, 'buckets split by library')
const con = M.concentration([game({ play_seconds: 600 }), game({ play_seconds: 300 }), game({ play_seconds: 100 })], 2)
ok([con.topSeconds, con.totalSeconds, Math.round(con.share * 100)], [900, 1000, 90], 'top-N share of all play time')

// ── Players and series ──
ok(['1', '1-4', '2+', 'Up to 8', 'abc', null].map(M.maxPlayers), [1, 4, 2, 8, null, null], 'players field: the largest number')
const pr = M.playerRows([game({ players: '1' }), game({ players: '1-2' }), game({ players: '1-4' }), game({ players: '8' }), game({})])
ok([pr.rows.map(r => r.count), pr.unknown], [[1, 1, 1, 1], 1], 'solo / 2 / 3–4 / 5+ and unknown')
const sr = M.seriesRows([game({ series_name: 'Zelda' }), game({ series_name: 'zelda', play_status: 'completed' }), game({ series_name: 'Metroid' }), game({})])
ok([sr.rows.map(r => [r.label, r.games, r.completed]), sr.withSeries], [[['Zelda', 2, 1]], 3], 'series with 2+ games; one-offs counted in coverage only')
ok(M.funFacts(A.libraryGames(lib, 'all'), s2 => `${s2}s`).map(f => f.key).includes('platform'), true, 'fun facts name the most played platform')

// ── Data health ──
const H = require('../src/features/games/test-game/components/tgAnalyticsHealth.ts')
const hl = [
  game({ library: 'retro', description: 'x', primary_cover_url: 'https://a/c.png', platforms: [plat({ is_primary_variant: true, esde_assets: { a: { category: 'covers', sha256: 'x', size: 1000, mime: 'image/png', url: 'https://a/1.png' }, b: { category: 'screenshots', sha256: 'y', size: 500, mime: 'image/png', url: 'https://a/2.png' } } })] }),
  game({ library: 'retro' }),
  game({ library: 'steam', steamAppId: 10 }),
]
const hc = H.coverage(hl)
ok(hc.fields.find(f => f.key === 'description'), { key: 'description', label: 'Description', filled: 1, total: 2, fix: 'scrape-no-desc' }, 'retro-only fields count retro games')
ok(hc.fields.find(f => f.key === 'cover').total, 3, 'cover art counts every library')
ok(hc.fields.every((f, i, a) => i === 0 || f.filled / f.total >= a[i - 1].filled / a[i - 1].total), true, 'lowest coverage first')
ok([H.reviewReasonCounts(hl).games, H.reviewReasonCounts(hl).reasons.find(r => r.reason === 'No cover art').count], [2, 1], 'needs review: retro games only, a count per reason')
const inv = H.assetInventory(hl)
ok([inv.images, inv.bytes, inv.games, inv.categories.map(c => c.category)], [2, 1500, 1, ['covers', 'screenshots']], 'ES-DE originals tallied per category, biggest first')
const fr = H.freshness([game({ library: 'retro', synced_at: '2026-09-24T10:00:00Z' }), game({ library: 'steam', synced_at: '2026-09-01T10:00:00Z' }), game({ library: 'playstation' })], today)
ok(fr.map(f => [f.library, f.days, f.stale]), [['retro', 1, false], ['steam', 24, true], ['playstation', null, true]], 'freshness per library in calendar days; no stamp at all is stale')
{
  const late = today - 3_600_000 // 23:00 yesterday
  ok(H.calendarDaysSince(late, today), 1, 'a sync late last night was yesterday, not today')
  ok([H.calendarDaysSince(today + 5_000, today), H.calendarDaysSince(today - 8 * 86_400_000 + 3_600_000, today)], [0, 8], 'today is 0; eight calendar days ago is 8')
  const eight = new Date(today - 7 * 86_400_000 - 3_600_000).toISOString() // 23:00, 8 calendar days back
  ok(H.freshness([game({ library: 'retro', synced_at: eight })], today)[0].stale, true, 'stale by calendar days: 8 days ago is past a week')
  const scraped = new Date(today + 60_000).toISOString()
  const fr2 = H.freshness([
    game({ library: 'retro', synced_at: scraped, ss_scraped_at: scraped }),
    game({ library: 'retro', synced_at: '2026-09-20T10:00:00Z' }),
  ], today)
  ok(fr2[0].lastSync, '2026-09-20T10:00:00Z', 'a ScreenScraper save is not the handheld syncing')
}
ok(H.hiddenCounts([game({ hidden: true, play_status: 'hidden' }), game({ hidden: true, library: 'steam' }), game({})], 'all'), { total: 2, explicit: 1, auto: 1 }, 'hidden: chosen vs automatic')


// ── Hand-offs: each row opens exactly the games it counts (tgAnalyticsLists) ──
{
  const L = require('../src/features/games/test-game/components/tgAnalyticsLists.ts')
  const Mo = require('../src/features/games/test-game/components/tgAnalyticsMore.ts')
  const mixed = [
    game({ play_status: 'completed', platformKey: 'snes', genres: ['RPG'], developer: 'Square', publisher: 'Nintendo' }),
    game({ play_status: null, platformKey: 'snes', genres: ['rpg', 'Action'], developer: 'square' }),
    game({ play_status: 'playing', platformKey: 'gba', genres: ['Action'], publisher: 'Square' }),
    game({ play_status: 'backlog', platformKey: 'gba', genres: ['Puzzle'], developer: 'Nintendo', publisher: 'Nintendo' }),
    game({ play_status: 'completed', platformKey: 'gba', genres: [' Action '] }),
    game({ play_status: 'hidden', hidden: true, platformKey: 'gba', genres: ['Action'] }),
    game({ hidden: true, library: 'steam', notAGame: true, platformKey: 'steam' }),
  ]
  const scoped = A.libraryGames(mixed, 'all')
  for (const m of A.statusMix(scoped)) ok(L.gamesWithStatus(scoped, m.status).length, m.count, `status mix ${m.status}: list = row`)
  for (const metric of ['games', 'completed']) {
    for (const r of Mo.platformRowsBy(scoped, metric, x => String(x))) {
      const want = metric === 'games' ? r.count : r.part
      ok(L.gamesOfPlatform(scoped, r.target, metric === 'completed').length, want, `platforms by ${metric} ${r.key}: list = row`)
    }
  }
  for (const r of A.genreRows(scoped).rows.filter(r => r.target)) ok(L.gamesWithGenre(scoped, r.target).length, r.count, `genre ${r.label}: list = row`)
  for (const field of ['developer', 'publisher']) {
    for (const r of Mo.studioRows(scoped, field).rows.filter(r => r.target)) ok(L.gamesByStudio(scoped, field, r.target).length, r.count, `${field} ${r.label}: list = row`)
  }
  const H2 = require('../src/features/games/test-game/components/tgAnalyticsHealth.ts')
  for (const l of ['all', 'retro', 'steam']) ok(L.hiddenGames(mixed, l).length, H2.hiddenCounts(mixed, l).total, `hidden (${l}): list = count`)
  const cov = Mo.playCoverage(scoped)
  for (const r of cov.rows.filter(r => r.target)) ok(L.gamesOfPlatform(scoped, r.target).length, r.count, `coverage ${r.key}: list = row`)
}

// ── Idle and the queue are whole-library states, never windowed ──
{
  const Mo = require('../src/features/games/test-game/components/tgAnalyticsMore.ts')
  const idle = game({ play_status: 'playing', last_played_at: '2026-05-01T10:00:00Z', play_order: 1 })
  const active = game({ play_status: 'playing', last_played_at: '2026-09-20T10:00:00Z' })
  const whole = [idle, active]
  const start = A.windowStart('30d', today)
  const scoped = A.scopeByWindow(whole, start)
  ok(scoped.includes(idle), false, 'an idle game has no session in a 30-day window')
  const k = A.computeKpis(scoped, start, A.windowEnd(today), today, whole)
  ok([k.stalePlaying, k.queued, k.playing], [1, 1, 1], 'idle and queued count the whole library; Playing counts the window')
  ok(Mo.playingBreakdown(whole, today).stale.map(x => x.game.id), [idle.id], 'the idle card reads the whole library')
}


// ── Review round: formats, windowed recents, genre hours, unplaced completions ──
{
  const F = require('../src/features/games/test-game/components/tgAnalyticsFormat.ts')
  ok([F.fmtPct(249, 250), F.fmtPct(1, 250), F.fmtPct(250, 250), F.fmtPct(0, 250), F.fmtPct(99, 100), F.fmtPct(1, 3)], ['>99%', '<1%', '100%', '0%', '99%', '33%'], 'shares never round away their extremes')
  ok([F.kpiPlaytime(14 * 86400 + 17 * 3600 + 50 * 60), F.kpiPlaytime(5 * 3600 + 7 * 60), F.kpiPlaytime(212 * 86400 + 14 * 3600 + 31 * 60)], ['14d 18h', '5h 7m', '212d 15h'], 'KPI playtime: whole hours from a day up')
  const Mo = require('../src/features/games/test-game/components/tgAnalyticsMore.ts')
  const played = Mo.platformRowsBy([game({ platformKey: 'arcade', play_seconds: 3600, last_played_at: '2026-09-01T10:00:00Z' }), ...Array.from({ length: 249 }, () => game({ platformKey: 'arcade' }))], 'played', x => String(x))
  ok(played[0].valueLabel, '<1%', 'a platform with played games never reads 0%')

  const start = A.windowStart('30d', today)
  const oldSession = game({ title: 'Finished lately', play_status: 'completed', finished_at: '2026-09-10T10:00:00Z', last_played_at: '2025-08-21T10:00:00Z', play_seconds: 36000 })
  const fresh = game({ title: 'Fresh', last_played_at: '2026-09-20T10:00:00Z', play_seconds: 3600 })
  const scoped = A.scopeByWindow([oldSession, fresh], start)
  ok(scoped.length, 2, 'a finish date alone brings a game into the window')
  ok(A.recentlyPlayed(scoped, 8, start, A.windowEnd(today)).map(x => x.game.title), ['Fresh'], 'recently played in a window lists only sessions inside it')
  ok(A.recentlyPlayed(scoped).map(x => x.game.title), ['Fresh', 'Finished lately'], 'all time keeps every session')

  const facts = Mo.funFacts([game({ genres: ['Action', 'action'], play_seconds: 36000, last_played_at: '2026-09-01T10:00:00Z' }), game({ genres: ['RPG'], play_seconds: 54000, last_played_at: '2026-09-01T10:00:00Z' })], x => `${x / 3600}h`)
  ok(facts.find(f => f.key === 'genre')?.value, 'RPG · 15h', 'a game counts once per genre, however it is spelled')

  const S2 = require('../src/features/games/test-game/components/tgAnalyticsSeries.ts')
  const AC = require('../src/features/games/test-game/components/tgAnalyticsActivity.ts')
  const done = [
    game({ play_status: 'completed', finished_at: '2026-06-01T10:00:00Z' }),
    game({ play_status: 'completed' }),
    game({ play_status: 'completed', finished_at: '2020-01-01T10:00:00Z' }),
    game({ play_status: 'completed', finished_at: '2027-03-01T10:00:00Z' }),
  ]
  const act = S2.activitySeries(done, 'all', today)
  ok([act.completed, act.unplaced], [1, { undated: 1, earlier: 1, future: 1 }], 'all time: every Completed game is either plotted or accounted for')
  ok(act.completed + act.unplaced.undated + act.unplaced.earlier + act.unplaced.future, A.computeKpis(A.libraryGames(done, 'all'), null).completed, 'plotted + unplaced = the Completed tile')
  ok(AC.activityNote(act), 'Not shown: 1 completion with no finish date · 1 completion finished before it starts · 1 completion dated in the future.', 'the note names what is missing')
  ok(S2.activitySeries(done, '30d', today).unplaced, { undated: 0, earlier: 0, future: 0 }, 'a window has nothing unplaced (its tile counts the window)')
}

console.log(`verify-tg-analytics: ${n} assertions passed`)
