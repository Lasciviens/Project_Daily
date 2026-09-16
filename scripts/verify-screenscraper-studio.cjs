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

// ── estimateRequests / estimateSaveRequests / checkQuota ────────────────────
ok(S.estimateRequests([game(), game()], false), 2, 'metadata only: one request per game')
ok(S.estimateRequests([game()], true), 2, 'a lookup fetches one candidate cover, not all three images')
ok(S.estimateRequests([game({ primary_cover_url: 'u' })], true), 1, 'a game that already has a cover costs one')
ok(S.estimateRequests([], true), 0, 'nothing selected costs nothing')
// Saving is the OTHER half — the apply re-fetches to prove the entry is the
// one that was reviewed, and that verification is a real second request.
ok(S.estimateSaveRequests([game()], true), 3, 'save: one metadata call plus the two images the review did not fetch')
ok(S.estimateSaveRequests([game({ screenshot_url: 'u', fanart_url: 'u' })], true), 1, 'images already present cost nothing')
ok(S.estimateSaveRequests([game()], false), 1, 'without artwork, saving is one call per game')
ok(S.checkQuota(10, 5000).ok, true, 'a small run against a healthy budget')
ok(S.checkQuota(10, 400).ok, false, 'below the reserve floor nothing runs')
ok(S.checkQuota(600, 1000).ok, false, 'a run that would eat into the floor is refused')
ok(S.checkQuota(499, 1000).ok, true, 'and one that stops exactly at the floor is allowed')
ok(S.checkQuota(10, null).ok, true, 'an unknown budget does not block the run')

// ── matchConfidence ─────────────────────────────────────────────────────────
ok(S.matchConfidence('Contra (USA)', 'Contra'), 'exact', 'region tags are ignored')
// A sequel is a DIFFERENT GAME, and "Contra" landing on "Contra III" is the
// exact wrong match this library actually suffered — so it must not read as
// close. An earlier prefix-based version said it did.
ok(S.matchConfidence('Super Mario World', "Super Mario World 2: Yoshi's Island"), 'loose', 'a sequel is not close')
ok(S.matchConfidence('Contra', 'Contra III: The Alien Wars'), 'loose', 'nor is this one')
ok(S.matchConfidence('Sonic The Hedgehog', 'Amy Rose In Sonic The Hedgehog'), 'loose',
  'a romhack carrying the whole title is still a different game')
ok(S.matchConfidence('Contra', 'Gradius'), 'loose', 'an unrelated title is loose')
// The reason this function was rewritten: a one-word library title used to
// make every candidate "close", so the red badge was unreachable on a retro
// library where most titles are one or two words.
ok(S.matchConfidence('Contra', 'Super Contra Hack Collection'), 'loose', 'a hack collection is not close')
ok(S.matchConfidence('Tetris', 'Tetris 2000 Hack Pack'), 'loose', 'nor is a hack pack, prefix or not')
ok(S.matchConfidence('Sonic', 'Amy Rose In Sonic The Hedgehog'), 'loose', 'nor is a romhack of it')
ok(S.matchConfidence('Contra', 'Contra II'), 'close', 'but one extra word still is')
ok(S.matchConfidence('Super Mario Kart', 'Super Mario Kart Deluxe'), 'close', 'one added word is close')
ok(S.matchConfidence('Final Fantasy', 'Final Fantasy VI Hack Edition Plus'), 'loose',
  'two shared words drowned out by four of theirs is not close')
ok(S.matchConfidence('Zelda [!]', 'Zelda'), 'exact', 'ROM bracket tags are stripped like parentheses')
ok(S.matchConfidence('Contra', null), 'loose', 'no title at all is loose')
ok(S.matchConfidence('!!!', 'Contra'), 'loose', 'a title that normalises to nothing is loose')

// ── splitAcceptedFields — the review → apply contract ───────────────────────
ok(S.splitAcceptedFields(['description', 'genres', 'primary_cover_url']),
  { fields: ['description', 'genres'], mediaRoles: ['primary_cover_url'] },
  'text fields and image columns go to different server arguments')
ok(S.splitAcceptedFields(['primary_cover_url', 'fanart_url']),
  { fields: [], mediaRoles: ['primary_cover_url', 'fanart_url'] },
  'an art-only approval sends an EMPTY fields array, which means "write no text"')
ok(S.splitAcceptedFields([]), { fields: [], mediaRoles: [] }, 'nothing approved')
ok(S.splitAcceptedFields(null), { fields: [], mediaRoles: [] }, 'a rejected result')
// The provider id is bookkeeping the server always writes — never a user choice.
ok(S.splitAcceptedFields(['description']).fields.includes('external_ref'), false,
  'external_ref is never smuggled through the approved-field list')

// ── reduceHandled — progress across sessions ────────────────────────────────
// Rows arrive newest-first, as the query orders them.
ok(S.reduceHandled([
  { game_id: 'a', decision: 'applied' },
  { game_id: 'b', decision: 'rejected' },
  { game_id: 'c', decision: 'no_match' },
  { game_id: 'd', decision: 'unmatchable' },
]), { a: 'saved', b: 'skipped', c: 'no_match', d: 'no_match' }, 'each decision maps to its state')
ok(S.reduceHandled([
  { game_id: 'a', decision: 'undone' },
  { game_id: 'a', decision: 'applied' },
]), {}, 'an undo puts the game back in the queue rather than marking it')
ok(S.reduceHandled([
  { game_id: 'a', decision: 'applied' },
  { game_id: 'a', decision: 'undone' },
  { game_id: 'a', decision: 'applied' },
]), { a: 'saved' }, 'and a fresh apply after an undo wins again')
ok(S.reduceHandled([
  { game_id: 'a', decision: 'rejected' },
  { game_id: 'a', decision: 'no_match' },
]), { a: 'skipped' }, 'the newest decision wins, not the first seen')
ok(S.reduceHandled([]), {}, 'no history')

// ── systemOf ────────────────────────────────────────────────────────────────
ok(S.systemOf(game({ platforms: [
  { system: 'nes', esde_system: 'nes' },
  { system: 'snes', esde_system: 'snes', is_primary_variant: true },
] })), 'snes', 'the primary variant wins over row order')
ok(S.systemOf(game({ platforms: [{ system: 'Genesis', esde_system: 'genesis' }] })), 'genesis',
  'the ES-DE folder name wins over the display name — it is the match key')
ok(S.systemOf(game({ platforms: [{ system: 'nes' }] })), 'nes', 'falling back to the display name')
ok(S.systemOf(game({ platforms: [] })), null, 'a game with no platform row has no system')

// ── defaultAcceptedFields ───────────────────────────────────────────────────
ok(S.defaultAcceptedFields({ gameId: 'a', matchedTitle: 'x', system: null, wouldFill: ['description', 'genres'] }),
  ['description', 'genres'], 'every offered field is accepted by default')
ok(S.defaultAcceptedFields({ gameId: 'a', matchedTitle: 'x', system: null, wouldFill: ['description', 'external_ref', 'synced_at'] }),
  ['description'], 'bookkeeping columns the server also writes are not offered as choices')

console.log(`✅ ${n} assertions passed`)
