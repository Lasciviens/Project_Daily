// Throwaway verification for src/features/games/screenscraperStudio.ts — no unit
// test framework in this repo (CLAUDE.md), so this runs the REAL module through
// sucrase.   node scripts/verify-screenscraper-studio.cjs
require('sucrase/register')
const assert = require('assert')
const S = require('../src/features/games/screenscraperStudio.ts')

let n = 0
const ok = (a, b, what) => { assert.deepStrictEqual(a, b, what); n++ }

const game = (over = {}) => ({
  id: 'g1', title: 'Contra',
  description: null, primary_cover_url: null, screenshot_url: null, fanart_url: null,
  genres: null, release_year: null, publisher: null, developer: null,
  players: null, age_rating: null, series_name: null, modes: null,
  external_ref: null, external_source: null, synced_at: null, needs_review: false,
  platforms: [{ system: 'nes', esde_system: 'nes', is_primary_variant: true }],
  ...over,
})

// ── missingFields ───────────────────────────────────────────────────────────
ok(S.missingFields(game()).length, S.FILLABLE_FIELDS.length, 'an empty game is missing everything fillable')
ok(S.missingFields(game({ description: 'x', genres: ['Action'], release_year: 1988 })).includes('description'), false,
  'a filled field is not missing')
ok(S.missingFields(game({ genres: [] })).includes('genres'), true, 'an EMPTY ARRAY is missing, not filled')
ok(S.missingFields(game({ description: '   ' })).includes('description'), true, 'whitespace is not a description')
ok(S.missingFields(game({ release_year: 0 })).includes('release_year'), false, 'year 0 is a value, not an absence')
ok(S.hasGaps(game()), true, 'an empty game has gaps')
const full = game(Object.fromEntries(S.FILLABLE_FIELDS.map(f => [f, f === 'genres' || f === 'modes' ? ['x'] : 'x'])))
ok(S.hasGaps(full), false, 'a complete game has none')

// ── selectCandidates ────────────────────────────────────────────────────────
const lib = [
  game({ id: 'a', title: 'Contra', platforms: [{ system: 'nes', esde_system: 'nes' }] }),
  game({ id: 'b', title: 'Sonic', description: 'x', genres: ['Platform'], platforms: [{ system: 'genesis', esde_system: 'genesis' }] }),
  game({ id: 'c', title: 'Zelda', needs_review: true, external_ref: '42', platforms: [{ system: 'snes', esde_system: 'snes' }] }),
]
ok(S.selectCandidates(lib, { ...S.EMPTY_FILTERS }).map(g => g.id).sort(), ['a', 'b', 'c'], 'no filter keeps everything')
ok(S.selectCandidates(lib, { ...S.EMPTY_FILTERS, search: 'son' }).map(g => g.id), ['b'], 'search is case-insensitive on title')
ok(S.selectCandidates(lib, { ...S.EMPTY_FILTERS, systems: ['snes'] }).map(g => g.id), ['c'], 'system filter')
ok(S.selectCandidates(lib, { ...S.EMPTY_FILTERS, needsReviewOnly: true }).map(g => g.id), ['c'], 'needs-review filter')
ok(S.selectCandidates(lib, { ...S.EMPTY_FILTERS, neverScrapedOnly: true }).map(g => g.id).sort(), ['a', 'b'],
  'never-scraped excludes a row that already carries a provider id')
ok(S.selectCandidates(lib, { ...S.EMPTY_FILTERS, missing: ['description'] }).map(g => g.id).sort(), ['a', 'c'],
  'missing-field filter')
ok(S.selectCandidates(lib, { ...S.EMPTY_FILTERS, hideHandled: true }, new Set(['a'])).map(g => g.id).sort(), ['b', 'c'],
  'handled rows can be hidden')
ok(S.selectCandidates(lib, { ...S.EMPTY_FILTERS, hideHandled: false }, new Set(['a'])).length, 3,
  'and are kept when the toggle is off')
// Emptiest first: b has two fields filled, so it sorts after a and c.
ok(S.selectCandidates(lib, { ...S.EMPTY_FILTERS }).at(-1).id, 'b', 'the least empty row sorts last')

// ── estimateRequests / checkQuota ───────────────────────────────────────────
ok(S.estimateRequests([game(), game()], false), 2, 'metadata only: one request per game')
ok(S.estimateRequests([game()], true), 4, 'with media: one metadata call plus three missing images')
ok(S.estimateRequests([game({ primary_cover_url: 'u', screenshot_url: 'u', fanart_url: 'u' })], true), 1,
  'images already present cost nothing')
ok(S.estimateRequests([], true), 0, 'nothing selected costs nothing')
ok(S.checkQuota(10, 5000).ok, true, 'a small run against a healthy budget')
ok(S.checkQuota(10, 400).ok, false, 'below the reserve floor nothing runs')
ok(S.checkQuota(600, 1000).ok, false, 'a run that would eat into the floor is refused')
ok(S.checkQuota(499, 1000).ok, true, 'and one that stops exactly at the floor is allowed')
ok(S.checkQuota(10, null).ok, true, 'an unknown budget does not block the run')

// ── matchConfidence ─────────────────────────────────────────────────────────
ok(S.matchConfidence('Contra (USA)', 'Contra'), 'exact', 'region tags are ignored')
ok(S.matchConfidence('Super Mario World', 'Super Mario World 2: Yoshi\'s Island'), 'close', 'a prefix is close')
ok(S.matchConfidence('Sonic The Hedgehog', 'Amy Rose In Sonic The Hedgehog'), 'close',
  'a hack sharing most words reads as close, not exact — it must never claim certainty')
ok(S.matchConfidence('Contra', 'Contra III: The Alien Wars'), 'close', 'a sequel is close')
ok(S.matchConfidence('Contra', 'Gradius'), 'loose', 'an unrelated title is loose')
ok(S.matchConfidence('Contra', null), 'loose', 'no title at all is loose')
ok(S.matchConfidence('!!!', 'Contra'), 'loose', 'a title that normalises to nothing is loose')

// ── undo ────────────────────────────────────────────────────────────────────
ok(S.undoPatch({ gameId: 'a', title: 'x', fields: ['description', 'genres'], at: 'now' }),
  { description: null, genres: null },
  'undo clears exactly the fields that were written')
ok(S.undoPatch({ gameId: 'a', title: 'x', fields: [], at: 'now' }), {}, 'an empty write undoes to nothing')

// ── defaultAcceptedFields ───────────────────────────────────────────────────
ok(S.defaultAcceptedFields({ gameId: 'a', matchedTitle: 'x', system: null, wouldFill: ['description', 'genres'] }),
  ['description', 'genres'], 'every offered field is accepted by default')
ok(S.defaultAcceptedFields({ gameId: 'a', matchedTitle: 'x', system: null, wouldFill: ['description', 'external_ref', 'synced_at'] }),
  ['description'], 'bookkeeping columns the server also writes are not offered as choices')

console.log(`✅ ${n} assertions passed`)
