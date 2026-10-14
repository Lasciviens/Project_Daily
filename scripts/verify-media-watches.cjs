#!/usr/bin/env node
/*
 * Verification — every watch with its own date on screen, and rewatch rounds
 * (migration 149, docs/features/media.md), against the real watches.ts via
 * sucrase: the compact watch line, which watch a date change moves, the
 * rows read before 149, the round a rewatch starts, its next episode (the
 * first aired regular episode below the round) and its progress.
 */
require('sucrase/register')
process.env.TZ = 'Europe/Oslo'
const assert = require('node:assert/strict')
const {
  sortWatches, watchDate, watchDates, watchSummary, pickWatch, watchFor, cacheWatches,
  rewatchStartRound, nextInRound, roundProgress, airedRegularEpisodes, watchCounts,
} = require('../src/features/media/watches')

let n = 0
const ok = (actual, expected, msg) => { assert.deepStrictEqual(actual, expected, msg); n++ }

const w = (id, at) => ({ id, watched_at: at })
const got = [w('c', '2026-01-08T20:00:00.000Z'), w('a', '2018-10-12T20:00:00.000Z'), w('b', '2024-12-01T20:00:00.000Z')]

// ── The watch line ───────────────────────────────────────────────────────────
ok(sortWatches(got).map(x => x.id), ['a', 'b', 'c'], 'oldest first')
ok(sortWatches([w('k', '2020-01-01T12:00:00Z'), w('u', '1970-01-01T00:00:00Z'), w('m', null)]).map(x => x.id), ['m', 'u', 'k'], 'unknown dates (NULL, the epoch) first')
ok(watchSummary(got), '3 watches · 12.10.2018 · 01.12.2024 · 08.01.2026', 'three watches, each with its own date (DD.MM.YYYY)')
ok(watchSummary([got[0]]), 'Watched 08.01.2026', 'one watch')
ok(watchSummary([w('u', '1970-01-01T00:00:00.000Z')]), 'Watched · date unknown', 'an unknown date says so')
ok(watchSummary([]), '', 'no watch, no line')
const many = [...got, w('d', '2026-02-01T20:00:00.000Z'), w('e', '2026-03-01T20:00:00.000Z')]
ok(watchDates(many), '12.10.2018 · … · 01.02.2026 · 01.03.2026', 'more than three: the first and the two latest')
ok(watchDate(w('x', null)), 'date unknown', 'a movie watched on an unknown date')

// ── Which watch a date change moves ──────────────────────────────────────────
ok(pickWatch(got).id, 'c', 'the latest by default')
ok(pickWatch(got, 'first').id, 'a', 'or the first')
ok(pickWatch([]), null, 'none without watches')
ok(watchFor(got, { id: 'b' }).id, 'b', 'or the one the user picked')
ok(watchFor(got, { id: 'gone' }).id, 'c', 'a picked watch that is gone falls back to the latest')
ok(watchFor(got, 'first').id, 'a', 'first of each')

// ── Rows read before migration 149 ───────────────────────────────────────────
ok(cacheWatches({ id: 'r', watched_at: '2026-01-08T20:00:00.000Z', repeat_count: 2 }).map(x => x.watched_at),
  ['2026-01-08T20:00:00.000Z', '2026-01-08T20:00:00.000Z', '2026-01-08T20:00:00.000Z'], 'plays at the one kept date, shown only')
ok(cacheWatches({ id: 'r', watched_at: null, repeat_count: null }), [], 'nothing watched, nothing shown')

// ── Rewatch rounds ───────────────────────────────────────────────────────────
ok(rewatchStartRound([1, 1, 1]), 2, 'all watched once → round 2')
ok(rewatchStartRound([2, 3, 2]), 3, 'all at least twice → round 3')
ok(rewatchStartRound([]), 2, 'nothing counted → round 2')
const aired = airedRegularEpisodes({
  seasons: [{ season_number: 0, episode_count: 3 }, { season_number: 2, episode_count: 3 }, { season_number: 1, episode_count: 2 }, { season_number: 3, episode_count: 10 }],
  last_episode_to_air: { season_number: 2, episode_number: 2 },
})
ok(aired.map(e => `${e.season}x${e.episode}`), ['1x1', '1x2', '2x1', '2x2'], 'aired regular episodes in order (no specials, nothing after the last aired)')
ok(airedRegularEpisodes({ seasons: [{ season_number: 1, episode_count: 2 }] }).length, 2, 'without a last aired episode: every listed one')
const counts = new Map([['1x1', 1], ['1x2', 1], ['2x1', 1], ['2x2', 1], ['0x1', 1]])
ok(nextInRound(aired, counts, 2), { season: 1, episode: 1 }, 'rewatch started → next is S01E01')
counts.set('1x1', 2)
ok(nextInRound(aired, counts, 2), { season: 1, episode: 2 }, 'after S01E01\'s second watch → S01E02')
ok(roundProgress(aired, counts, 2), { done: 1, total: 4 }, 'progress counts the episodes at the round')
for (const k of ['1x2', '2x1', '2x2']) counts.set(k, 2)
ok(nextInRound(aired, counts, 2), null, 'every aired episode at the round → finished')
ok(nextInRound([...aired, { season: 2, episode: 3 }], counts, 2), { season: 2, episode: 3 }, 'a newly aired episode (never watched) is next in the round')
ok(nextInRound(aired, new Map([['1x1', 3], ['1x2', 1]]), 2), { season: 1, episode: 2 }, 'extra watches of one episode don\'t carry over to the next')

// ── Watches per episode ──────────────────────────────────────────────────────
ok([...watchCounts([
  { season_number: 1, episode_number: 1, watched_at: '2026-01-01T12:00:00Z', watches: [w('a', null), w('b', null)] },
  { season_number: 1, episode_number: 2, watched_at: '2026-01-01T12:00:00Z', repeat_count: 2 },
  { season_number: 1, episode_number: 3, watched_at: null, repeat_count: 5 },
])], [['1x1', 2], ['1x2', 3]], 'counted from the watch list, else plays (repeat_count + 1); not watched rows skip')

console.log(`verify-media-watches: ${n} assertions passed`)
