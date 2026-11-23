#!/usr/bin/env node
/*
 * Verification — the owner's picks for Trakt items with no TMDB id (migration 200, docs/features/media.md → Trakt matching),
 * against the real traktManualMatch.ts via sucrase. The table is input (the browser writes it), so: only a movie/show with two
 * positive integers in range is read; a pick fills an id Trakt did not give and never replaces one it did; a pick whose TMDB
 * id Trakt already gives to another item, or that two picks name, is not used; a per-title history read gets its TMDB id from
 * the used picks (copied, never changed in place). Also: the function loads the table tolerantly (a missing table = no picks,
 * any other failure stops the run) and the generated copy in trakt-api is current.
 */
require('sucrase/register')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { parseManualMatches, applyManualMatches, fillHistoryIds, matchKey, matchesFingerprint, PICK_NOT_USED } = require('../src/features/media/trakt/traktManualMatch')

let n = 0
const ok = (actual, expected, msg) => { assert.deepStrictEqual(actual, expected, msg); n++ }

const item = (type, trakt, tmdb, title = 'Untitled') => ({ type, ids: { trakt, slug: null, tmdb, imdb: null, tvdb: null }, title, year: 2001 })
const snap = items => ({
  fetchedAt: '', username: null, lastActivities: {},
  watchedMovies: items.filter(i => i.type === 'movie').map(item => ({ item, plays: 1, lastWatchedAt: null })),
  watchedShows: items.filter(i => i.type === 'show').map(item => ({ item, plays: 1, lastWatchedAt: null, resetAt: null, episodes: [] })),
  watchlist: [], ratings: [], favorites: [], dropped: [], playback: [],
})

// ── Reading the rows ─────────────────────────────────────────────────────────
{
  const m = parseManualMatches([
    { kind: 'movie', trakt_id: 10, tmdb_id: 500 },
    { kind: 'show', trakt_id: 10, tmdb_id: 600 },
    { kind: 'episode', trakt_id: 11, tmdb_id: 1 },
    { kind: 'movie', trakt_id: 0, tmdb_id: 1 },
    { kind: 'movie', trakt_id: 12, tmdb_id: -4 },
    { kind: 'movie', trakt_id: 13, tmdb_id: 1.5 },
    { kind: 'movie', trakt_id: 14, tmdb_id: '15' },
    { kind: 'movie', trakt_id: 15, tmdb_id: 3_000_000_000 },
    { kind: 'movie', trakt_id: 16, tmdb_id: Number.MAX_SAFE_INTEGER + 2 },
    { kind: 'movie', trakt_id: null, tmdb_id: 1 },
    null, 'x', 7,
  ])
  ok([...m], [['movie:10', 500], ['show:10', 600]], 'only a movie/show with two positive integers in range is read; a movie and a show may share a Trakt id')
  ok(parseManualMatches({ error: 'x' }).size, 0, 'a non-list answer reads as no picks')
  ok(matchKey('movie', 5), 'movie:5', 'the key is kind:trakt id')
}

// ── Filling the snapshot ─────────────────────────────────────────────────────
{
  const a = item('movie', 10, null)
  const b = item('show', 10, null)
  const own = item('movie', 20, 999)
  const s = snap([a, b, own])
  s.ratings.push({ item: item('movie', 10, null), rating: 8, ratedAt: null })
  const r = applyManualMatches(s, new Map([['movie:10', 500], ['show:10', 600], ['movie:20', 123]]))
  ok([a.ids.tmdb, b.ids.tmdb, own.ids.tmdb], [500, 600, 999], 'a pick fills a missing id; an id Trakt gave is never replaced (the pick for movie 20 is ignored)')
  ok(s.ratings[0].item.ids.tmdb, 500, 'every list that names the item gets the id (a rating of the same movie)')
  ok([...r.used], [['movie:10', 500], ['show:10', 600]], 'the used picks are returned for history reads')
  ok(r.clashes, 0, 'no clash')
}
{
  // Trakt already gives movie 500 to another item: a pick for 500 is not used.
  const a = item('movie', 10, null)
  const other = item('movie', 30, 500)
  const r = applyManualMatches(snap([a, other]), new Map([['movie:10', 500]]))
  ok([a.ids.tmdb, r.used.size, r.clashes], [null, 0, 1], 'a pick for a title Trakt gives to another item is not used')
  ok([...r.clashKeys], ['movie:10'], 'the refused pick is named, so the unmatched list can say why')
  assert.ok(/not used/.test(PICK_NOT_USED)); n++
}
{
  // Two items picked onto one title (the unique key stops it in the table; the function stops it as well).
  const a = item('show', 1, null), b = item('show', 2, null)
  const r = applyManualMatches(snap([a, b]), new Map([['show:1', 700], ['show:2', 700]]))
  ok([a.ids.tmdb, b.ids.tmdb, r.clashes], [700, null, 1], 'two items cannot share one title: the first keeps it, the other is left unmatched')
  ok([...r.clashKeys], ['show:2'], 'the second pick is the one named')
}
{
  const a = item('movie', 10, null)
  const r = applyManualMatches(snap([a]), new Map())
  ok([a.ids.tmdb, r.used.size], [null, 0], 'no picks: nothing changes')
  const noTrakt = item('movie', 0, null)
  applyManualMatches(snap([noTrakt]), new Map([['movie:0', 5]]))
  ok(noTrakt.ids.tmdb, null, 'an item with no Trakt id is never matched')
}

// ── The fingerprint (a changed set of picks makes the timed sync read Trakt) ───
{
  const a = new Map([['movie:10', 500], ['show:10', 600]])
  const same = new Map([['show:10', 600], ['movie:10', 500]])
  ok(matchesFingerprint(a), matchesFingerprint(same), 'the order of the rows does not matter')
  ok(matchesFingerprint(new Map()), matchesFingerprint(new Map()), 'no picks: always the same value')
  const changes = [
    new Map([['movie:10', 500]]),                                   // a delete
    new Map([['movie:10', 501], ['show:10', 600]]),                 // a changed TMDB id
    new Map([['movie:10', 500], ['show:10', 600], ['movie:11', 1]]), // an add
    new Map([['movie:11', 500], ['show:10', 600]]),                 // another Trakt id
  ]
  for (const c of changes) assert.notStrictEqual(matchesFingerprint(c), matchesFingerprint(a))
  n += changes.length
  ok(/^\d+:[0-9a-f]+$/.test(matchesFingerprint(a)), true, 'a short count:hash string (kept in trakt_sync_state)')
  ok(matchesFingerprint(new Map()).startsWith('0:'), true, 'the empty set starts with 0')
}

// ── A per-title history read ─────────────────────────────────────────────────
{
  const used = new Map([['show:10', 600], ['movie:10', 500]])
  const rows = [
    { id: 1, type: 'episode', episode: { season: 1, number: 2 }, show: { ids: { trakt: 10 } } },
    { id: 2, type: 'movie', movie: { ids: { trakt: 10, tmdb: null } } },
    { id: 3, type: 'movie', movie: { ids: { trakt: 10, tmdb: 77 } } },
    { id: 4, type: 'episode', episode: { season: 1, number: 3 }, show: { ids: { trakt: 99 } } },
    null,
  ]
  const before = JSON.stringify(rows)
  const out = fillHistoryIds(rows, used)
  ok(out[0].show.ids.tmdb, 600, 'an episode row of a picked show gets its TMDB id')
  ok(out[1].movie.ids.tmdb, 500, 'a movie row of a picked movie gets its TMDB id')
  ok(out[2].movie.ids.tmdb, 77, 'a row that has an id keeps it')
  ok(out[3].show.ids.tmdb, undefined, 'a row of a title with no pick stays as it is')
  ok(out[4], null, 'a null row passes through')
  ok(JSON.stringify(rows), before, 'the answer is copied, never changed in place')
  ok(fillHistoryIds({ error: 'x' }, used), { error: 'x' }, 'a non-list answer passes through')
  ok(fillHistoryIds(rows, new Map()), rows, 'with no picks the rows are the same')
}

// ── The function's side ──────────────────────────────────────────────────────
{
  const src = fs.readFileSync(`${__dirname}/../supabase/functions/trakt-api/index.ts`, 'utf8')
  const gen = fs.readFileSync(`${__dirname}/../src/features/media/trakt/traktManualMatch.ts`, 'utf8')
  assert.ok(src.includes('function applyManualMatches') && src.includes('function parseManualMatches') && src.includes('function fillHistoryIds'), 'the generated region carries the rules'); n++
  assert.ok(gen.includes('MAX_ID')); n++
  const load = src.slice(src.indexOf('async function loadManualMatches'), src.indexOf('/** Reads the picks and fills'))
  assert.ok(/\.eq\('user_id', userId\)/.test(load), 'the picks are read for one account'); n++
  assert.ok(/'42P01', 'PGRST205'/.test(load) && /return new Map\(\)/.test(load), 'a missing table means no picks (the function may ship before migration 200)'); n++
  assert.ok(/throw error/.test(load), 'any other read failure stops the run (a title would look gone from Trakt)'); n++
  // Every sync path that reads Trakt applies the picks before any plan reads an id.
  ok([...src.matchAll(/applyManualMatches\(snap(, picks| as unknown)/g)].length, 3, 'runSync, runImport and the snapshot action apply the picks')
  const sync = src.slice(src.indexOf('async function runSync'), src.indexOf('async function runImport'))
  assert.ok(/picksChanged = storedFp\.supported && storedFp\.value !== fingerprint/.test(sync), 'runSync compares the picks\' fingerprint with the stored one'); n++
  assert.ok(/!opts\.full && !change\.changed && !historyDue && !picksChanged/.test(sync), 'a changed fingerprint stops runSync from returning early'); n++
  assert.ok(/await storePickFingerprint\(db, userId, fingerprint\)\n\s+return \{ pulled: true/.test(sync), 'the fingerprint is stored only after a pull went through'); n++
  assert.ok(/drainOutbox\(db, userId, token, deadline, linked, picks\)/.test(sync), 'the picks reach the outbox drain (a play removal of a matched title)'); n++
  assert.ok(/recordUnmatched\(db, userId, snap, unadded, manual\.clashKeys\)/.test(sync), 'a refused pick is written to the unmatched list with its reason'); n++
  assert.ok(/playIdsToRemove\(db, userId, token, batch, linked, picks\)/.test(src) && /\/\/ The picks fill the TMDB id of a matched title's rows/.test(src), 'a play removal reads the history with the picks'); n++
  assert.ok(/stat[\s\S]*tmdbToken: !!TMDB_TOKEN\(\)/.test(src), 'status says whether the TMDB token is set'); n++
  ok([...src.matchAll(/matches\b[^\n]*\}\)\.catch/g)].length, 2, 'both history reads get the used picks')
}

console.log(`verify-trakt-manual-match: ${n} checks passed`)
