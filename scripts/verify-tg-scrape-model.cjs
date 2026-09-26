#!/usr/bin/env node
/**
 * verify-tg-scrape-model.cjs — the Scrape page's pure decisions
 * (src/features/games/test-game/components/scrape/tgScrapeModel.ts) against
 * the real modules, through sucrase (no test framework in this repo).
 *
 *   node scripts/verify-tg-scrape-model.cjs
 */
require('sucrase/register')
const M = require('../src/features/games/test-game/components/scrape/tgScrapeModel.ts')
const P = require('../src/features/games/scraper/ssPlan.ts')

let passed = 0
const failures = []
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) passed++
  else failures.push(`${label}\n    expected ${e}\n    actual   ${a}`)
}
const ok = (c, l) => eq(!!c, true, l)

const platform = (o = {}) => ({ id: 'p1', is_primary_variant: true, esde_system: 'genesis', esde_path: './Sonic The Hedgehog (USA, Europe).md', release_date: null, region: null, rating: null, ...o })
const game = (o = {}) => ({
  id: 'g1', title: 'Sonic The Hedgehog (USA, Europe)', description: null, release_year: 1991, publisher: 'SEGA', developer: null,
  genres: [], modes: null, players: '1', age_rating: null, series_name: null, primary_cover_url: 'https://x/cover.webp',
  screenshot_url: null, fanart_url: null, external_source: 'esde', external_ref: null, platforms: [platform()], ...o,
})

// ── Search form ──
eq(M.cleanSearchName('Sonic The Hedgehog (USA, Europe) [!]'), 'Sonic The Hedgehog', 'region and dump tags stripped')
eq(M.cleanSearchName('Contra III [Hack by X] (MSU1)'), 'Contra III', 'every bracket group stripped')
let f = M.formForGame(game())
eq([f.name, f.system, f.filename, f.jeuId], ['Sonic The Hedgehog', 'genesis', 'Sonic The Hedgehog (USA, Europe).md', ''], 'form from a game')
eq(M.formForGame(game({ external_source: 'screenscraper', external_ref: '5' })).jeuId, '5', 'an old-scraper match prefills its id')
eq(M.formForGame(game({ ss_jeu_id: '77' })).jeuId, '77', 'the ss_jeu_id marker prefills its id')
ok(M.isScraped({ external_source: 'esde', ss_jeu_id: '77' }) && !M.isScraped({ external_source: 'esde' }), 'scraped = ss_jeu_id (never external_source, which ES-DE owns)')
eq(M.formForGame(null), { ...M.EMPTY_FORM, useRom: false }, 'no game → empty form, name search only')
eq(M.romFilled(f), 1, 'filename counts as ROM info')
eq(M.formToRom({ ...f, crc: 'F9394E97', size: '524288' }), { filename: 'Sonic The Hedgehog (USA, Europe).md', size: 524288, crc: 'F9394E97', md5: null, sha1: null, serial: null }, 'form → ROM query')
eq(M.formToRom(M.EMPTY_FORM), null, 'no ROM info → null')
eq(M.formProblem(M.EMPTY_FORM), 'Type a name to search for.', 'empty form cannot search')
eq(M.formProblem({ ...M.EMPTY_FORM, name: 'x', useName: false }), 'Add ROM info (a file name, a hash or an id) — or search by name.', 'a switched-off name does not count')
eq(M.formProblem({ ...M.EMPTY_FORM, crc: 'zz' }), 'Fix the highlighted ROM info first.', 'an invalid hash blocks the search')
eq(M.formProblem({ ...M.EMPTY_FORM, jeuId: '5' }), null, 'an id alone can search')

// ── Candidate helpers ──
const cand = {
  jeu_id: '5', matched_by: ['filename', 'name'], system: { id: 1, name: 'Megadrive' },
  values: { title: 'Sonic The Hedgehog', description: 'Fast', release_year: 1991, publisher: 'SEGA', genres: ['Platform'], players: '1', rating: 80, release_date: '1991-06-23' },
  media: [
    { type: 'box-2D', region: 'us', token: 'box-2D(us)', ep: 'img', size: 900000 },
    { type: 'box-2D', region: 'eu', token: 'box-2D(eu)', ep: 'img', size: 800000 },
    { type: 'ss', region: null, token: 'ss', ep: 'img', size: 3000 },
    { type: 'manuel', region: 'eu', token: 'manuel(eu)', ep: 'manual', size: 2500000 },
    { type: 'flyer', region: null, token: 'flyer', ep: 'img', size: null },
    { type: 'mystery-type', region: null, token: 'mystery-type', ep: 'img', size: null },
    { type: 'mixrbv1', region: null, token: 'mixrbv1', ep: 'img', size: 100 },
  ],
  names: [], synopses: [], flags: [],
}
ok(M.isExact(cand) && !M.isExact({ matched_by: ['name'] }), 'exact = found by more than a name')
eq(M.candidateLine(cand), 'Megadrive · 1991', 'result line: system · year')
eq(M.mediaCount(cand), '7 images & files', 'file count')

// ── Field review ──
const rows = M.fieldRows(game(), cand)
const row = f => rows.find(r => r.field === f)
eq([row('description').currentEmpty, row('description').theirsEmpty], [true, false], 'empty field vs a value')
ok(row('publisher').same, 'identical value detected')
eq(row('cover').theirs, 'box-2D', 'cover: theirs is the media type when a file exists')
eq(row('fanart').theirsEmpty, true, 'no fanart file → nothing to offer')
eq(row('rating').current, null, 'platform field read from the primary variant')
const prefs = P.defaultPrefs()
eq(M.initialChoice(row('description'), 'fill'), 'fill', 'fill an empty field')
eq(M.initialChoice(row('title'), 'fill'), 'keep', 'fill never touches a filled field')
eq(M.initialChoice(row('title'), 'replace'), 'replace', 'replace policy → Replace')
eq(M.initialChoice(row('publisher'), 'replace'), 'keep', 'same value → Keep')
eq(M.initialChoice(row('fanart'), 'fill'), 'keep', 'nothing offered → Keep')
ok(M.writes(row('description'), 'fill'), 'fill writes an empty field')
ok(!M.writes(row('title'), 'fill') && M.writes(row('title'), 'replace'), 'replace writes, fill does not, on a filled field')
ok(!M.writes(row('cover'), 'replace', 'on_demand') && M.writes(row('cover'), 'replace', 'store'), 'an image field writes only when its media is saved')
eq(M.choiceToPolicy('keep'), 'skip', 'Keep = skip')

// ── Media review ──
const mrows = M.mediaRows(cand, prefs)
eq(mrows.map(r => r.type), ['box-2D', 'ss', 'mixrbv1', 'flyer', 'manuel', 'mystery-type'], 'catalogue order, unknown types last')
eq(mrows[0].chosen.region, 'eu', 'region order picks the EU box')
eq(mrows.find(r => r.type === 'manuel').mode, 'on_demand', 'a manual defaults to Link')
eq(mrows.find(r => r.type === 'mixrbv1').mode, 'skip', 'composites default to Skip')
eq(mrows.find(r => r.type === 'mystery-type').mode, 'on_demand', 'an unknown image type is shown online')
ok(!mrows.find(r => r.type === 'manuel').canStore, 'a manual can never be saved')
eq(M.groupMediaRows(mrows).map(g => g.key), ['box', 'screens', 'art', 'extras', 'documents'], 'groups keep catalogue order')
eq(M.mediaRows(cand, { ...prefs, media: { manuel: 'store' } }).find(r => r.type === 'manuel').mode, 'on_demand', 'store is never offered for a manual')

// ── Summary ──
const plan = mrows.map(r => ({ row: r, mode: r.mode, entry: r.chosen }))
const choices = Object.fromEntries(rows.map(r => [r.field, M.initialChoice(r, prefs.fields[r.field])]))
const s = M.applySummary(rows, choices, plan, 1)
eq([s.store, s.onDemand, s.skip], [2, 3, 1], 'modes counted')
ok(s.bytes > 0 && s.bytes < 200_000, 'stored bytes estimated from capped sizes')
eq(M.estimateStored({ type: 'ss', size: 3000 }, 1), 3000, 'a small original is not inflated')
eq(M.estimateStored({ type: 'box-2D', size: 900000 }, 1), 70000, 'a big original is capped at the resized typical size')
ok(/2 images copied \(≈ .+\) · 3 shown online/.test(M.summaryText(s)), 'summary text')
eq(M.summaryText({ fields: 0, store: 0, onDemand: 0, skip: 3, bytes: 0 }), 'Nothing selected to save', 'empty summary')
eq([M.formatBytes(512), M.formatBytes(2048), M.formatBytes(5 * 1024 * 1024), M.formatBytes(null)], ['512 B', '2 KB', '5.0 MB', '—'], 'formatBytes')
eq([M.display(null), M.display(['a', 'b']), M.display(80), M.display(7.25)], ['—', 'a, b', '80', '7.3'], 'display')

// ── Journal: only the newest apply of a game can be undone ──
const J = require('../src/features/games/scraper/ssJournal.ts')
const jr = (id, run, game, decision, at, undid) => ({ id, run_id: run, game_id: game, decision, matched_title: 'T', created_at: at, written_values: undid ? { undid } : {} })
const rows1 = [
  jr('a1', 'r1', 'g1', 'applied', '2026-09-01T10:00:00Z'),
  jr('a2', 'r2', 'g1', 'applied', '2026-09-02T10:00:00Z'),
  jr('u2', 'r2', 'g1', 'undone', '2026-09-03T10:00:00Z', 'a2'),
  jr('b1', 'r2', 'g2', 'applied', '2026-09-02T10:00:00Z'),
]
eq(J.undoableApplies(rows1).has('g1'), false, 'after undoing the newest apply, the older one does NOT become undoable (its copies are gone)')
eq(J.undoableApplies(rows1).get('g2').id, 'b1', 'another game of the same run is still undoable')
const rows2 = [
  jr('c1', 'r3', 'g3', 'applied', '2026-09-01T10:00:00Z'),
  jr('c2', 'r3', 'g3', 'applied', '2026-09-01T11:00:00Z'),
  jr('uc1', 'r3', 'g3', 'undone', '2026-09-01T12:00:00Z', 'c1'),
]
eq(J.undoableApplies(rows2).get('g3').id, 'c2', 'undone is per row: undoing an older apply of the same run leaves the newer one undoable')
const legacy = [jr('d1', 'r4', 'g4', 'applied', '2026-09-01T10:00:00Z'), jr('ud', 'r4', 'g4', 'undone', '2026-09-01T11:00:00Z')]
eq(J.undoableApplies(legacy).has('g4'), false, 'an old undone row (no id) still undoes its run')
const runs = J.recentRuns(rows1)
eq(runs.map(r => [r.run_id, r.undoable, r.games.length]), [['r2', 1, 2], ['r1', 0, 1]], 'recent runs: newest first, with what can still be undone')

// ── Field rows follow what the server writes ──
const pr = (o = {}) => platform({ esde_assets: { a: { category: 'fanart', url: 'https://x/esde-fan.jpg', sha256: 'x', size: 1, mime: 'image/jpeg' } }, ...o })
const cm = { ...cand, media: [...cand.media, { type: 'fanart', region: null, token: 'fanart', ep: 'img', size: 5000 }], matched_by: ['name'], values: { ...cand.values, region: 'eu', version_title: 'Rev A' } }
const rowsH = M.fieldRows(game({ platforms: [pr()] }), cm)
const fan = rowsH.find(r => r.field === 'fanart')
eq([fan.fromHandheld, fan.currentEmpty, fan.current], [true, false, 'https://x/esde-fan.jpg'], 'fan art the handheld shows is yours (Replace, never a silent Fill)')
eq(M.initialChoice(fan, 'fill'), 'keep', 'fill leaves a handheld picture alone')
eq(rowsH.find(r => r.field === 'region').theirsEmpty, true, 'a name match offers no dump region (the server would drop it)')
eq(rowsH.find(r => r.field === 'rom_status').theirsEmpty, true, 'ROM verified only from a hash')
const rowsX = M.fieldRows(game({ platforms: [pr()] }), { ...cm, matched_by: ['hash'] })
eq([rowsX.find(r => r.field === 'region').theirs, rowsX.find(r => r.field === 'rom_status').theirs], ['eu', 'verified'], 'a hash match offers the region and ROM verified')
eq(M.handheldCategories(game({ platforms: [pr()] })), ['fanart'], 'the handheld categories of the primary copy')
ok(M.summaryText({ fields: 1, store: 2, onDemand: 0, skip: 0, bytes: 1000 }, 'budget').includes('online where the budget is full'), 'the save bar says when the budget blocks copies')

if (failures.length) {
  console.error(`✗ ${failures.length} failed, ${passed} passed\n`)
  for (const x of failures) console.error('  ✗ ' + x)
  process.exit(1)
}
console.log(`✓ verify-tg-scrape-model: ${passed} assertions passed`)
