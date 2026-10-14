#!/usr/bin/env node
/*
 * Verification — every watch keeps its own date (migration 149,
 * docs/features/media.md), against the real traktWatchPlan.ts via sucrase:
 * Trakt's per-play history is read and matched play by play onto the watches
 * here (linked plays kept, same-time matches, placeholders replaced in date
 * order, extras added/removed), pending and unsummarised items are left
 * alone, the titles to read are the ones that differ, a removed watch
 * removes exactly one play, and an add + remove still waiting cancel out.
 */
require('sucrase/register')
const assert = require('node:assert/strict')
const {
  parseHistory, playsByKey, matchItem, buildWatchPlan, historyTargets, summaryKeys, playToRemove,
  cancelledOutboxRows, storedWatchedAt, sameSecond, watchKey, HISTORY_TARGET_MAX,
  localPlays, summaryTitles, titlesAfter, titleItemKeys, watchRemovalsNeedConfirm,
} = require('../src/features/media/trakt/traktWatchPlan')

let n = 0
const ok = (actual, expected, msg) => { assert.deepStrictEqual(actual, expected, msg); n++ }

const EPOCH = '1970-01-01T00:00:00.000Z'
const D = d => `${d}T20:00:00.000Z`
const w = (id, at, historyId = null, source = 'app') => ({ id, watchedAt: at, historyId, source })
const play = (historyId, at) => ({ historyId, watchedAt: at })

// ── Reading GET /sync/history ────────────────────────────────────────────────
{
  const rows = [
    { id: 1982346, watched_at: '2014-03-31T09:28:53.000Z', action: 'scrobble', type: 'movie', movie: { title: 'The Dark Knight', ids: { trakt: 4, tmdb: 155 } } },
    { id: 1982347, watched_at: '2014-02-27T09:28:53.000Z', action: 'checkin', type: 'episode', episode: { season: 2, number: 1, ids: { trakt: 251 } }, show: { ids: { trakt: 4, tmdb: 8592 } } },
    { id: 7, watched_at: '2014-02-27T09:28:53.000Z', type: 'episode', episode: { season: 2, number: 1 }, show: { ids: { trakt: 4 } } },
    { id: 'x', watched_at: '2014-02-27T09:28:53.000Z', type: 'movie', movie: { ids: { tmdb: 1 } } },
    { id: 8, watched_at: 'yesterday', type: 'movie', movie: { ids: { tmdb: 1 } } },
    null,
    { id: 9, watched_at: EPOCH, type: 'movie', movie: { ids: { tmdb: 2 } } },
  ]
  const { plays, unreadable } = parseHistory(rows)
  ok(plays.map(p => p.key), ['movie:155', 'ep:8592:2:1', 'movie:2'], 'the blueprint example rows are read; keys match the outbox keys')
  ok(plays[1], { key: 'ep:8592:2:1', kind: 'episode', tmdbId: 8592, season: 2, episode: 1, historyId: 1982347, watchedAt: '2014-02-27T09:28:53.000Z' }, 'an episode play keeps its id and date')
  ok(unreadable, 4, 'a play without a TMDB id, id or date is counted, never guessed')
  ok(parseHistory({ error: 'x' }), { plays: [], unreadable: 0 }, 'a non-list answer reads as nothing')
  ok(playsByKey([...plays, plays[0]]).get('movie:155').length, 1, 'the same play twice (two pages) counts once')
}

// ── Dates ────────────────────────────────────────────────────────────────────
ok(storedWatchedAt('movie', EPOCH), null, 'a movie play on an unknown date is stored as NULL')
ok(storedWatchedAt('episode', '1970-01-01T00:00:00Z'), EPOCH, 'an episode play on an unknown date stays the epoch')
ok(storedWatchedAt('episode', '2018-10-12T20:00:00.456Z'), '2018-10-12T20:00:00.000Z', 'dates are kept to the second (Trakt\'s precision)')
ok(sameSecond(null, EPOCH), true, 'every unknown date is the same')
ok(sameSecond('2026-01-01T12:00:00.900Z', '2026-01-01T12:00:00.000Z'), true, 'the same second is the same time')

// ── One item: the GoT repair (three placeholders → the three real plays) ────
{
  const local = [w('a', D('2026-01-08'), null, 'backfill'), w('b', D('2026-01-08'), null, 'backfill'), w('c', D('2026-01-08'), null, 'backfill')]
  const plays = [play(11, D('2018-10-12')), play(12, D('2025-01-15')), play(13, D('2026-01-08'))]
  const m = matchItem('episode', local, plays)
  ok(m.inserts, [], 'three placeholders, three plays: nothing to add')
  ok(m.removes, [], 'nothing to remove')
  ok(m.updates.map(u => [u.historyId, u.watchedAt]).sort((x, y) => x[0] - y[0]),
    [[11, D('2018-10-12')], [12, D('2025-01-15')], [13, D('2026-01-08')]], 'every placeholder takes one real play, with its own date')
  ok(m.updates.find(u => u.historyId === 13).id, 'a', 'the one at the same time is matched first')
}
// ── Linked watches stay; a play gone on Trakt goes here; a new one comes in ──
{
  const local = [w('a', D('2018-10-12'), 11, 'trakt'), w('b', D('2024-12-01'), 12, 'trakt'), w('c', D('2026-01-08'), 13, 'trakt')]
  const same = matchItem('episode', local, [play(11, D('2018-10-12')), play(12, D('2024-12-01')), play(13, D('2026-01-08'))])
  ok(same, { updates: [], inserts: [], removes: [] }, 'an item that already matches plans nothing')
  const changed = matchItem('episode', local, [play(11, D('2018-10-12')), play(13, D('2026-01-08')), play(14, D('2026-02-02'))])
  ok(changed.updates, [{ id: 'b', watchedAt: D('2026-02-02'), historyId: 14 }], 'a play removed and another added on Trakt: the freed watch takes the new play')
  const fewer = matchItem('episode', local, [play(11, D('2018-10-12'))])
  ok(fewer.removes.sort(), ['b', 'c'], 'plays removed on Trakt are removed here')
  const more = matchItem('episode', local.slice(0, 1), [play(11, D('2018-10-12')), play(15, D('2026-03-03'))])
  ok(more.inserts, [{ watchedAt: D('2026-03-03'), historyId: 15 }], 'a play added on Trakt is added here at its own date')
}
// ── A watch added here (no id yet) is linked by its time ─────────────────────
{
  const local = [w('a', D('2018-10-12'), 11, 'trakt'), w('n', '2026-04-04T12:00:00.000Z')]
  const m = matchItem('episode', local, [play(11, D('2018-10-12')), play(16, '2026-04-04T12:00:00.000Z')])
  ok(m.updates, [{ id: 'n', watchedAt: '2026-04-04T12:00:00.000Z', historyId: 16 }], 'the new watch is linked to its play (same second), its date untouched')
}
// ── Movies: unknown dates ────────────────────────────────────────────────────
{
  const m = matchItem('movie', [w('a', null, null, 'backfill'), w('b', null, null, 'backfill')], [play(21, EPOCH), play(22, '1970-01-01T00:00:01.000Z')])
  ok(m.updates.map(u => u.watchedAt), [null, null], 'a movie\'s unknown plays stay unknown (NULL)')
  ok(m.updates.map(u => u.historyId).sort(), [21, 22], 'and each is linked to one play')
}

// ── The plan over every item ─────────────────────────────────────────────────
{
  const local = new Map([
    ['ep:1399:1:1', [w('a', D('2026-01-08'), null, 'backfill')]],
    ['ep:1399:1:2', [w('b', D('2026-01-09'), 5, 'trakt')]],
    ['movie:7', [w('m', D('2020-01-01'), null, 'backfill')]],
  ])
  const plays = new Map([
    ['ep:1399:1:1', [play(1, D('2018-10-12'))]],
    ['ep:1399:1:2', [play(6, D('2026-01-10'))]],
    ['ep:1399:1:3', [play(7, D('2026-01-11'))]],
    ['movie:7', []],
  ])
  const all = new Set(['ep:1399:1:1', 'ep:1399:1:2', 'ep:1399:1:3', 'movie:7'])
  const p = buildWatchPlan({ watched: all, local, plays, read: all, pending: new Set(['ep:1399:1:2']) })
  ok(p.updates, [{ id: 'a', watchedAt: D('2018-10-12'), historyId: 1 }], 'a placeholder becomes the real play')
  ok(p.inserts, [{ key: 'ep:1399:1:3', watchedAt: D('2026-01-11'), historyId: 7 }], 'an episode with no watch here gets its plays')
  ok(p.removes, [], 'an item with a change waiting in the outbox is left alone')
  ok(p.skipped, ['movie:7'], 'an item whose history came back empty is left alone, never emptied')
  const unread = buildWatchPlan({ watched: all, local, plays, read: new Set(['ep:1399:1:3']), pending: new Set() })
  ok([unread.updates.length, unread.inserts.length], [0, 1], 'only items whose history was read are matched')
  const gone = buildWatchPlan({ watched: new Set(), local, plays, read: all, pending: new Set() })
  ok(gone, { updates: [], inserts: [], removes: [], skipped: [] }, 'items Trakt\'s summary no longer lists are the summary plan\'s (held-back guard), not this one\'s')
}

// ── Which titles to read ─────────────────────────────────────────────────────
{
  const ids = (tmdb, trakt = tmdb + 1000) => ({ trakt, slug: null, tmdb, imdb: null, tvdb: null })
  const snap = {
    fetchedAt: D('2026-10-14'), username: 'u', lastActivities: {}, watchlist: [], ratings: [], favorites: [], dropped: [], playback: [],
    watchedMovies: [
      { item: { type: 'movie', ids: ids(7), title: 'M', year: 2020 }, plays: 1, lastWatchedAt: D('2020-01-01') },
      { item: { type: 'movie', ids: ids(8), title: 'N', year: 2020 }, plays: 2, lastWatchedAt: D('2021-01-01') },
    ],
    watchedShows: [
      { item: { type: 'show', ids: ids(1399), title: 'GoT', year: 2011 }, plays: 4, lastWatchedAt: D('2026-01-08'), resetAt: null,
        episodes: [[1, 1, 3, D('2026-01-08')], [1, 2, 1, D('2026-01-09')]] },
      { item: { type: 'show', ids: ids(1400, 0), title: 'No trakt id', year: 2011 }, plays: 1, lastWatchedAt: D('2026-01-08'), resetAt: null,
        episodes: [[1, 1, 1, D('2026-01-08')]] },
    ],
  }
  const linked = (id, at, h) => w(id, at, h, 'trakt')
  const local = new Map([
    ['movie:7', [linked('m', D('2020-01-01'), 1)]],
    ['movie:8', [linked('n', D('2021-01-01'), 2)]],
    ['ep:1399:1:1', [linked('a', D('2018-10-12'), 3), linked('b', D('2024-12-01'), 4), linked('c', D('2026-01-08'), 5)]],
    ['ep:1399:1:2', [w('d', D('2026-01-09'), null, 'app')]],
    ['ep:1400:1:1', [linked('e', D('2026-01-08'), 6)]],
  ])
  const t = historyTargets(snap, localPlays(local), new Set())
  ok([...t.movies], [[8, 1008]], 'a movie with another play count is read (by its Trakt id)')
  ok([...t.shows], [[1399, 2399]], 'a show with a watch not linked to a play yet is read')
  ok(t.needsFull, false, 'every title that needs reading has a Trakt id')
  const pend = historyTargets(snap, localPlays(local), new Set(['movie:8', 'ep:1399:1:2']))
  ok(pend.movies.size + pend.shows.size, 0,
    'items waiting in the outbox are not read for')
  const noId = historyTargets(snap, localPlays(new Map([...local, ['ep:1400:1:1', []]])), new Set())
  ok(noId.needsFull, true, 'a title without a Trakt id can only be covered by reading the whole history')
  ok([...summaryKeys(snap)].sort(), ['ep:1399:1:1', 'ep:1399:1:2', 'ep:1400:1:1', 'movie:7', 'movie:8'], 'the summary\'s items, by key')
  ok(HISTORY_TARGET_MAX, 25, 'up to 25 titles are read one by one')
  ok(watchKey.episode(1399, 1, 2), 'ep:1399:1:2', 'keys are the outbox\'s')
  // A whole-history read goes title by title and resumes where it stopped.
  const titles = summaryTitles(snap)
  ok(titles.map(x => x.key), ['movie:7', 'movie:8', 'show:1399', 'show:1400'], 'the titles in one fixed order')
  ok(titlesAfter(titles, 'movie:8').map(x => x.key), ['show:1399', 'show:1400'], 'the next run starts after the last title done')
  ok(titlesAfter(titles, '').length, 4, 'an empty cursor = from the start')
  ok(titleItemKeys(snap, titles[2]), ['ep:1399:1:1', 'ep:1399:1:2'], 'a show\'s items are its episodes in the summary')
}

// ── A removed watch removes ONE play, never a guessed one ───────────────────
{
  const R = id => ({ kind: 'remove', historyId: id })
  const plays = [play(11, D('2018-10-12')), play(12, D('2024-12-01')), play(13, D('2026-01-08'))]
  const keep = [{ historyId: 11, watchedAt: D('2018-10-12') }, { historyId: 13, watchedAt: D('2026-01-08') }]
  ok(playToRemove({ historyId: 12, watchedAt: D('2024-12-01') }, plays, keep), R(12), 'by its Trakt id')
  ok(playToRemove({ historyId: 99, watchedAt: D('2024-12-01') }, plays, keep), { kind: 'gone' }, 'a play Trakt no longer has: nothing to do')
  ok(playToRemove({ historyId: null, watchedAt: D('2024-12-01') }, plays, keep), R(12), 'not linked yet: the play at that exact second, no other watch there')
  ok(playToRemove({ historyId: null, watchedAt: D('2024-11-30') }, plays, keep), { kind: 'wait' }, 'no play at that second: wait for the ids — never the nearest one')
  const twins = [play(1, D('2026-01-08')), play(2, D('2026-01-08'))]
  ok(playToRemove({ historyId: null, watchedAt: D('2026-01-08') }, twins, [{ historyId: null, watchedAt: D('2026-01-08') }]), R(2),
    'two plays at one second, one watch left there: one play goes, one stays for it')
  ok(playToRemove({ historyId: null, watchedAt: D('2026-01-08') }, [play(1, D('2026-01-08'))], [{ historyId: null, watchedAt: D('2026-01-08') }]), { kind: 'wait' },
    'the only play at that second belongs to the watch that stays: wait')
  ok(playToRemove({ historyId: null, watchedAt: null }, [play(5, EPOCH), play(6, D('2020-01-01'))], []), R(5), 'an unknown date matches Trakt\'s unknown date exactly')

  // Reviewer case 1: Trakt has 2018, 2020 and 2026; the app had three
  // placeholders at 2026 (the one kept date) and one of them was moved.
  const real = [play(21, D('2018-01-01')), play(22, D('2020-01-01')), play(23, D('2026-01-01'))]
  const placeholdersLeft = [{ historyId: null, watchedAt: D('2026-01-01') }, { historyId: null, watchedAt: D('2026-01-01') }, { historyId: null, watchedAt: D('2026-05-05') }]
  ok(playToRemove({ historyId: null, watchedAt: D('2026-01-01') }, real, placeholdersLeft), { kind: 'wait' },
    'a moved placeholder removes nothing (no 2020 removal): it waits until the title is linked')
}

// ── Cancelled before anything is sent ────────────────────────────────────────
{
  const rows = [
    { id: 'r1', op: 'history_add', payload: { watch_id: 'W1', watched_at: D('2026-01-01') } },
    { id: 'r2', op: 'history_add', payload: { watch_id: 'W2' } },
    { id: 'r3', op: 'history_remove_play', payload: { watch_id: 'W1', history_id: null, watched_at: D('2026-01-01') } },
    { id: 'r4', op: 'history_add', payload: { watch_id: 'W1', watched_at: D('2026-02-02') } },
    { id: 'r5', op: 'history_remove_play', payload: { watch_id: 'W3', history_id: 5, watched_at: D('2025-01-01') } },
    { id: 'r6', op: 'history_remove', payload: { type: 'episode' } },
  ]
  ok(cancelledOutboxRows(rows), ['r1', 'r3'], 'a re-dated watch whose first add never left: only the new date is sent')
  ok(cancelledOutboxRows([rows[4]]), [], 'a remove of a play already on Trakt is sent')
  // Reviewer case 2: an add that failed (still waiting, retry later), then the watch is removed.
  ok(cancelledOutboxRows([
    { id: 'a', op: 'history_add', payload: { watch_id: 'W9', watched_at: D('2026-03-03') } },
    { id: 'b', op: 'history_remove_play', payload: { watch_id: 'W9', history_id: null, watched_at: D('2026-03-03') } },
  ]), ['a', 'b'], 'a failed add then its remove: both go, nothing unrelated is removed')
  // Reviewer case 3: deleted, then Undo before the drain (the same watch at the same second).
  ok(cancelledOutboxRows([
    { id: 'x', op: 'history_remove_play', payload: { watch_id: 'W7', history_id: 77, watched_at: D('2025-05-05') } },
    { id: 'y', op: 'history_add', payload: { watch_id: 'W7', watched_at: '2025-05-05T20:00:00+00:00' } },
  ]), ['x', 'y'], 'delete then Undo before the drain: no removal, no duplicate play')
  ok(cancelledOutboxRows([
    { id: 'x', op: 'history_remove_play', payload: { watch_id: 'W7', history_id: 77, watched_at: D('2025-05-05') } },
    { id: 'y', op: 'history_add', payload: { watch_id: 'W7', watched_at: D('2025-06-06') } },
  ]), [], 'a remove then an add at ANOTHER date is a real re-date: both are sent')
  ok(cancelledOutboxRows([
    { id: '1', op: 'history_remove_play', payload: { watch_id: 'W', history_id: 1, watched_at: D('2025-01-01') } },
    { id: '2', op: 'history_add', payload: { watch_id: 'W', watched_at: D('2025-02-02') } },
    { id: '3', op: 'history_remove_play', payload: { watch_id: 'W', history_id: null, watched_at: D('2025-02-02') } },
    { id: '4', op: 'history_add', payload: { watch_id: 'W', watched_at: D('2025-01-01') } },
  ]).sort(), ['1', '2', '3', '4'], 'moved and moved back before the drain: Trakt is left alone')
}

// ── A pull never removes many watches by itself ──────────────────────────────
{
  const plan = n => ({ updates: [], inserts: [], removes: Array.from({ length: n }, (_, i) => `w${i}`), skipped: [] })
  ok(watchRemovalsNeedConfirm(plan(10), 50), false, 'up to 10 removals go through')
  ok(watchRemovalsNeedConfirm(plan(11), 50), true, 'more than max(10, 10 %) wait for a confirm')
  ok(watchRemovalsNeedConfirm(plan(200), 3000), false, '10 % of a big history is still allowed')
  ok(watchRemovalsNeedConfirm(plan(301), 3000), true, 'past it, they wait')
}

console.log(`verify-trakt-watch-plan: ${n} assertions passed`)
