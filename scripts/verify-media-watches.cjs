#!/usr/bin/env node
/*
 * Verification — every watch with its own date on screen, and rewatch rounds
 * (migration 149, docs/features/media.md), against the real watches.ts via
 * sucrase: what a row shows of its watches (the date, the ×N counter, done in
 * a round), which watch a date change moves, the rows read before 149, the
 * round a rewatch starts, its next episode (the first aired regular episode
 * below the round) and its progress, a show's rewatch totals, and the watches
 * in a date range.
 */
require('sucrase/register')
process.env.TZ = 'Europe/Oslo'
const assert = require('node:assert/strict')
const {
  sortWatches, watchDate, watchDates, watchedOnce, watchMark, pickWatch, watchFor, cacheWatches,
  isPlaceholder, editableWatches, inRound, watchedInRound, doneInRound,
  rewatchStartRound, nextInRound, roundProgress, airedRegularEpisodes, watchCounts, rewatchTotals,
} = require('../src/features/media/watches')

let n = 0
const ok = (actual, expected, msg) => { assert.deepStrictEqual(actual, expected, msg); n++ }

const w = (id, at) => ({ id, watched_at: at })
const got = [w('c', '2026-01-08T20:00:00.000Z'), w('a', '2018-10-12T20:00:00.000Z'), w('b', '2024-12-01T20:00:00.000Z')]

// ── The dates on screen ──────────────────────────────────────────────────────
ok(sortWatches(got).map(x => x.id), ['a', 'b', 'c'], 'oldest first')
ok(sortWatches([w('k', '2020-01-01T12:00:00Z'), w('u', '1970-01-01T00:00:00Z'), w('m', null)]).map(x => x.id), ['m', 'u', 'k'], 'unknown dates (NULL, the epoch) first')
ok(watchDates(got), '12.10.2018 · 01.12.2024 · 08.01.2026', 'a movie\'s three watches, each with its own date (DD.MM.YYYY), oldest first')
ok(watchedOnce(got[0]), 'Watched 08.01.2026', 'one watch')
ok(watchedOnce(w('u', '1970-01-01T00:00:00.000Z')), 'Watched · date unknown', 'an unknown date says so')
const many = [...got, w('d', '2026-02-01T20:00:00.000Z'), w('e', '2026-03-01T20:00:00.000Z')]
ok(watchDates(many), '12.10.2018 · … · 01.02.2026 · 01.03.2026', 'more than three: the first and the two latest')
ok(watchDate(w('x', null)), 'date unknown', 'a movie watched on an unknown date')

// ── What a row shows: its date, the ×N counter, done (owner, 26.10.2026) ─────
// No round: watched = done; one watch says its date (green); 2+ show ×N instead.
ok(watchMark([]), { done: false, counter: null, line: '', lineDone: false }, 'not watched: nothing')
ok(watchMark([got[0]]), { done: true, counter: null, line: 'Watched 08.01.2026', lineDone: true }, 'one watch: done, its date, no counter (the History icon)')
ok(watchMark([w('u', '1970-01-01T00:00:00.000Z')]).line, 'Watched · date unknown', 'one watch on an unknown date says so')
ok(watchMark(got), { done: true, counter: 3, line: '', lineDone: false }, '3 watches: ×3 in place of the line')
ok(watchMark(got, null), watchMark(got), 'no round given = no round')
ok(watchMark(many).counter, 5, 'the counter is every watch ever — as many as the list it opens')
{
  // A round counts the watches since it started (rewatch_started_at) — the database's rule.
  const START = '2026-10-01T10:00:00.000Z'
  const old = (id, at) => ({ id, watched_at: at, source: 'trakt', created_at: at })
  const twoOld = [old('o1', '2018-10-12T20:00:00.000Z'), old('o2', '2024-12-01T20:00:00.000Z')]
  ok(watchMark(twoOld, START), { done: false, counter: 2, line: '', lineDone: false },
    'round, no watch since the start: looks unwatched (no ✓) and keeps ×2')
  ok(watchMark([twoOld[0]], START), { done: false, counter: null, line: 'Watched 12.10.2018', lineDone: false },
    'round, one old watch: not done, its date never green')
  ok(watchMark([...twoOld, old('n1', '2026-10-03T20:00:00.000Z')], START), { done: true, counter: 3, line: '', lineDone: false },
    'round, rewatched since the start: done (its ✓) and ×3')
  ok(watchMark([old('n1', '2026-10-03T20:00:00.000Z')], START), { done: true, counter: null, line: 'Watched 03.10.2026', lineDone: false },
    'round, first watched in it (aired mid-round): done, its date not green')
  const appLate = { id: 'a1', watched_at: '2019-05-01T12:00:00.000Z', source: 'app', created_at: '2026-10-05T09:00:00.000Z' }
  ok(watchMark([...twoOld, appLate], START).done, true, 'an app watch added after the start with an old date counts as rewatched')
  ok(watchMark([...twoOld, { ...appLate, source: 'trakt' }], START).done, false, 'an old Trakt play that only came in since then does not')
  ok(watchMark([...twoOld, { ...appLate, source: 'backfill' }], START).done, false, 'nor does a placeholder')
  ok(watchMark([...twoOld, { ...appLate, watched_at: '1970-01-01T00:00:00.000Z' }], START).done, true, 'an app rewatch on an unknown date counts too')
  ok(watchedInRound(twoOld, START), false, 'watchedInRound: no watch of the round')
  ok(watchedInRound([...twoOld, appLate], START), true, 'watchedInRound: the app watch of the round')
  // doneInRound (season tabs, next episode) and the row agree on every case above.
  const rows = [twoOld, [...twoOld, old('n1', '2026-10-03T20:00:00.000Z')], [...twoOld, appLate]]
    .map((ws, i) => ({ season_number: 1, episode_number: i + 1, watches: ws }))
  ok([...doneInRound(rows, START)], rows.filter(r => watchMark(r.watches, START).done).map(r => `1x${r.episode_number}`),
    'the season counts and the rows use one rule')
}

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
// A round counts the watches since it started (rewatch_started_at).
const START = '2026-10-01T10:00:00.000Z'
const before = (id, at) => ({ id, watched_at: at, source: 'trakt', created_at: at })
const row = (s_, e, watches) => ({ season_number: s_, episode_number: e, watched_at: watches.length ? watches[watches.length - 1].watched_at : null, watches })
ok(inRound(before('a', '2026-10-02T20:00:00.000Z'), START), true, 'a watch dated since the start is in the round')
ok(inRound({ id: 'b', watched_at: '2018-01-01T12:00:00.000Z', source: 'app', created_at: '2026-10-05T09:00:00.000Z' }, START), true,
  'a rewatch logged in the app since the start, with an older date, counts too')
ok(inRound({ id: 'c', watched_at: '2018-01-01T12:00:00.000Z', source: 'trakt', created_at: '2026-10-05T09:00:00.000Z' }, START), false,
  'an old play that only came in from Trakt since then does not')
ok(inRound({ id: 'd', watched_at: '2026-10-01T10:00:00.000Z', source: 'trakt' }, '2026-10-01T10:00:00.400Z'), true, 'the same second as the start counts (seconds, like the database)')
// Re-review 1: the sync links an app watch without making it 'trakt' (traktWatchPlan's link), so it keeps counting.
ok(inRound({ id: 'e', watched_at: '1970-01-01T00:00:00.000Z', trakt_history_id: 9001, source: 'app', created_at: '2026-10-05T09:00:00.000Z' }, START), true,
  'a round watch on an unknown date, linked to its Trakt play since, still counts')
const pilotThrice = row(1, 1, [before('p1', '2019-01-01T12:00:00Z'), before('p2', '2020-01-01T12:00:00Z'), before('p3', '2021-01-01T12:00:00Z')])
let done = doneInRound([pilotThrice, row(1, 2, [before('e2', '2020-02-01T12:00:00Z')])], START)
ok([...done], [], 'a pilot watched three times before the round is not done in it')
ok(nextInRound(aired, done), { season: 1, episode: 1 }, 'rewatch started → next is S01E01')
done = doneInRound([row(1, 1, [...pilotThrice.watches, before('p4', '2026-10-03T20:00:00Z')]), row(1, 2, [before('e2', '2020-02-01T12:00:00Z')])], START)
ok(nextInRound(aired, done), { season: 1, episode: 2 }, 'after S01E01 is watched in the round → S01E02')
ok(roundProgress(aired, done), { done: 1, total: 4 }, 'progress counts the episodes done in the round')
ok(nextInRound(aired, new Set(['1x1', '1x2', '2x1', '2x2'])), null, 'every aired episode done → the round is finished')
ok(nextInRound([...aired, { season: 2, episode: 3 }], new Set(['1x1', '1x2', '2x1', '2x2'])), { season: 2, episode: 3 },
  'an episode aired mid-round (never watched) is part of the round once aired')
ok(nextInRound(aired, new Set(['1x2'])), { season: 1, episode: 1 }, 'an episode never watched before counts the same way as one watched')

// ── Placeholders wait for Trakt's dates ──────────────────────────────────────
{
  const ph = { id: 'b', watched_at: '2026-01-08T20:00:00.000Z', source: 'backfill', trakt_history_id: null }
  const linked = { id: 'l', watched_at: '2018-10-12T20:00:00.000Z', source: 'trakt', trakt_history_id: 5 }
  const mine = { id: 'a', watched_at: '2026-02-02T20:00:00.000Z', source: 'app', trakt_history_id: null }
  ok(isPlaceholder(ph, true), true, 'a backfilled watch not linked yet waits for Trakt\'s dates')
  ok(isPlaceholder(ph, false), false, 'without Trakt it is just its date')
  ok(isPlaceholder({ ...ph, trakt_history_id: 9 }, true), false, 'linked, it is a real play')
  ok(editableWatches([ph, linked, mine], true).map(w => w.id), ['l', 'a'], 'Change date and remove pick only from the others')
  ok(watchFor(editableWatches([ph, linked], true), 'latest').id, 'l', 'the latest editable watch, never a placeholder')
}

// ── Watches per episode ──────────────────────────────────────────────────────
ok([...watchCounts([
  { season_number: 1, episode_number: 1, watched_at: '2026-01-01T12:00:00Z', watches: [w('a', null), w('b', null)] },
  { season_number: 1, episode_number: 2, watched_at: '2026-01-01T12:00:00Z', repeat_count: 2 },
  { season_number: 1, episode_number: 3, watched_at: null, repeat_count: 5 },
])], [['1x1', 2], ['1x2', 3]], 'counted from the watch list, else plays (repeat_count + 1); not watched rows skip')

// A show's pill: "2 episodes rewatched · 3 extra watches", from the same counts.
ok(rewatchTotals([
  { season_number: 1, episode_number: 1, watched_at: '2026-01-01T12:00:00Z', repeat_count: 0, watches: [w('a', null), w('b', null), w('c', null)] },
  { season_number: 1, episode_number: 2, watched_at: '2026-01-01T12:00:00Z', repeat_count: 0, watches: [w('d', null)] },
  { season_number: 1, episode_number: 3, watched_at: '2026-01-01T12:00:00Z', repeat_count: 1 },
  { season_number: 1, episode_number: 4, watched_at: null, repeat_count: 5 },
]), { episodes: 2, extraWatches: 3 }, 'rewatched episodes and watches past the first: the watch list wins over a stale repeat_count')
ok(rewatchTotals([]), { episodes: 0, extraWatches: 0 }, 'nothing rewatched')

// ── Watches in a range: "this week: N episodes · M films" ────────────────────
{
  // Oslo is UTC+1 from 25.10.2026: Monday 26.10 starts at 25.10 23:00 UTC, Monday 02.11 at 01.11 23:00 UTC.
  const kw = (kind, at) => ({ kind, watched_at: at })
  const week = [
    kw('episode', '2026-10-25T22:59:59.000Z'), // Sunday 23:59:59 — the week before
    kw('episode', '2026-10-25T23:00:00.000Z'), // Monday 00:00 — in
    kw('episode', '2026-10-27T20:00:00.000Z'),
    kw('movie', '2026-10-28T19:00:00.000Z'),
    kw('episode', '2026-11-01T22:59:59.000Z'), // Sunday 23:59:59 — in
    kw('movie', '2026-11-01T23:00:00.000Z'),   // next Monday 00:00 — out
    kw('movie', null),                          // a film on an unknown date
    kw('episode', '1970-01-01T00:00:00.000Z'),  // an episode on an unknown date
  ]
}

console.log(`verify-media-watches: ${n} assertions passed`)
