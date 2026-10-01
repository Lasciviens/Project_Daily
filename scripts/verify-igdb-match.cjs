#!/usr/bin/env node
/**
 * verify-igdb-match.cjs — IGDB matching rules (src/features/games/igdb/igdbMatch.ts),
 * the IGDB page's list rules (test-game/components/igdb/tgIgdbModel.ts) and the
 * queue estimate's use of IGDB lengths, against the real modules through sucrase.
 *
 *   node scripts/verify-igdb-match.cjs
 */
require('sucrase/register')
const M = require('../src/features/games/igdb/igdbMatch.ts')
const L = require('../src/features/games/test-game/components/igdb/tgIgdbModel.ts')
const T = require('../src/features/games/test-game/testGameModel.ts')

let passed = 0
const failures = []
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) passed++
  else failures.push(`${label}\n    expected ${e}\n    actual   ${a}`)
}

const cand = (o = {}) => ({ id: 1, name: 'Chrono Trigger', slug: 'chrono-trigger', year: 1995, platformIds: [19], platformNames: ['Super Nintendo Entertainment System'], altNames: [], coverId: 'abc', type: 'Main Game', ratingCount: 500, ...o })
const target = (o = {}) => ({ title: 'Chrono Trigger (USA)', year: 1995, platformKey: 'snes', library: 'retro', ...o })

// ── Titles ──
eq(M.normTitle('The Legend of Zelda: A Link to the Past (USA) [!]'), 'legend of zelda a link to the past', 'tags, leading The and punctuation go')
eq(M.normTitle('Final Fantasy VII'), 'final fantasy 7', 'roman numerals become digits')
eq(M.normTitle('Pokémon Snap'), 'pokemon snap', 'accents fold')
eq(M.normTitle('Ratchet & Clank'), 'ratchet and clank', '& reads as and')
eq(M.normTitle('Legend of Zelda, The'), 'legend of zelda', 'trailing ", The" goes')
eq(M.normTitle('Mega Man X™'), 'mega man x', 'trademark goes; X stays a letter')
eq(M.compareTitles('Mega Man X', 'Mega Man 10').kind !== 'same', true, 'Mega Man X is not Mega Man 10')
eq(M.compareTitles('Mega Man', 'MegaMan').kind, 'same', 'spacing differences are the same title')
eq(M.compareTitles('Final Fantasy VII', 'Final Fantasy VII: Remake').kind, 'subtitle', 'a subtitle is not the same game')
eq(M.compareTitles('Super Mario World', 'Super Mario World 2: Yoshi\'s Island').kind !== 'same', true, 'a sequel is never "same"')
eq(M.baseTitle('Castlevania - Symphony of the Night'), 'castlevania', 'base title cuts at " - "')

// ── Scoring ──
const exact = M.scoreCandidate(target(), cand())
eq(exact.confidence, 'exact', 'same title + platform + year → exact')
eq([exact.platformMatch, exact.yearMatch], [true, true], 'platform and year agree')
eq(M.scoreCandidate(target({ year: null }), cand()).confidence, 'exact', 'no year: platform alone settles it')
eq(M.scoreCandidate(target({ platformKey: 'unknown', year: null }), cand()).confidence !== 'exact', true, 'bare title with nothing else agreeing is never exact')
eq(M.scoreCandidate(target(), cand({ platformIds: [7], platformNames: ['PlayStation'] })).confidence !== 'exact', true, 'wrong platform is never exact')
eq(M.scoreCandidate(target(), cand({ year: 2008 })).confidence !== 'exact', true, 'year far off is never exact')
eq(M.scoreCandidate(target(), cand({ type: 'DLC' })).confidence !== 'exact', true, 'a DLC is never exact')
eq(M.scoreCandidate(target(), cand({ platformIds: [999], platformNames: ['Super Nintendo Entertainment System'] })).platformMatch, true, 'platform name rescues a wrong id')
eq(M.scoreCandidate(target({ platformKey: 'psx' }), cand({ platformIds: [], platformNames: ['PlayStation 2'] })).platformMatch, false, '"PlayStation 2" is not the first PlayStation')
eq(M.scoreCandidate(target({ title: 'Chrono Trigger' }), cand({ name: 'Kurono Torigā', altNames: ['Chrono Trigger'] })).titleMatch, 'same', 'alternative names count')
eq(M.scoreCandidate(target({ library: 'steam', platformKey: 'steam', title: 'Hades', year: 2020 }), cand({ name: 'Hades', year: 2020, platformIds: [6], platformNames: ['PC (Microsoft Windows)'] })).confidence, 'exact', 'Steam row on PC → exact')
eq(M.scoreCandidate(target({ library: 'playstation', platformKey: 'playstation', title: 'Bloodborne', year: 2015 }), cand({ name: 'Bloodborne', year: 2015, platformIds: [48], platformNames: ['PlayStation 4'] })).confidence, 'exact', 'PSN row on PS4 → exact')

// ── Ranking and ties ──
const twins = M.rankCandidates(target({ title: 'Tetris', year: null, platformKey: 'gb' }), [
  cand({ id: 10, name: 'Tetris', year: 1989, platformIds: [33], platformNames: ['Game Boy'], ratingCount: 900 }),
  cand({ id: 11, name: 'Tetris', year: 1998, platformIds: [33], platformNames: ['Game Boy'], ratingCount: 20 }),
])
eq(twins.map(c => c.confidence), ['likely', 'likely'], 'two equal exact matches with no year to tell them apart → both likely')
eq(twins[0].id, 10, 'the more-rated one ranks first')
const settled = M.rankCandidates(target({ title: 'Tetris', year: 1989, platformKey: 'gb' }), [
  cand({ id: 11, name: 'Tetris', year: 1998, platformIds: [33], platformNames: ['Game Boy'] }),
  cand({ id: 10, name: 'Tetris', year: 1989, platformIds: [33], platformNames: ['Game Boy'] }),
])
eq([settled[0].id, settled[0].confidence], [10, 'exact'], 'the year settles a tie')
eq(M.rankCandidates(target(), [cand({ id: 2, name: 'Chrono Cross', year: 1999 }), cand()])[0].id, 1, 'the right title outranks a near one')

// ── Decisions ──
const steamC = cand({ id: 77, name: 'Hades', platformIds: [6] })
eq(M.decideMatch(target({ title: 'Totally Different' }), steamC, []).status, 'exact', 'a Steam app id match is exact whatever the title says')
eq(M.decideMatch(target({ title: 'Totally Different' }), steamC, []).kind, 'steam', 'and is saved as a Steam match')
eq(M.decideMatch(target(), null, [cand()]).kind, 'exact', 'title match → exact kind')
eq(M.decideMatch(target(), null, [cand({ name: 'Chrono Trigger: Jet Bike' })]).status, 'review', 'a near match waits for review')
eq(M.decideMatch(target(), null, []).status, 'none', 'no results → none')
eq(M.searchQuery('Sonic The Hedgehog (USA, Europe) [!]'), 'Sonic The Hedgehog', 'search text drops region and dump tags')

// ── Display ──
eq(M.formatLength(12 * 3600 + 900), '12 h', 'long lengths in whole hours')
eq(M.formatLength(5400), '1.5 h', 'short lengths to the half hour')
eq(M.formatLength(2400), '40 min', 'under an hour in minutes')
eq(M.formatLength(null), null, 'nothing → null')
eq(M.formatLength(0), null, 'zero → null')
eq(M.igdbImage('co1abc', 'thumb'), 'https://images.igdb.com/igdb/image/upload/t_thumb/co1abc.jpg', 'image URL follows IGDB\'s t_{size}/{id}.jpg')
eq(M.igdbPageUrl({ igdb_url: null, igdb_slug: 'hades' }), 'https://www.igdb.com/games/hades', 'page link falls back to the slug')
eq(M.igdbPageUrl({ igdb_url: 'https://www.igdb.com/games/x', igdb_slug: 'y' }), 'https://www.igdb.com/games/x', 'IGDB\'s own url wins')
eq(M.igdbPlatformsFor('anything', 'steam'), [6], 'Steam rows are PC')

// ── List rules ──
const g = (o = {}) => ({ id: 'a', title: 'A', hidden: false, library: 'retro', igdb_id: null, ttb_main_seconds: null, ttb_extra_seconds: null, ttb_full_seconds: null, igdb_total_rating: null, ...o })
eq(L.igdbRowMatches(g(), 'todo', undefined), true, 'unmatched is to do')
eq(L.igdbRowMatches(g({ igdb_id: 5 }), 'todo', undefined), false, 'matched is not to do')
eq(L.igdbRowMatches(g(), 'todo', { saved: { name: 'A', at: 1 } }), false, 'saved this session leaves to do')
eq(L.igdbRowMatches(g(), 'review', { decision: { status: 'review', candidates: [] } }), true, 'a review decision is to review')
eq(L.igdbRowMatches(g(), 'review', { decision: { status: 'exact', candidates: [] } }), false, 'an exact one is not')
eq(L.igdbRowMatches(g({ igdb_id: 5 }), 'no_length', undefined), true, 'matched without a length')
eq(L.igdbRowMatches(g({ igdb_id: 5, ttb_main_seconds: 3600 }), 'no_length', undefined), false, 'matched with a length')
eq(L.igdbCoverage([g({ igdb_id: 1, ttb_extra_seconds: 10, igdb_total_rating: 80 }), g({ igdb_id: 2 }), g()]), { total: 3, matched: 2, withLength: 1, rated: 1 }, 'coverage counts')
eq(L.igdbCandidates([g(), g({ id: 'h', hidden: true })]).length, 1, 'hidden rows are left out')
eq(L.toLookUp([g({ id: 'x' }), g({ id: 'y' }), g({ id: 'z', igdb_id: 3 })], { y: { decision: { status: 'none', candidates: [] } } }).map(x => x.id), ['x'], 'only games not looked up and not matched are run')

// ── Sorts and the queue estimate ──
const q = (o = {}) => ({ id: o.id ?? 'q', title: o.title ?? 'Q', hidden: false, library: 'retro', platforms: [], play_order: 1, play_status: 'backlog', esde_playtime_seconds: null, play_seconds: null, ...o })
eq(T.sortGames([q({ id: '1', title: 'Long', ttb_extra_seconds: 90000 }), q({ id: '2', title: 'None' }), q({ id: '3', title: 'Short', ttb_main_seconds: 3600 })], 'length').map(x => x.id), ['3', '1', '2'], 'Shortest first, unknown last')
eq(T.sortGames([q({ id: '1', igdb_total_rating: 70 }), q({ id: '2' }), q({ id: '3', igdb_total_rating: 90 })], 'igdb-rating').map(x => x.id), ['3', '1', '2'], 'IGDB score high to low, none last')
const all = [q({ id: 'a', ttb_extra_seconds: 10 * 3600, play_seconds: 4 * 3600 }), q({ id: 'b', ttb_main_seconds: 2 * 3600 })]
const qi = T.queueInsights(all)
eq([qi.forecastSeconds, qi.fromIgdb], [8 * 3600, 2], 'every queued game has a length → IGDB lengths minus play, no median needed')
eq(T.queueInsights([...all, q({ id: 'c' })]).forecastSeconds, null, 'one game without a length and no median → no forecast')

if (failures.length) {
  console.error(`verify-igdb-match: ${failures.length} failed, ${passed} passed\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log(`verify-igdb-match: ${passed} assertions passed`)
