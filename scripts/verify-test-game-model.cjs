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
ok([M.platformInfo('').short, M.platformInfo('').name, M.platformInfo('').key], ['No platform', 'No platform', 'unknown'],
  'an empty key reads "No platform", never "UNKNOWN"')
ok(M.platformInfo(M.derivePlatformKey(game({ platforms: [] }))).name, 'No platform', 'an orphan game is filed under "No platform"')
ok(M.platformInfo(null).short, 'No platform', 'null is no platform too')

// ── Free-text systems ───────────────────────────────────────────────────────
// `system` is the user's own label; renamed or hand-typed values must land on
// the same platform as the ES-DE folder name.
const resolved = s => M.resolveSystemKey(s)
ok(['GameCube', 'gamecube', 'Nintendo GameCube', 'gc', ' GC '].map(resolved), ['gc', 'gc', 'gc', 'gc', 'gc'], 'GameCube spellings')
ok(['PS1', 'ps-1', 'PlayStation 1', 'PlayStation', 'psx', 'PSone'].map(resolved), ['psx', 'psx', 'psx', 'psx', 'psx', 'psx'],
  'PS1 spellings (a retro "PlayStation" is the console, not the PSN library)')
ok(['PlayStation 2', 'playstation2', 'PS2'].map(resolved), ['ps2', 'ps2', 'ps2'], 'PS2 spellings')
ok(['DS', 'Nintendo DS', '3DS', 'Nintendo 3DS', 'n3ds'].map(resolved), ['nds', 'nds', 'n3ds', 'n3ds', 'n3ds'], 'DS / 3DS')
ok(['Wii U', 'Xbox 360', 'Sega CD', 'Game Boy', 'Vita'].map(resolved), ['wiiu', 'xbox360', 'segacd', 'gb', 'psvita'],
  'spaces and short labels resolve')
ok(['Arcade', 'Arcade (MAME)', 'mame', 'FBNeo'].map(resolved), ['fbneo', 'mame', 'mame', 'fbneo'], 'arcade → FinalBurn Neo unless MAME is named')
ok(['Genesis', 'Mega Drive', 'megadrive', 'Sega Genesis'].map(resolved), ['genesis', 'megadrive', 'megadrive', 'genesis'],
  'Genesis and Mega Drive stay two platforms')
ok(['SNES', 'Super Nintendo', 'Super Nintendo (NA)'].map(resolved), ['snes', 'snes', 'snesna'], 'SNES vs SNES (NA)')
ok([resolved('PC 98'), resolved('pc-98'), resolved('PC98')], ['pc98', 'pc98', 'pc98'], 'an unknown system still merges its spellings')
ok([resolved(''), resolved('  '), resolved(null)], ['unknown', 'unknown', 'unknown'], 'no system → no platform')
ok(M.derivePlatformKey(game({ platforms: [plat('GameCube', { is_primary_variant: true, esde_system: 'wii' })] })), 'gc',
  'filed by the user-facing system, never by esde_system')
ok(M.steamAppIdOf(game({ library: 'steam', external_ref: '1245620' })), 1245620, 'Steam appid from external_ref')
ok(M.steamAppIdOf(game({ library: 'steam', external_ref: 'abc' })), null, 'a non-numeric ref is not an appid')
ok(M.steamAppIdOf(game({ library: 'retro', external_ref: '42' })), null, 'a retro ScreenScraper id is not a Steam appid')

// ── Hidden rows ─────────────────────────────────────────────────────────────
ok(M.isHiddenRow(game({ play_status: 'hidden' }), null), true, 'explicit hidden always hides')
ok(M.isHiddenRow(game({ library: 'steam', play_status: 'hidden' }), 'game'), true, 'explicit hidden hides a real game too')
ok(M.isHiddenRow(game({ library: 'steam', play_status: 'backlog' }), 'dlc'), true, 'an untouched Steam DLC row hides')
ok(M.isHiddenRow(game({ library: 'steam', play_status: 'playing', started_at: '2026-09-01T00:00:00Z' }), 'application'), false,
  'an app someone marked Playing (started_at stamped) stays')
ok(M.isHiddenRow(game({ library: 'steam', play_status: 'playing' }), 'application'), true,
  'an app the importer promoted to Playing (no dates) is not evidence of interest')
ok(M.isHiddenRow(game({ library: 'steam', play_status: 'playing', finished_at: '2026-09-01T00:00:00Z' }), 'tool'), false,
  'a finished date is a decision too')
ok(['completed', 'wishlist', 'dropped'].map(st => M.isHiddenRow(game({ library: 'steam', play_status: st }), 'application')),
  [false, false, false], 'every explicit status keeps a non-game visible')
ok(M.isHiddenRow(game({ library: 'steam', play_status: null }), 'application'), true, 'no status at all is undecided')
ok(M.isHiddenRow(game({ library: 'steam', play_status: 'backlog' }), null), false, 'an unclassified app stays visible')
ok(M.isHiddenRow(game({ library: 'steam', play_status: 'backlog' }), 'game'), false, 'a game is a game')
ok(M.isHiddenRow(game({ library: 'steam', play_status: 'backlog' }), ' Game '), false, 'the type is compared trimmed and case-blind')
ok(M.isHiddenRow(game({ library: 'playstation', play_status: 'playing' }), 'application'), false, 'only Steam rows are classified')
ok([M.isNotAGame(game({ library: 'steam' }), 'dlc'), M.isNotAGame(game({ library: 'steam' }), 'game'),
  M.isNotAGame(game({ library: 'steam' }), null), M.isNotAGame(game({ library: 'retro' }), 'dlc')],
  [true, false, false, false], 'isNotAGame: known non-game Steam type only')
ok([{ play_status: 'backlog' }, { play_status: 'playing' }, { play_status: 'playing', started_at: 'x' }, { play_status: 'completed' }]
  .map(M.isUndecidedStatus), [true, true, false, false], 'isUndecidedStatus')

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
ok(lib.find(g => g.id === 'e').notAGame, true, 'and carries notAGame for the menus')
ok(lib.find(g => g.id === 'g').notAGame, false, 'a Steam game is not flagged')
ok(lib.find(g => g.id === 'a').notAGame, false, 'a retro row is never flagged')
ok(M.deriveGames([game({ id: 'u', library: 'steam', external_ref: '5', play_status: 'backlog' })], new Map([[5, 'application']]))[0].hidden, true,
  '"Unhide" writing backlog would re-hide a non-game: the menus must offer a decided status instead (data-wiring-3)')

// ── Derived identity ────────────────────────────────────────────────────────
// A refetch that leaves a row unchanged (TanStack keeps its object) must hand
// back the SAME derived row, so one status change re-renders one card.
{
  const rowA = game({ id: 'ida', title: 'A', platforms: [plat('ps2', { is_primary_variant: true })] })
  const rowB = game({ id: 'idb', title: 'B', library: 'steam', external_ref: '77', play_status: 'backlog' })
  const first = M.deriveGames([rowA, rowB], new Map([[77, 'game']]))
  const rowA2 = { ...rowA, play_status: 'completed' }
  const second = M.deriveGames([rowA2, rowB], new Map([[77, 'game']]))
  ok(second[1] === first[1], true, 'an unchanged source row keeps its derived object (even with a new types Map)')
  ok(second[0] === first[0], false, 'a changed source row gets a new derived object')
  ok(second[0].play_status, 'completed', 'with the new values')
  ok(M.deriveGames([rowA2, rowB], new Map())[1] === first[1], true, 'unknown and "game" classify alike, so no re-derive')
  const third = M.deriveGames([rowA2, rowB], new Map([[77, 'dlc']]))
  ok(third[1] === first[1], false, 'a changed classification re-derives the row')
  ok([third[1].notAGame, third[1].hidden], [true, true], 'and applies it')
}

// ── Counts ──────────────────────────────────────────────────────────────────
const counts = M.platformCounts(lib)
ok(counts.map(c => [c.key, c.count]), [['ps2', 3], ['gc', 1], ['steam', 1]],
  'visible games per platform, biggest first, ties by display name (Nintendo GameCube before Steam)')
ok(M.splitPlatforms(counts, 8).others, [], 'a short list folds nothing')
const many = Array.from({ length: 12 }, (_, i) => ({ key: 'k' + i, count: 12 - i, info: M.platformInfo('k' + i) }))
ok(M.splitPlatforms(many, 8).shown.length, 8, 'the top eight are shown')
ok(M.splitPlatforms(many, 8).others.length, 4, 'the rest fold into Others')
ok(M.splitPlatforms(many.slice(0, 9), 8).others, [], 'an "Others" of exactly one platform is shown by name instead')

// ── Platform labels ─────────────────────────────────────────────────────────
const pc = key => ({ key, count: 1, info: M.platformInfo(key) })
ok([...M.platformLabels([pc('snes'), pc('snesna'), pc('ps2')])], [['snes', 'Super Nintendo'], ['snesna', 'Super Nintendo (NA)'], ['ps2', 'PS2']],
  'two platforms sharing "SNES" show their full names; the rest keep the short one')
ok([...M.platformLabels([pc('fbneo'), pc('mame')]).values()], ['Arcade (FinalBurn Neo)', 'Arcade (MAME)'], 'two "Arcade" rows')
ok([...M.platformLabels([pc('androidapps'), pc('androidgames')]).values()], ['Android apps', 'Android games'], 'two "Android" rows')
ok(M.platformLabels([pc('snes'), pc('gc')]).get('snes'), 'SNES', 'SNES alone keeps its short label')
ok(M.platformLabels([pc('unknown')]).get('unknown'), 'No platform', 'orphans are labelled')
ok(M.platformLabels([{ key: 'a1', count: 1, info: { key: 'a1', short: 'X', name: 'Same', family: 'other', brand: '' } },
  { key: 'a2', count: 1, info: { key: 'a2', short: 'X', name: 'Same', family: 'other', brand: '' } }]).get('a2'), 'Same (a2)',
  'if even the full names collide, the key keeps the rows apart')

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

// ── Play statistics (retro rows read the live ES-DE trio) ──────────────────
{
  const stale = game({ id: 'st', title: 'Stale', play_seconds: 600, play_count: 1, last_played_at: '2026-05-19T19:06:43+00:00',
    esde_playtime_seconds: 36000, esde_playcount: 9, esde_last_played: '2026-09-24T20:00:00+00:00' })
  const steamG = game({ id: 'sg', title: 'Steam', library: 'steam', external_ref: '1', play_seconds: 20000, last_played_at: '2026-08-01T00:00:00Z' })
  ok([M.playSeconds(stale), M.playCount(stale), M.lastPlayedIso(stale)], [36000, 9, '2026-09-24T20:00:00+00:00'],
    'a retro row shows ES-DE\'s live figures, not the frozen 096 backfill')
  ok([M.playSeconds(steamG), M.lastPlayedIso(steamG)], [20000, '2026-08-01T00:00:00Z'], 'a Steam row keeps its neutral columns')
  const derived = M.deriveGames([steamG, stale])
  ok(M.sortGames(derived, 'recent').map(g => g.id), ['st', 'sg'], '"Last played" sorts on the same reading the panel shows')
  ok(M.sortGames(derived, 'playtime').map(g => g.id), ['st', 'sg'], '"Most played" too (36000 s beats 20000 s)')
  ok(M.playSeconds(game({ id: 'np' })), null, 'no play data reads null, not zero')
}

// ── Queue ranks ─────────────────────────────────────────────────────────────
{
  const q = M.deriveGames([
    game({ id: 'q1', title: 'One', play_order: 4 }),
    game({ id: 'q2', title: 'Two', play_order: 9 }),
    game({ id: 'qh', title: 'Hidden', play_order: 5, play_status: 'hidden' }),
    game({ id: 'qa', title: 'App', library: 'steam', external_ref: '31', play_status: 'backlog', play_order: 1 }),
    game({ id: 'q3', title: 'Beta', play_order: 12 }),
    game({ id: 'q4', title: 'Alpha', play_order: 12 }),
    game({ id: 'qn', title: 'Not queued' }),
  ], new Map([[31, 'application']]))
  const ranks = M.queueRanks(q)
  ok([...ranks], [['q1', 1], ['q2', 2], ['q4', 3], ['q3', 4]],
    '1-based, in play order, gaps closed; hidden and auto-hidden queued rows take no place; ties by title')
  ok(ranks.size, 4, 'the size is the queue badge')
  ok(ranks.has('qh') || ranks.has('qa') || ranks.has('qn'), false, 'hidden, auto-hidden and unqueued rows have no rank')
  ok(M.queueOrder(q.filter(g => !g.hidden)).map(g => g.id), ['q1', 'q2', 'q4', 'q3'], 'queueOrder breaks the same ties the same way')
  ok(M.queueRanks([]).size, 0, 'an empty library has an empty queue')
}

// ── Shelves ─────────────────────────────────────────────────────────────────
const twelve = Array.from({ length: 12 }, (_, i) => i)
ok(M.chunkShelves(twelve, 2, 4).map(r => r.length), [6, 6], 'the design: 12 games on 2 shelves of 4 visible → 6 per carousel')
ok(M.chunkShelves([1, 2, 3], 2, 4), [[1, 2, 3], []], 'few games fill the first shelf; the second stays a bare plank')
ok(M.chunkShelves(twelve, 3, 4).map(r => r[0]), [0, 4, 8], 'contiguous: each shelf continues where the last ended')
ok(M.chunkShelves(Array.from({ length: 101 }, (_, i) => i), 2, 4).map(r => r.length), [51, 50], 'a big library splits evenly')
ok(M.chunkShelves([], 2, 4), [[], []], 'an empty list still draws the shelves')

// ── Rating ──────────────────────────────────────────────────────────────────
ok(M.starsFromRating(9), 4.5, '9/10 → 4.5 stars')
ok(M.starsFromRating(9.5), 4.75, 'exact, not rounded: 9.5 is 4.75 stars, not 5')
ok(M.starsFromRating(7.5), 3.75, '7.5 → 3.75')
ok(M.starsFromRating(8.6), 4.3, '8.6 → 4.3 (a half-star rounding claimed 4.5)')
ok(M.starsFromRating(8.33), 4.17, 'two decimals at most')
ok(M.starsFromRating('7'), 3.5, 'a numeric string from PostgREST still reads')
ok(M.starsFromRating(null), null, 'unrated')
ok(M.starsFromRating('abc'), null, 'garbage is unrated, never NaN')
ok(M.starsFromRating(14), 5, 'clamped high')
ok(M.starsFromRating(-2), 0, 'clamped low')
ok(M.ratingFromStars(4.5), 9, 'written back on the 0–10 scale')
ok(M.ratingFromStars(3), 6, 'a whole-star click')
ok(M.formatStars(4), '4.0', 'whole stars read "4.0" like the design')
ok(M.formatStars(4.5), '4.5', 'half stars')
ok(M.formatStars(4.75), '4.75', 'quarter points keep both decimals')
ok(M.formatStars(4.3), '4.3', 'no trailing zero on one decimal')
ok(M.formatStars(M.starsFromRating(9.5)), '4.75', 'round trip for the hero text "4.75/5"')
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
const steamRow = M.deriveGames([game({ id: 's', library: 'steam', external_ref: '620', primary_cover_url: 'https://cdn.akamai.steamstatic.com/steam/apps/620/header.jpg' })])[0]
ok(M.coverCandidates(steamRow), ['https://cdn.akamai.steamstatic.com/steam/apps/620/library_600x900.jpg'],
  'Steam: the portrait capsule only — the saved header banner is not box art')
ok(M.steamHeaderOf(steamRow), 'https://cdn.akamai.steamstatic.com/steam/apps/620/header.jpg', 'the header is offered to the case art instead')
ok(M.heroCandidates(steamRow).includes('https://cdn.akamai.steamstatic.com/steam/apps/620/header.jpg'), true, 'and stays a (last) hero candidate')
const storeHeader = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/header.jpg?t=1700000000'
ok(M.coverCandidates(M.deriveGames([game({ id: 's2', library: 'steam', external_ref: '620', primary_cover_url: storeHeader })])[0]).includes(storeHeader), false,
  'a store-API header on another host (with ?t=) is excluded too')
const edited = M.deriveGames([game({ id: 's3', library: 'steam', external_ref: '620', primary_cover_url: 'https://x/my-box.jpg' })])[0]
ok(M.coverCandidates(edited)[1], 'https://x/my-box.jpg', 'a box art the user saved on a Steam row still counts')
const retroWithHeader = M.deriveGames([game({ id: 'rh', primary_cover_url: storeHeader })])[0]
ok([M.coverCandidates(retroWithHeader), M.steamHeaderOf(retroWithHeader)], [[], storeHeader],
  'a header saved on a non-Steam row goes to the case art, not the cover')
ok(M.steamHeaderOf(M.deriveGames([game({ id: 'nh', primary_cover_url: 'https://x/cover.jpg' })])[0]), null, 'no header → null')
ok(M.coverCandidates(M.deriveGames([game({ id: 'z' })])[0]), [], 'no art at all → empty list (the UI draws a case)')

// PlayStation covers: the sized copy first, the original right behind it.
const psnCover = 'https://image.api.playstation.com/vulcan/ap/rnd/202010/abc.png'
const psnRow = M.deriveGames([game({ id: 'ps', library: 'playstation', primary_cover_url: psnCover })])[0]
ok(M.coverCandidates(psnRow), [psnCover + '?w=440', psnCover], 'PSN: ?w=440 before the raw URL')
const psnQ = 'https://image.api.playstation.com/cdn/UP0001/CUSA1/x.png?a=1'
ok(M.coverCandidates(M.deriveGames([game({ id: 'ps2', library: 'playstation', primary_cover_url: psnQ })])[0]),
  [psnQ + '&w=440', psnQ], 'an existing query gets &w=440')
const psnSized = 'https://image.api.playstation.com/cdn/x.png?w=720'
ok(M.coverCandidates(M.deriveGames([game({ id: 'ps3', library: 'playstation', primary_cover_url: psnSized })])[0]),
  [psnSized], 'an already-sized URL is left alone')
ok(M.coverCandidates(art)[0], 'https://x/cover.jpg', 'other hosts are never rewritten')

// ── Text ────────────────────────────────────────────────────────────────────
ok(M.formatDay('2026-09-15T10:00:00Z'), '15 Sep 2026', 'en-GB date')
ok(M.formatDay(null), '—', 'no date')
ok(M.subtitleParts(lib.find(g => g.id === 'b')), ['PlayStation 2', 'Adventure', '2005'], 'platform · genre · year')
ok(M.subtitleParts(lib.find(g => g.id === 'g'), 'Puzzle'), ['Steam', 'Puzzle'], 'a genre fallback fills a missing genre')

console.log(`verify-test-game-model: ${n} assertions passed`)
