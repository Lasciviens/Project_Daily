// Throwaway verification for the Analytics Collection tab's pure helpers
// (src/features/games/test-game/components/tgAnalyticsCollection.ts), run
// against the real tgAnalyticsMore figures they reshape. No unit test
// framework here (CLAUDE.md).
//   node scripts/verify-tg-analytics-collection.cjs
require('sucrase/register')
const assert = require('assert')
const C = require('../src/features/games/test-game/components/tgAnalyticsCollection.ts')
const M = require('../src/features/games/test-game/components/tgAnalyticsMore.ts')

let n = 0
const ok = (a, b, what) => { assert.deepStrictEqual(a, b, what); n++ }
let seq = 0
const game = (over = {}) => ({
  id: 'g' + (++seq), title: over.title ?? 'Game ' + seq, genres: null, play_status: 'backlog', rating: null,
  play_order: null, library: 'retro', play_seconds: null, play_count: null, last_played_at: null,
  started_at: null, finished_at: null, esde_playcount: null, esde_last_played: null, esde_playtime_seconds: null,
  release_year: null, developer: null, publisher: null, players: null, series_name: null,
  platforms: [], platformKey: 'snes', hidden: false, steamAppId: null, notAGame: false, ...over,
})
const scored = s => [{ is_primary_variant: true, rating: s }]

// ── Ratings ──────────────────────────────────────────────────────────────────
ok(C.defaultRatingsView(0), 'community', 'no personal ratings → community first')
ok(C.defaultRatingsView(4), 'community', 'four ratings still draw no shape → community')
ok(C.defaultRatingsView(5), 'yours', 'five ratings → yours first')

const lib = [
  game({ title: 'Top', platforms: scored(95), release_year: 1995 }),
  game({ title: 'Edge 90', platforms: scored(90) }),
  game({ title: 'Edge 89', platforms: scored(89.6) }),
  game({ title: 'Zero', platforms: scored(0) }),
  game({ title: 'Hundred', platforms: scored(100) }),
  game({ title: 'None' }),
]
const series = M.scoreSeries(lib)
const cols = C.scoreColumns(series.buckets)
ok(cols.length, 10, 'ten score columns')
ok(cols.map(c => c.tick), ['0', '10', '20', '30', '40', '50', '60', '70', '80', '90+'], 'axis ticks are the buckets’ lower bounds, the last one open')
ok(cols[0].full, 'Score 0–9', 'tooltip names the whole bucket')
ok(cols[9].full, 'Score 90–100', 'the top bucket holds 100')
ok(cols.reduce((s, c) => s + c.count, 0), series.scored, 'columns add up to the scored count in the meta')
ok(cols[9].count, 3, '90, 95 and 100 share the top bucket')
ok(cols[8].count, 1, '89.6 stays in 80–89 (never rounded up)')
ok(cols.map(c => c.key), series.buckets.map(b => b.key), 'column keys are the bucket keys')
ok(C.fmtScore(89.6), '90', 'a displayed score is rounded')

// ── Worth playing next ───────────────────────────────────────────────────────
ok(C.worthNextSubline(lib[0]), 'SNES · 1995', 'platform · year')
ok(C.worthNextSubline(lib[1]), 'SNES', 'no year → the platform alone')

// ── Platforms by metric ──────────────────────────────────────────────────────
ok(C.platformLegend('games'), null, 'games is one tone — no legend')
ok(C.platformLegend('hours'), null, 'play time is one tone — no legend')
ok(C.platformLegend('played'), { filled: 'Played', rest: 'No recorded play' }, 'played share names both tones honestly')
ok(C.platformLegend('completed').filled, 'Completed', 'completed names its filled tone')
for (const m of M.TGA_PLATFORM_METRICS) ok(typeof C.TGA_PLATFORM_EMPTY[m.key].title, 'string', `an empty state for ${m.key}`)
ok(C.platformOpenLabel('completed', { label: 'PS2' }), 'Show completed PS2 games', 'completed rows land on completed games')
ok(C.platformOpenLabel('hours', { label: 'PS2' }), 'Open the PS2 shelf', 'other rows open the shelf')

// ── Studios ──────────────────────────────────────────────────────────────────
ok(C.studiosMeta(12, 3), '12 studios · 3 with none recorded', 'studios meta with missing')
ok(C.studiosMeta(1, 0), '1 studio', 'singular, nothing missing → no second part')

// ── Release decades ──────────────────────────────────────────────────────────
const dec = M.decadeRows([
  game({ release_year: 1991, play_seconds: 3600 }),
  game({ release_year: 1998 }),
  game({ release_year: 2004, play_seconds: 60 }),
  game({ release_year: null }),
])
const bars = C.decadeBarRows(dec.rows)
ok(bars.map(b => b.label), ['1990s', '2000s'], 'oldest decade first')
ok(bars[0], { key: '1990', label: '1990s', count: 2, part: 1, target: null, title: '1 of 2 played' }, 'owned is the bar, played the filled part, no shelf to open')
ok(bars.every(b => b.target === null), true, 'decade rows are never buttons')
ok(bars.reduce((s, b) => s + b.count, 0) + dec.undated, 4, 'dated plus undated is every game')
ok(C.undatedNote(1), '1 game has no release year', 'undated note, singular')
ok(C.undatedNote(3), '3 games have no release year', 'undated note, plural')

// ── Players ──────────────────────────────────────────────────────────────────
ok(C.unknownPlayersNote(1), '1 game doesn’t say how many can play', 'players note, singular')
ok(C.unknownPlayersNote(2), '2 games don’t say how many can play', 'players note, plural')

// ── Series ───────────────────────────────────────────────────────────────────
ok(C.seriesLine({ key: 'z', label: 'Zelda', games: 3, played: 2, completed: 1 }), '1 of 3 completed · 2 played', 'series line')
ok(C.seriesShareNote(0.2), null, 'no nudge at 20%')
ok(C.seriesShareNote(0.5), null, 'no nudge above 20%')
ok(C.seriesShareNote(0.15), 'Only 15% of games have a series recorded — ScreenScraper fills more as you scrape.', 'nudge below 20%')
ok(C.seriesShareNote(0.004).startsWith('Only <1% '), true, 'a tiny share never reads as 0%')

// ── Layout ───────────────────────────────────────────────────────────────────
// Simulates the grid: each card's order and span at a breakpoint (the latest
// variant at or below it wins), then packs rows. Every row must be whole and
// hold cards of one height class, so no short card stands beside a tall one.
const BPS = ['@2xl', '@[62rem]', '@[100rem]']
const esc = b => b.replace(/[[\]@]/g, '\\$&')
const pick = (cls, bp, what) => {
  let v = what === 'span' ? 1 : 0
  for (const b of BPS.slice(0, BPS.indexOf(bp) + 1)) {
    const m = cls.match(new RegExp(esc(b) + ':' + (what === 'span' ? 'col-span' : 'order') + '-(\\d)'))
    if (m) v = Number(m[1])
  }
  return v
}
const CARDS = ['ratings', 'worth', 'platforms', 'genres', 'studios', 'decades', 'players', 'series']
const TALL = new Set(['platforms', 'genres', 'studios', 'series'])
const rowsOf = (layout, bp, cols, cards) => {
  const placed = cards.map((k, i) => ({ k, i, order: pick(layout[k], bp, 'order'), span: pick(layout[k], bp, 'span') }))
    .sort((a, b) => a.order - b.order || a.i - b.i)
  const rows = []; let row = [], used = 0
  for (const c of placed) {
    if (used + c.span > cols) { rows.push(row); row = []; used = 0 }
    row.push(c.k); used += c.span
  }
  if (row.length) rows.push({ cards: row, open: cols - used })
  return rows.map(r => (Array.isArray(r) ? { cards: r, open: 0 } : r))
}
for (const [hasSeries, cards] of [[true, CARDS], [false, CARDS.filter(k => k !== 'series')]]) {
  const layout = C.collectionLayout(hasSeries)
  for (const [bp, cols] of [['@2xl', 2], ['@[62rem]', 3], ['@[100rem]', 4]]) {
    const rows = rowsOf(layout, bp, cols, cards)
    ok(rows.every(r => r.open === 0), true, `${hasSeries ? 'with' : 'no'} Series at ${cols} columns: whole rows (${rows.map(r => r.cards.join('+')).join(' | ')})`)
    if (cols > 2) {
      // The one mixed row: Series spans two columns there and lays its list out in two, halving its height to Players'.
      const fine = r => r.cards.every(k => TALL.has(k)) || r.cards.every(k => !TALL.has(k)) || r.cards.join('+') === 'players+series'
      ok(rows.every(fine), true,
        `${hasSeries ? 'with' : 'no'} Series at ${cols} columns: each row is all short or all tall (${rows.map(r => r.cards.join('+')).join(' | ')})`)
    }
  }
}
ok(rowsOf(C.collectionLayout(true), '@[100rem]', 4, CARDS).map(r => r.cards), [['ratings', 'worth', 'decades', 'players'], ['platforms', 'genres', 'studios', 'series']], 'four columns: short cards first, then the ranked lists')

console.log(`verify-tg-analytics-collection: ${n} assertions passed`)
