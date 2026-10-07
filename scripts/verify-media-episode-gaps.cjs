#!/usr/bin/env node
/** verify-media-episode-gaps.cjs — paused playbacks + skipped episodes (src/features/media/episodeGaps.ts). */
require('sucrase/register')
const G = require('../src/features/media/episodeGaps.ts')
let n = 0
const ok = (a, e, label) => { const x = JSON.stringify(a), y = JSON.stringify(e); if (x !== y) { console.error(`FAIL ${label}\n  expected ${y}\n  actual   ${x}`); process.exit(1) } n++ }

// Ted Lasso S1, as the owner's live data: E1, E3, E6 watched; E2 paused 39.5 %, E4 6.4 %.
const pb = [
  { id: 1, type: 'episode', tmdb: 97546, season: 1, episode: 2, progress: 39.5 },
  { id: 2, type: 'episode', tmdb: 97546, season: 1, episode: 4, progress: 6.4 },
  { id: 3, type: 'episode', tmdb: 97546, season: 2, episode: 1, progress: 50 },
  { id: 4, type: 'episode', tmdb: 1, season: 1, episode: 5, progress: 80 },
  { id: 5, type: 'movie', tmdb: 97546, season: null, episode: null, progress: 10 },
]
ok([...G.pausedEpisodes(pb, 97546, 1)], [[2, 40], [4, 6]], 'only this show and season; percent rounded')
ok(G.pausedEpisodes(undefined, 97546, 1).size, 0, 'Trakt not connected: nothing paused')
ok([...G.pausedEpisodes([...pb, { id: 9, type: 'episode', tmdb: 97546, season: 1, episode: 2, progress: 70 }], 97546, 1)].find(([e]) => e === 2)[1], 70, 'two playbacks of one episode: the furthest')
const eps = [1, 2, 3, 4, 5, 6, 7, 8].map(e => ({ episode_number: e, air_date: e <= 7 ? '2020-08-14' : '2099-01-01' }))
ok(G.seasonGaps(eps, new Set([1, 3, 6]), '2026-10-07'), [2, 4, 5], 'unwatched before the last watched one')
ok(G.seasonGaps(eps, new Set([1, 2, 3]), '2026-10-07'), [], 'watched in order: no gap')
ok(G.seasonGaps(eps, new Set(), '2026-10-07'), [], 'nothing watched: no gap')
ok(G.seasonGaps([{ episode_number: 1, air_date: null }, { episode_number: 2, air_date: '2020-01-01' }], new Set([2]), '2026-10-07'), [], 'an episode with no air date is left out')
console.log(`verify-media-episode-gaps: ${n} assertions passed`)
