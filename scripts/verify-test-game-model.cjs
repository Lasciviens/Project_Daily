// Throwaway verification for src/features/games/test-game/testGameModel.ts —
// no unit test framework in this repo (CLAUDE.md).
//   node scripts/verify-test-game-model.cjs
require('sucrase/register')
const assert = require('assert')
const M = require('../src/features/games/test-game/testGameModel.ts')

let n = 0
const ok = (a, b, what) => { assert.deepStrictEqual(a, b, what); n++ }

function game(over = {}) {
  return {
    id: over.id ?? 'g' + Math.round(Math.abs(Math.sin(n + 1)) * 1e9),
    title: 'Untitled', release_year: null, publisher: null, developer: null, description: null,
    storyline: null, genres: null, series_name: null, play_status: 'backlog', tier: null, rating: null,
    play_order: null, is_coop: false, coop_notes: null, is_iconic: false, play_notes: null, game_log: null,
    primary_cover_url: null, age_rating: null, players: null, modes: null, screenshot_url: null,
    fanart_url: null, external_ref: null, external_source: null, synced_at: null, needs_review: false,
    library: 'retro', play_seconds: null, play_count: null, last_played_at: null, started_at: null,
    finished_at: null, media: {}, esde_playcount: null, esde_last_played: null, esde_playtime_seconds: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', platforms: [],
    ...over,
  }
}
const plat = (system, over = {}) => ({
  id: 'p-' + system, game_id: 'x', system, emulator: null, emulator_type: null, performance: null,
  performance_notes: null, cover_url: null, region: null, rom_status: null, rom_url: null, folder_path: null,
  is_primary_variant: false, version_title: null, rating: null, release_date: null, box_url: null,
  wheel_url: null, external_ref: null, external_source: null, synced_at: null, needs_review: false,
  esde_system: null, esde_path: null, esde_playcount: null, esde_playtime_seconds: null, esde_last_played: null,
  created_at: '', updated_at: '', esde_assets: {}, ...over,
})

// ── Platform filing ─────────────────────────────────────────────────────────
// A game with a PS2 and a GameCube copy is counted ONCE, under its primary
// variant, so the sidebar counts add up to the library size.
ok(M.derivePlatformKey(game({ platforms: [plat('gc'), plat('PS2', { is_primary_variant: true })] })), 'ps2',
  'the primary variant decides, case-insensitively')
ok(M.derivePlatformKey(game({ platforms: [plat('snes'), plat('nes')] })), 'snes', 'no primary → the first variant')
ok(M.derivePlatformKey(game({ platforms: [] })), 'unknown', 'no variant at all is filed under unknown, not dropped')
ok(M.derivePlatformKey(game({ library: 'steam', platforms: [plat('ps2')] })), 'steam', 'a Steam row is Steam')
ok(M.derivePlatformKey(game({ library: 'playstation' })), 'playstation', 'a PSN row is PlayStation')
ok(M.platformInfo('ps2').name, 'PlayStation 2', 'known platform name')
ok(M.platformInfo('weird_sys').short, 'WEIRD_SYS', 'an unknown ES-DE folder falls back to its own name')
ok(M.steamAppIdOf(game({ library: 'steam', external_ref: '1245620' })), 1245620, 'Steam appid from external_ref')
ok(M.steamAppIdOf(game({ library: 'steam', external_ref: 'abc' })), null, 'a non-numeric ref is not an appid')
ok(M.steamAppIdOf(game({ library: 'retro', external_ref: '42' })), null, 'a retro ScreenScraper id is not a Steam appid')

// ── Hidden rows ─────────────────────────────────────────────────────────────
ok(M.isHiddenRow(game({ play_status: 'hidden' }), null), true, 'explicit hidden always hides')
ok(M.isHiddenRow(game({ library: 'steam', play_status: 'backlog' }), 'dlc'), true, 'an untouched Steam DLC row hides')
ok(M.isHiddenRow(game({ library: 'steam', play_status: 'playing' }), 'application'), false, 'a tracked app stays')
ok(M.isHiddenRow(game({ library: 'steam', play_status: 'backlog' }), null), false, 'an unclassified app stays visible')
ok(M.isHiddenRow(game({ library: 'steam', play_status: 'backlog' }), 'game'), false, 'a game is a game')

const lib = M.deriveGames([
  game({ id: 'a', title: 'God of War', play_status: 'playing', genres: ['Action'], platforms: [plat('ps2', { is_primary_variant: true })], rating: 9, last_played_at: '2026-09-15T10:00:00Z', play_seconds: 45000 }),
  game({ id: 'b', title: 'shadow of the Colossus', play_status: 'completed', genres: ['Adventure'], platforms: [plat('ps2', { is_primary_variant: true })], rating: 9, release_year: 2005 }),
  game({ id: 'c', title: 'Final Fantasy X', play_status: 'backlog', genres: ['RPG', 'RPG '], platforms: [plat('ps2')], rating: 8, release_year: 2001 }),
  game({ id: 'd', title: 'Metroid Prime', play_status: 'wishlist', genres: ['Action'], platforms: [plat('gc')], play_order: 2 }),
  game({ id: 'e', title: 'Steam Tool', library: 'steam', external_ref: '999', play_status: 'backlog' }),
  game({ id: 'f', title: 'Hidden One', play_status: 'hidden', platforms: [plat('ps2')] }),
  game({ id: 'g', title: 'Portal 2', library: 'steam', external_ref: '620', play_status: 'completed', play_order: 1 }),
  game({ id: 'a', title: 'God of War (duplicate row)' }),
], new Map([[999, 'application'], [620, 'game']]))

ok(lib.length, 7, 'the same id twice is kept once')
ok(lib.find(g => g.id === 'e').hidden, true, 'the Steam application is auto-hidden')

// ── Counts ──────────────────────────────────────────────────────────────────
const counts = M.platformCounts(lib)
ok(counts.map(c => [c.key, c.count]), [['ps2', 3], ['gc', 1], ['steam', 1]],
  'visible games per platform, biggest first, ties by display name (Nintendo GameCube before Steam)')
ok(M.splitPlatforms(counts, 8).others, [], 'a short list folds nothing')
const many = Array.from({ length: 12 }, (_, i) => ({ key: 'k' + i, count: 12 - i, info: M.platformInfo('k' + i) }))
ok(M.splitPlatforms(many, 8).shown.length, 8, 'the top eight are shown')
ok(M.splitPlatforms(many, 8).others.length, 4, 'the rest fold into Others')
ok(M.splitPlatforms(many.slice(0, 9), 8).others, [], 'an "Others" of exactly one platform is shown by name instead')

const sc = M.statusCounts(lib)
ok([sc.all, sc.playing, sc.completed, sc.backlog, sc.wishlist, sc.hidden], [5, 1, 2, 1, 1, 2],
  'status counts exclude hidden rows from every bucket but Hidden')
ok(M.genreOptions(lib).map(g => [g.genre, g.count]), [['Action', 2], ['Adventure', 1], ['RPG', 1]],
  'genres counted once per game, whitespace-trimmed')

// ── Scoping / filtering ─────────────────────────────────────────────────────
const base = { section: 'library', platform: 'ps2', otherKeys: [], scopePlatform: 'all', genre: null, search: '' }
ok(M.scopeGames(lib, base).map(g => g.id).sort(), ['a', 'b', 'c', 'f'], 'a platform scope keeps its hidden row for the Hidden status')
ok(M.applyStatus(M.scopeGames(lib, base), 'all').map(g => g.id).sort(), ['a', 'b', 'c'], '"All" never shows hidden rows')
ok(M.applyStatus(M.scopeGames(lib, base), 'hidden').map(g => g.id), ['f'], 'only "Hidden" shows them')
ok(M.scopeGames(lib, { ...base, platform: 'all' }).length, 7, 'All platforms')
ok(M.scopeGames(lib, { ...base, platform: 'others', otherKeys: ['gc'] }).map(g => g.id), ['d'], 'Others = the folded platforms')
ok(M.scopeGames(lib, { ...base, section: 'completed' }).map(g => g.id).sort(), ['b', 'g'],
  'a status section spans every platform regardless of the sidebar platform')
ok(M.scopeGames(lib, { ...base, section: 'completed', scopePlatform: 'steam' }).map(g => g.id), ['g'], 'and narrows by its own chip')
ok(M.scopeGames(lib, { ...base, section: 'queue' }).map(g => g.id).sort(), ['d', 'g'], 'the queue is every queued game')
ok(M.scopeGames(lib, { ...base, platform: 'all', genre: 'RPG' }).map(g => g.id), ['c'], 'genre filter matches trimmed values')
ok(M.scopeGames(lib, { ...base, platform: 'all', search: 'playstation 2' }).length, 4, 'search matches the platform name ("consoles")')
ok(M.scopeGames(lib, { ...base, platform: 'all', search: 'adventure' }).map(g => g.id), ['b'], 'search matches genres ("tags")')

// ── Sorting ─────────────────────────────────────────────────────────────────
ok(M.sortGames(M.applyStatus(M.scopeGames(lib, base), 'all'), 'title').map(g => g.id), ['c', 'a', 'b'],
  'title sort is case-insensitive (lower-case "shadow" sorts among S)')
ok(M.sortGames(lib.filter(g => !g.hidden), 'recent')[0].id, 'a', 'last played first; never-played rows last')
ok(M.sortGames(lib.filter(g => !g.hidden), 'playtime')[0].id, 'a', 'most played first')
ok(M.sortGames(lib.filter(g => ['b', 'c'].includes(g.id)), 'year-asc').map(g => g.id), ['c', 'b'], 'oldest first')
ok(M.queueOrder(lib).map(g => g.id), ['g', 'd'], 'queue in play_order')

// ── Shelves ─────────────────────────────────────────────────────────────────
const twelve = Array.from({ length: 12 }, (_, i) => i)
ok(M.chunkShelves(twelve, 2, 4).map(r => r.length), [6, 6], 'the design: 12 games on 2 shelves of 4 visible → 6 per carousel')
ok(M.chunkShelves([1, 2, 3], 2, 4), [[1, 2, 3], []], 'few games fill the first shelf; the second stays a bare plank')
ok(M.chunkShelves(twelve, 3, 4).map(r => r[0]), [0, 4, 8], 'contiguous: each shelf continues where the last ended')
ok(M.chunkShelves(Array.from({ length: 101 }, (_, i) => i), 2, 4).map(r => r.length), [51, 50], 'a big library splits evenly')
ok(M.chunkShelves([], 2, 4), [[], []], 'an empty list still draws the shelves')

// ── Rating ──────────────────────────────────────────────────────────────────
ok(M.starsFromRating(9), 4.5, '9/10 → 4.5 stars')
ok(M.starsFromRating(8.6), 4.5, 'rounded to the nearest half star')
ok(M.starsFromRating(null), null, 'unrated')
ok(M.starsFromRating(14), 5, 'clamped')
ok(M.ratingFromStars(4.5), 9, 'written back on the 0–10 scale')
ok(M.formatStars(4), '4.0', 'whole stars read "4.0" like the design')
ok(M.formatStars(null), '—', 'unrated reads as a dash')

// ── Images ──────────────────────────────────────────────────────────────────
const art = M.deriveGames([game({
  id: 'img', primary_cover_url: 'https://x/cover.jpg', fanart_url: 'https://x/fan.jpg',
  media: { 'box-2D': 'https://x/box.png', ss: 'https://x/ss.png', fanart: 'https://x/fan.jpg', junk: 42 },
  platforms: [plat('ps2', {
    is_primary_variant: true, cover_url: 'https://x/pcover.jpg',
    esde_assets: {
      'screenshots/b.png': { category: 'screenshots', url: 'https://x/esde-ss.png', sha256: '', size: 1, mime: 'image/png' },
      'covers/a.png': { category: 'covers', url: 'https://x/esde-cover.png', sha256: '', size: 1, mime: 'image/png' },
    },
  })],
})])[0]
ok(M.coverCandidates(art), ['https://x/cover.jpg', 'https://x/pcover.jpg', 'https://x/box.png', 'https://x/esde-cover.png'],
  'covers: saved cover, variant cover, ScreenScraper box, ES-DE original — deduped')
ok(M.heroCandidates(art)[0], 'https://x/fan.jpg', 'fanart leads the hero')
ok(M.sceneImages(art), ['https://x/ss.png', 'https://x/esde-ss.png', 'https://x/fan.jpg'], 'screenshots first, fanart last, no duplicates, no non-URLs')
const steamRow = M.deriveGames([game({ id: 's', library: 'steam', external_ref: '620', primary_cover_url: 'https://cdn/header.jpg' })])[0]
ok(M.coverCandidates(steamRow)[0], 'https://cdn.akamai.steamstatic.com/steam/apps/620/library_600x900.jpg', 'Steam: the portrait capsule first')
ok(M.coverCandidates(steamRow)[1], 'https://cdn/header.jpg', 'then the saved header as the fallback')
ok(M.coverCandidates(M.deriveGames([game({ id: 'z' })])[0]), [], 'no art at all → empty list (the UI draws a case)')

// ── Text ────────────────────────────────────────────────────────────────────
ok(M.formatDay('2026-09-15T10:00:00Z'), '15 Sep 2026', 'en-GB date')
ok(M.formatDay(null), '—', 'no date')
ok(M.subtitleParts(lib.find(g => g.id === 'b')), ['PlayStation 2', 'Adventure', '2005'], 'platform · genre · year')
ok(M.subtitleParts(lib.find(g => g.id === 'g'), 'Puzzle'), ['Steam', 'Puzzle'], 'a genre fallback fills a missing genre')

console.log(`verify-test-game-model: ${n} assertions passed`)
