// Throwaway verification for the Analytics Play tab's pure helpers
// (src/features/games/test-game/components/tgAnalyticsTrophies.ts and
// tgAnalyticsPlay.ts). No unit test framework here (CLAUDE.md).
//   node scripts/verify-tg-analytics-play.cjs
require('sucrase/register')
const assert = require('assert')
const T = require('../src/features/games/test-game/components/tgAnalyticsTrophies.ts')
const P = require('../src/features/games/test-game/components/tgAnalyticsPlay.ts')
const M = require('../src/features/games/test-game/components/tgAnalyticsMore.ts')
const { formatPlaytime } = require('../src/features/games/api/playtimeFormat.ts')

let n = 0
const ok = (a, b, what) => { assert.deepStrictEqual(a, b, what); n++ }
const fmt = s => formatPlaytime(s / 60)

// ── trophyStats ──────────────────────────────────────────────────────────────
const set = (name, progress, earned, defined, platform = 'PS5') => ({
  npCommunicationId: 'NPWR-' + name, trophyTitleName: name, trophyTitleIconUrl: '', trophyTitlePlatform: platform,
  hasTrophyGroups: false, progress, lastUpdatedDateTime: '2026-09-01T00:00:00Z',
  earnedTrophies: { bronze: 0, silver: 0, gold: 0, platinum: 0, ...earned },
  definedTrophies: { bronze: 0, silver: 0, gold: 0, platinum: 0, ...defined },
})

const titles = [
  set('Astro', 100, { bronze: 30, silver: 10, gold: 4, platinum: 1 }, { bronze: 30, silver: 10, gold: 4, platinum: 1 }),
  set('Horizon', 82, { bronze: 40, silver: 8, gold: 2 }, { bronze: 50, silver: 12, gold: 5, platinum: 1 }),
  set('Bloodborne', 45, { bronze: 12, silver: 2 }, { bronze: 30, silver: 8, gold: 3, platinum: 1 }, 'PS4'),
  set('Indie', 60, { bronze: 6 }, { bronze: 10 }, 'PS4,PSVITA'),
  set('Ghost', 82, { bronze: 20 }, { bronze: 40, silver: 5, gold: 2, platinum: 1 }),
  set('Fresh', 0, {}, { bronze: 20, platinum: 1 }),
]
const s = T.trophyStats(titles)
ok(s.titles, 6, 'every trophy set is counted')
ok(s.platinums, 1, 'platinums = earned platinum trophies')
ok(s.earned, { platinum: 1, gold: 6, silver: 20, bronze: 108 }, 'earned sums per grade')
ok(s.defined, { platinum: 5, gold: 14, silver: 35, bronze: 180 }, 'defined sums per grade')
ok(s.averageProgress, (100 + 82 + 45 + 60 + 82 + 0) / 6, 'average completion is the plain mean')
ok(s.nearest.map(t => t.trophyTitleName), ['Ghost', 'Horizon', 'Bloodborne'], 'closest: platinum defined, not earned, highest progress first (ties by name), top 3')
ok(s.nearest.some(t => t.trophyTitleName === 'Astro'), false, 'an earned platinum is never "closest"')
ok(s.nearest.some(t => t.trophyTitleName === 'Indie'), false, 'a set without a platinum is never "closest"')
ok(T.trophyStats(titles, 10).nearest.map(t => t.trophyTitleName), ['Ghost', 'Horizon', 'Bloodborne', 'Fresh'], 'a not-started set with a platinum still qualifies, last')

const empty = T.trophyStats([])
ok([empty.titles, empty.platinums, empty.averageProgress, empty.nearest.length], [0, 0, null, 0], 'no sets: zeros and no average')

// Reverse-engineered payloads: missing objects, strings and junk never make NaN.
const odd = T.trophyStats([
  { npCommunicationId: 'x', trophyTitleName: 'Odd', trophyTitlePlatform: 'PS5', progress: '50', definedTrophies: { bronze: '4', platinum: 1 } },
  { npCommunicationId: 'y', trophyTitleName: 'Broken', progress: null, earnedTrophies: null, definedTrophies: undefined },
  null,
])
ok(odd.titles, 2, 'null entries are dropped')
ok(odd.defined, { platinum: 1, gold: 0, silver: 0, bronze: 4 }, 'numeric strings count, missing objects are zero')
ok(odd.earned, { platinum: 0, gold: 0, silver: 0, bronze: 0 }, 'missing earned counts are zero')
ok(odd.averageProgress, 50, 'a set with no progress stays out of the average')
ok(odd.nearest.map(t => t.trophyTitleName), ['Odd'], 'string progress still ranks')
ok(T.trophyStats([set('Over', 120, {}, { platinum: 1 })]).nearest.length, 0, 'progress above 100 is clamped to 100 — not "closest"')
ok(T.titlePlatform(titles[3]), 'PS4 · PS Vita', 'platform list reads cleanly')

// ── Play tab wording ─────────────────────────────────────────────────────────
const H = 3600
ok(P.concentrationSentence({ top: [], topSeconds: 0, totalSeconds: 0, share: 0 }, fmt), null, 'nothing played: no sentence')
ok(P.concentrationSentence({ top: [1], topSeconds: 12 * H, totalSeconds: 12 * H, share: 1 }, fmt), 'One game holds all of your play time (12h)', 'one game')
ok(P.concentrationSentence({ top: [1, 2, 3], topSeconds: 30 * H, totalSeconds: 30 * H, share: 1 }, fmt), 'Only 3 games have play time — 1d 6h in all', 'fewer games than the top n')
ok(P.concentrationSentence({ top: [1, 2, 3, 4, 5], topSeconds: 120 * H, totalSeconds: 194 * H, share: 120 / 194 }, fmt),
  'Your top 5 games hold 62% of all play time (5d of 8d 2h)', 'the headline sentence')
ok(P.concentrationSentence({ top: [1, 2, 3, 4, 5], topSeconds: 999, totalSeconds: 1000, share: 0.999 }, fmt).includes('>99%'), true, 'never rounds up to 100% while others hold time')

const game = over => ({
  id: 'g', title: 'G', library: 'retro', platformKey: 'snes', platforms: [], hidden: false, genres: null,
  play_seconds: null, play_count: null, last_played_at: null, esde_playcount: null, esde_last_played: null, esde_playtime_seconds: null, ...over,
})
const g = game({ play_seconds: 14 * 38 * 60, play_count: 14 })
ok(P.playedSubline(g, '2026-09-15T10:00:00Z', fmt, 'time'), 'SNES · 14 launches · ~38m a session · last played 15 Sep 2026', 'time mode sub-line')
ok(P.playedSubline(g, null, fmt, 'launches'), 'SNES · 8h 52m played · ~38m a session', 'launches mode names play time instead of repeating launches')
ok(P.playedSubline(game({ play_seconds: 7200 }), null, fmt, 'time'), 'SNES', 'no launches: no count and no per-session average')

// Buckets and libraries come straight from tgAnalyticsMore.
const lib = [
  game({ id: 'a', library: 'retro', play_seconds: 1800 }),
  game({ id: 'b', library: 'steam', play_seconds: 3 * H }),
  game({ id: 'c', library: 'steam', play_seconds: 30 * H }),
]
const buckets = M.playtimeBuckets(lib)
ok(P.libsPresent(buckets), ['retro', 'steam'], 'legend lists only libraries with play time, fixed order')
ok(P.bucketText(buckets[0], P.libsPresent(buckets)), '1 game: 1 Retro', 'bucket text names the split')
const rows = M.libraryComparison([...lib, game({ id: 'd', library: 'steam' })])
const steamCells = P.libraryCells(rows.find(r => r.library === 'steam'), fmt)
ok(steamCells.find(c => c.key === 'launches').title, 'Steam doesn’t report launches', 'Steam launches explained, not zeroed')
ok(steamCells.find(c => c.key === 'played').value, '2 · 67%', 'played count with its share')
ok(steamCells.find(c => c.key === 'last').value, '—', 'no session date reads as a dash')

console.log(`verify-tg-analytics-play: ${n} assertions passed`)
