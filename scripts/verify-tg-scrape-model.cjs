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
eq(M.formForGame(game({ external_source: 'screenscraper', external_ref: '5' })).jeuId, '5', 'a matched game prefills its id')
eq(M.formForGame(null), M.EMPTY_FORM, 'no game → empty form')
eq(M.romFilled(f), 1, 'filename counts as ROM info')
eq(M.formToRom({ ...f, crc: 'F9394E97', size: '524288' }), { filename: 'Sonic The Hedgehog (USA, Europe).md', size: 524288, crc: 'F9394E97', md5: null, sha1: null, serial: null }, 'form → ROM query')
eq(M.formToRom(M.EMPTY_FORM), null, 'no ROM info → null')
eq(M.formProblem(M.EMPTY_FORM), 'Type a name, add ROM info, or enter a ScreenScraper id.', 'empty form cannot search')
eq(M.formProblem({ ...M.EMPTY_FORM, name: 'x', useName: false }), 'Type a name, add ROM info, or enter a ScreenScraper id.', 'a switched-off name does not count')
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
    { type: 'mixrbv1', region: null, token: 'mixrbv1', ep: 'img', size: 100 },
  ],
  names: [], synopses: [], flags: [],
}
ok(M.isExact(cand) && !M.isExact({ matched_by: ['name'] }), 'exact = found by more than a name')
eq(M.candidateLine(cand), 'Megadrive · 1991 · SEGA', 'result line')
eq(M.mediaCount(cand), '6 files', 'file count')

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
eq(mrows.map(r => r.type), ['box-2D', 'ss', 'mixrbv1', 'manuel', 'flyer'], 'catalogue order, unknown types last')
eq(mrows[0].chosen.region, 'eu', 'region order picks the EU box')
eq(mrows.find(r => r.type === 'manuel').mode, 'on_demand', 'a manual defaults to Link')
eq(mrows.find(r => r.type === 'mixrbv1').mode, 'skip', 'composites default to Skip')
eq(mrows.find(r => r.type === 'flyer').mode, 'on_demand', 'an unknown type is linkable')
ok(!mrows.find(r => r.type === 'manuel').canStore, 'a manual can never be saved')
eq(M.groupMediaRows(mrows).map(g => g.key), ['box', 'screens', 'art', 'extras', 'documents'], 'groups keep catalogue order')
eq(M.mediaRows(cand, { ...prefs, media: { manuel: 'store' } }).find(r => r.type === 'manuel').mode, 'on_demand', 'store is never offered for a manual')

// ── Summary ──
const plan = mrows.map(r => ({ row: r, mode: r.mode, entry: r.chosen }))
const choices = Object.fromEntries(rows.map(r => [r.field, M.initialChoice(r, prefs.fields[r.field])]))
const s = M.applySummary(rows, choices, plan, 1)
eq([s.store, s.onDemand, s.skip], [2, 2, 1], 'modes counted')
ok(s.bytes > 0 && s.bytes < 200_000, 'stored bytes estimated from capped sizes')
eq(M.estimateStored({ type: 'ss', size: 3000 }, 1), 3000, 'a small original is not inflated')
eq(M.estimateStored({ type: 'box-2D', size: 900000 }, 1), 70000, 'a big original is capped at the resized typical size')
ok(M.summaryText(s).includes('saves 2 images'), 'summary text')
eq(M.summaryText({ fields: 0, store: 0, onDemand: 0, skip: 3, bytes: 0 }), 'Nothing selected to save', 'empty summary')
eq([M.formatBytes(512), M.formatBytes(2048), M.formatBytes(5 * 1024 * 1024), M.formatBytes(null)], ['512 B', '2 KB', '5.0 MB', '—'], 'formatBytes')
eq([M.display(null), M.display(['a', 'b']), M.display(80), M.display(7.25)], ['—', 'a, b', '80', '7.3'], 'display')

if (failures.length) {
  console.error(`✗ ${failures.length} failed, ${passed} passed\n`)
  for (const x of failures) console.error('  ✗ ' + x)
  process.exit(1)
}
console.log(`✓ verify-tg-scrape-model: ${passed} assertions passed`)
