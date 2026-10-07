// Throwaway verification for src/features/games/test-game/tgMergeModel.ts
// (the Compare & merge preview) and its SQL twin, migration 131's
// merge_games() — no unit test framework in this repo (CLAUDE.md).
//   node scripts/verify-tg-merge.cjs
require('sucrase/register')
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const T = require('../src/features/games/test-game/tgMergeModel.ts')
const M = require('../src/features/games/test-game/testGameModel.ts')

let n = 0
const ok = (a, b, what) => { assert.deepStrictEqual(a, b, what); n++ }

function game(over = {}) {
  return {
    id: 'g', title: 'Untitled', release_year: null, publisher: null, developer: null, description: null,
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
const plat = (id, system, primary = false) => ({ id, system, is_primary_variant: primary })

const keep = game({
  id: 'k', title: 'Zelda (USA)', description: '  ', developer: 'Nintendo', genres: ['Action', 'Adventure'],
  modes: null, rating: 8, play_status: 'backlog', play_notes: 'mine', esde_playcount: 3, esde_playtime_seconds: 600,
  esde_last_played: '2026-02-01T00:00:00Z', started_at: '2026-01-10T00:00:00Z', play_order: 5,
  created_at: '2026-03-01T00:00:00Z', platforms: [plat('kp', 'snes', true)], ss_jeu_id: null, igdb_id: null,
  external_source: null, external_ref: null,
})
const drop = game({
  id: 'd', title: 'Legend of Zelda', description: 'A quest.', developer: 'Someone else', publisher: 'Nintendo',
  genres: ['action', 'RPG'], modes: ['1P'], rating: 6, play_status: 'completed', play_notes: 'theirs',
  esde_playcount: 2, esde_playtime_seconds: 300, esde_last_played: '2026-04-01T00:00:00Z',
  started_at: '2025-12-01T00:00:00Z', finished_at: '2026-04-02T00:00:00Z', play_order: 2, is_coop: true,
  created_at: '2025-06-01T00:00:00Z', primary_cover_url: 'https://x/c.png', media: { 'box-2D': 'u' },
  platforms: [plat('dp', 'gc', true), plat('dp2', 'gc')], ss_jeu_id: '21890', ss_scraped_at: '2026-01-05T00:00:00Z',
  igdb_id: 1022, igdb_slug: 'zelda', ttb_main_seconds: 3600, external_source: 'esde', external_ref: 'ref-1',
})

const m = T.mergeFields(keep, drop)
ok(m.title, 'Zelda (USA)', 'the kept title never changes')
ok(m.id, 'k', 'the kept id stays')
ok(m.description, 'A quest.', 'a blank (spaces only) description is filled')
ok(m.developer, 'Nintendo', 'a filled field is never replaced')
ok(m.publisher, 'Nintendo', 'an empty field is filled')
ok(m.primary_cover_url, 'https://x/c.png', 'an empty cover is filled')
ok(m.genres, ['Action', 'Adventure', 'RPG'], 'genres: case-insensitive union, kept spelling and order first')
ok(m.modes, ['1P'], 'modes: union from nothing')
ok(m.media, { 'box-2D': 'u' }, 'empty media takes the other copy\'s')
ok(m.rating, 8, 'the kept rating stays')
ok(m.play_status, 'completed', 'kept Backlog (the default) yields to a real status')
ok(m.play_notes, 'mine' + T.MERGE_NOTE_SEPARATOR + 'theirs', 'notes are appended below the separator')
ok(m.is_coop, true, 'co-op from either copy')
ok([m.esde_playcount, m.esde_playtime_seconds], [5, 900], 'launches and play time are summed')
ok(m.esde_last_played, '2026-04-01T00:00:00Z', 'the later last-played')
ok(m.started_at, '2025-12-01T00:00:00Z', 'the earlier start')
ok(m.finished_at, '2026-04-02T00:00:00Z', 'the later finish (the kept one had none)')
ok(m.play_order, 2, 'the better queue place')
ok(m.created_at, '2025-06-01T00:00:00Z', 'added: the earlier date')
ok([m.ss_jeu_id, m.ss_scraped_at], ['21890', '2026-01-05T00:00:00Z'], 'the ScreenScraper match moves as a group')
ok([m.igdb_id, m.igdb_slug, m.ttb_main_seconds, m.ttb_extra_seconds], [1022, 'zelda', 3600, null], 'the IGDB match moves as a group')
ok([m.external_source, m.external_ref], ['esde', 'ref-1'], 'the provider reference moves as a pair')
ok(m.play_count, null, 'null + null stays null')

// The kept game's own matches and status win.
const k2 = { ...keep, ss_jeu_id: '1', igdb_id: 5, play_status: 'playing', external_source: 'manual', external_ref: null }
const m2 = T.mergeFields(k2, drop)
ok([m2.ss_jeu_id, m2.ss_scraped_at, m2.igdb_id, m2.ttb_main_seconds], ['1', undefined, 5, undefined], 'kept matches are never replaced')
ok(m2.play_status, 'playing', 'a real kept status stays')
ok([m2.external_source, m2.external_ref], ['manual', null], 'a kept provider reference keeps its own half too')
ok(T.mergeFields({ ...keep, play_status: 'backlog' }, { ...drop, play_status: 'hidden' }).play_status, 'backlog', 'hidden never wins')
ok(T.mergeFields(keep, { ...drop, play_notes: '  ' }).play_notes, 'mine', 'blank other notes add nothing')
ok(T.mergeFields({ ...keep, play_notes: null }, drop).play_notes, 'theirs', 'no kept notes: the other copy\'s')
ok(T.unionList(null, null), null, 'no lists at all stays null')
ok(T.unionList([], ['  ']), [], 'an empty union keeps the kept value')

// The plan: checks and blocks.
const p = T.planMerge(keep, drop)
ok(p.blocked, null, 'two retro copies may merge')
ok(p.movedPlatforms, 2, 'both variants move')
ok(p.primaryAfter, 'snes', 'the kept primary stays primary')
ok(T.planMerge({ ...keep, platforms: [] }, drop).primaryAfter, 'gc', 'no kept primary → the moved primary stays')
ok(p.notes.some(x => /Different platforms/.test(x.text)), true, 'different platforms are explained')
ok(p.notes.some(x => /takes over the other copy's ScreenScraper match \(#21890\)/.test(x.text)), true, 'the match takeover is said')
ok(p.notes.some(x => /Different ratings/.test(x.text)), true, 'differing ratings are flagged')
ok(p.notes.some(x => x.level === 'warn' && /Both have notes/.test(x.text)), true, 'two notes warn')
const p2 = T.planMerge(k2, drop)
ok(p2.notes.some(x => x.level === 'warn' && /Different ScreenScraper matches \(#1 and #21890\)/.test(x.text)), true, 'conflicting ScreenScraper ids warn')
ok(p2.notes.some(x => x.level === 'warn' && /Different IGDB matches/.test(x.text)), true, 'conflicting IGDB ids warn')
const steam = T.planMerge(keep, { ...drop, library: 'steam' })
ok(typeof steam.blocked, 'string', 'a Steam copy blocks the merge')
ok(/Steam sync would add/.test(steam.blocked), true, 'and says why')
ok(steam.offerHide, true, 'and offers hiding instead')
ok(T.planMerge({ ...keep, library: 'playstation' }, drop).blocked != null, true, 'a PlayStation keeper blocks too')
ok(T.planMerge(keep, keep).blocked, 'Pick two different games.', 'a game cannot merge with itself')
ok(T.planMerge(keep, keep).offerHide, false, 'and nothing is hidden then')
ok(T.changedFields(keep, m).includes('title'), false, 'title is never a change')
ok(T.changedFields(keep, m).includes('description'), true, 'a filled field is a change')

// The SQL twin names every rule's columns and the same separator.
const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/131_merge_games.sql'), 'utf8')
for (const f of [...T.FILL_TEXT, ...T.IGDB_FIELDS, 'ss_jeu_id', 'ss_scraped_at', 'genres', 'modes', 'media', 'play_notes', 'game_log',
  'esde_playcount', 'esde_playtime_seconds', 'play_count', 'play_seconds', 'esde_last_played', 'last_played_at', 'started_at',
  'first_played_at', 'finished_at', 'synced_at', 'created_at', 'play_order', 'is_coop', 'is_iconic', 'rating', 'play_status',
  'release_year', 'external_source', 'external_ref']) {
  ok(new RegExp(`\\n\\s+${f}\\s+=`).test(sql), true, `merge_games sets ${f}`)
}
ok(sql.includes("E'\\n\\n— From the merged copy —\\n'"), true, 'the SQL separator matches MERGE_NOTE_SEPARATOR')
ok(T.MERGE_NOTE_SEPARATOR, '\n\n— From the merged copy —\n', 'the separator text')
ok(/library <> 'retro' OR d\.library <> 'retro'/.test(sql), true, 'the SQL refuses non-retro games')
ok(/'playing', 'completed', 'dropped', 'wishlist'/.test(sql), true, 'the SQL status rule names the same real statuses')

// The list view's Length column sorts both ways (unknown last each way).
const L = (id, extra) => ({ ...game({ id, title: id }), ttb_extra_seconds: extra })
const lib = [L('a', null), L('b', 7200), L('c', 3600)]
ok(M.sortGames(lib, 'length').map(g => g.id), ['c', 'b', 'a'], 'Shortest first, unknown last')
ok(M.sortGames(lib, 'length-desc').map(g => g.id), ['b', 'c', 'a'], 'Longest first, unknown last')

console.log(`verify-tg-merge: ${n} assertions passed`)
