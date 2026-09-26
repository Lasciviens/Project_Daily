// Throwaway verification for the Analytics "Data health" wording
// (src/features/games/test-game/components/tgAnalyticsHealthCopy.ts), checked
// against the real figures from tgAnalyticsHealth.ts. No unit test framework
// in this repo (CLAUDE.md).
//   node scripts/verify-tg-analytics-health.cjs
require('sucrase/register')
const assert = require('assert')
const C = require('../src/features/games/test-game/components/tgAnalyticsHealthCopy.ts')
const H = require('../src/features/games/test-game/components/tgAnalyticsHealth.ts')

let n = 0
const ok = (a, b, what) => { assert.deepStrictEqual(a, b, what); n++ }
const field = (over = {}) => ({ key: 'description', label: 'Description', filled: 10, total: 20, fix: 'scrape-no-desc', ...over })

// ── coveragePct: never 100% while a game misses the field, never 0% once one has it ──
ok(C.coveragePct(0, 0), '0%', 'no games → 0%')
ok(C.coveragePct(0, 50), '0%', 'none filled → 0%')
ok(C.coveragePct(50, 50), '100%', 'all filled → 100%')
ok(C.coveragePct(1029, 1030), '>99%', '99.9% never rounds up to 100%')
ok(C.coveragePct(1, 1030), '<1%', 'one of many → <1%')
ok(C.coveragePct(412, 1030), '40%', 'plain share')
ok(C.coveragePct(60, 50), '100%', 'over-full still reads 100%')

// ── coverageFix: what a row hands off to ──
ok(C.coverageFix(field({ filled: 20 }), 20), null, 'complete field → no action')
ok(C.coverageFix(field({ fix: null, key: 'esde' }), 20), null, 'no tool fills it → no action')
ok(C.coverageFix(field(), 20).filter, 'no_desc', 'descriptions → batch "No description"')
ok(C.coverageFix(field({ key: 'cover', fix: 'scrape-no-cover' }), 20).filter, 'no_cover', 'cover → batch "No cover"')
ok(C.coverageFix(field({ key: 'genres', fix: 'scrape-any' }), 20).filter, 'todo', 'other fields → batch "Not scraped"')
ok(C.coverageFix(field({ fix: 'review' }), 20).kind, 'review', 'review fix → Needs review')
ok(C.coverageFix(field({ key: 'cover', fix: 'scrape-no-cover' }), 0), null, 'no retro games → no ScreenScraper hand-off')
ok(C.coverageFix(field({ fix: 'review' }), 0).kind, 'review', 'Needs review works without retro games')
ok(C.coverageFix(field(), 20).name, 'Fill missing descriptions with ScreenScraper', 'accessible name')

// ── coverage notes ──
ok(C.coverageMeta(0), undefined, 'no meta without retro games')
ok(C.coverageMeta(1030), 'retro fields over 1,030 retro games', 'meta')
ok(C.coverageMeta(1), 'retro fields over 1 retro game', 'meta, singular')
ok(C.coverageScopeNote([field({ key: 'cover', total: 1500 })], 1030) != null, true, 'cover counts more games than retro → note')
ok(C.coverageScopeNote([field({ key: 'cover', total: 1030 })], 1030), null, 'retro-only library → no note')
ok(/Only cover art/.test(C.coverageScopeNote([field({ key: 'cover', total: 300 })], 0)), true, 'no retro games → cover is the only row')
ok(C.coverageFootnote([field({ key: 'esde', filled: 900, total: 1000, fix: null })]) != null, true, 'ES-DE gap → Termux hint')
ok(C.coverageFootnote([field({ key: 'esde', filled: 1000, total: 1000, fix: null })]), null, 'ES-DE complete → no hint')

// ── Needs review ──
ok(C.reviewHeadline(1), 'game needs a look', 'singular')
ok(C.reviewHeadline(3), 'games need a look', 'plural')
ok(C.reviewOverlap({ games: 3, reasons: [{ count: 2 }, { count: 2 }] }) != null, true, 'rows sum past the games → overlap note')
ok(C.reviewOverlap({ games: 4, reasons: [{ count: 2 }, { count: 2 }] }), null, 'rows sum to the games → no note')

// ── ES-DE images ──
ok(C.assetCategoryLabel('covers'), 'Covers', 'covers')
ok(C.assetCategoryLabel('3dboxes'), '3D boxes', '3dboxes')
ok(C.assetCategoryLabel('titlescreens'), 'Title screens', 'titlescreens')
ok(C.assetCategoryLabel('physicalmedia'), 'Physical media', 'physicalmedia')
ok(C.assetCategoryLabel(' MIXIMAGES '), 'Mix images', 'case and spaces ignored')
ok(C.assetCategoryLabel('box_sides'), 'Box sides', 'unknown category keeps its own words')
ok(C.assetCategoryLabel(''), 'Other', 'empty → Other')
const gb = n => `${(n / 1024 ** 3).toFixed(1)} GB`
ok(C.assetHeadline({ images: 9612, bytes: 5.2 * 1024 ** 3, games: 944 }, gb), 'images · 5.2 GB on 944 games', 'headline')
ok(C.assetHeadline({ images: 1, bytes: 0, games: 1 }, gb), 'image on 1 game', 'no size recorded → size left out')
ok(C.mirroredLine(1), '1 game also has ScreenScraper artwork mirrored.', 'mirrored, singular')
ok(C.mirroredLine(12), '12 games also have ScreenScraper artwork mirrored.', 'mirrored, plural')

// Against the real tally: every category label is readable, and the headline's
// numbers are the inventory's own.
const asset = (category, size) => ({ category, size, sha256: 'x', mime: 'image/png', url: 'u' })
const games = [
  { id: 'a', media: { 'box-2D': {} }, platforms: [{ esde_assets: { 1: asset('covers', 1000), 2: asset('3dboxes', 3000) } }] },
  { id: 'b', media: {}, platforms: [{ esde_assets: { 3: asset('covers', 500) } }, { esde_assets: {} }] },
  { id: 'c', media: null, platforms: [] },
]
const inv = H.assetInventory(games)
ok(inv.images, 3, 'inventory: images')
ok(inv.games, 2, 'inventory: games with any image')
ok(inv.mirrored, 1, 'inventory: mirrored')
ok(inv.categories.map(c => C.assetCategoryLabel(c.category)), ['3D boxes', 'Covers'], 'biggest category first, readable names')

// ── Sources ──
const today = new Date(2026, 8, 26).getTime() // local midnight
const at = (d, h) => new Date(2026, 8, d, h).toISOString()
ok(C.syncDaysAgo(null, today), null, 'no stamp')
ok(C.syncDaysAgo('garbage', today), null, 'unreadable stamp')
ok(C.syncDaysAgo(at(26, 9), today), 0, 'this morning → today')
ok(C.syncDaysAgo(at(25, 23), today), 1, 'last night → yesterday, not today')
ok(C.syncDaysAgo(at(25, 0), today), 1, 'yesterday at midnight → yesterday')
ok(C.syncDaysAgo(at(23, 10), today), 3, 'three calendar days')
ok(C.syncAgo(null, today), 'No sync recorded', 'wording: none')
ok(C.syncAgo(at(26, 9), today), 'Last sync today', 'wording: today')
ok(C.syncAgo(at(25, 22), today), 'Last sync yesterday', 'wording: yesterday')
ok(C.syncAgo(at(23, 10), today), 'Last sync 3 days ago', 'wording: days')
ok(C.syncAgo(new Date(2026, 5, 1, 12).toISOString(), today), 'Last sync 3 months ago', 'wording: months')
ok(C.syncAgo(new Date(2023, 5, 1, 12).toISOString(), today), 'Last sync over 3 years ago', 'wording: years')

// The tone follows the model's own stale flag.
const rows = H.freshness([
  { library: 'retro', synced_at: at(25, 23) },
  { library: 'steam', synced_at: at(10, 12) },
  { library: 'playstation', synced_at: null },
], today)
const by = Object.fromEntries(rows.map(r => [r.library, r]))
ok(C.sourceTone(by.retro), 'ok', 'fresh retro → ok')
ok(C.sourceTone(by.steam), 'warn', 'two weeks → amber')
ok(C.sourceTone(by.playstation), 'bad', 'no stamp → red')
ok(C.sourceTone({ stale: true, lastSync: at(1, 12), days: 31 }), 'bad', 'over a month → red')
ok(C.syncAgo(by.retro.lastSync, today), 'Last sync yesterday', 'a sync last night the model counts as 0 days reads as yesterday')
ok(C.sourceFix('retro').kind, 'hint', 'retro → handheld hint')
ok(C.sourceFix('steam'), { kind: 'shelf', label: 'Sync from the shelf', name: 'Open the Steam shelf to sync it' }, 'steam → shelf')
ok(C.sourceFix('playstation').kind, 'shelf', 'playstation → shelf')

console.log(`verify-tg-analytics-health: ${n} assertions passed`)
