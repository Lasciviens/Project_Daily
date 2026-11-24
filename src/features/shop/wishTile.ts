// A wish's picture tile: which one belt it wears, where today's price sits in
// its history, and the designed face of a thing with no picture. Pure —
// scripts/verify-shop-suggestions.cjs.
import type { Tone } from '../../shared/ui/Tone'
import { addDays } from './ownModel'
import { currencyOf, listOf, localDay, watchedPrice, type Money } from './shopModel'
import type { ShopItem, ShopPriceStats, ShopPriceWatch } from './types'

/** One belt per tile, the first that holds in this order. */
export type BeltKind = 'at_target' | 'lowest' | 'back' | 'deal' | 'need'
export const BELT_ORDER: readonly BeltKind[] = ['at_target', 'lowest', 'back', 'deal', 'need']
export const BELT: Record<BeltKind, { label: string; tone: Tone }> = {
  at_target: { label: 'At target', tone: 'success' },
  lowest:    { label: '60-day low', tone: 'success' },
  back:      { label: 'Restocked', tone: 'success' },
  deal:      { label: 'Deal on', tone: 'warn' },
  need:      { label: 'Need it', tone: 'highlight' },
}

/**
 * A read whose price is a new offer's or a shop's own page's (migration 188's
 * `condition`). Prisjakt's mixed figures, and any read from before 188, may be
 * a used or refurbished price: they never make a wish "at target" or "lowest".
 */
export function isClean(read: { condition?: ShopPriceWatch['condition'] | null }): boolean {
  return read.condition === 'new' || read.condition === 'unknown'
}

/**
 * The price read from the row's link — none for a link whose site refuses
 * automated reading (`not_allowed`: never read, so whatever it holds is from
 * before and no price now).
 */
export function readPrice(item: Pick<ShopItem, 'url'>, watch: ShopPriceWatch | null | undefined): Money | null {
  return watch && watch.status !== 'not_allowed' ? watchedPrice(item, watch) : null
}

/** The price read from the row's link when it is clean, else null. */
export function cleanPrice(item: Pick<ShopItem, 'url'>, watch: ShopPriceWatch | null | undefined): Money | null {
  return watch && isClean(watch) ? readPrice(item, watch) : null
}

/**
 * What a wish's clean price history says (usePriceStats, migration 190): its
 * lowest and highest clean price ever and over the last 60 days with how many
 * reads, how far back the 60 days' reads reach, and whether its last read is
 * in stock again after one that was not (and since when).
 */
export interface PriceFacts {
  currency: string
  lowAll: number | null
  highAll: number | null
  readsAll: number
  low60: number | null
  high60: number | null
  reads60: number
  /** The day of the first clean read in the 60 days — where the window's history really starts (null: none). */
  since60: string | null
  backInStock: boolean
  restockedAt: string | null
}

/** How far back "Lowest in 60 days" and the "before" price check look. */
export const WINDOW_DAYS = 60
/** shop_price_stats' figures for one thing as PriceFacts, seen from `today`. */
export function factsOf(stats: ShopPriceStats): PriceFacts {
  return {
    currency: (stats.currency ?? '').toUpperCase(),
    lowAll: stats.low_all, highAll: stats.high_all, readsAll: stats.points,
    low60: stats.low_60d, high60: stats.high_60d, reads60: stats.points_60d,
    since60: stats.first_60d ? localDay(stats.first_60d) : null,
    backInStock: stats.back_in_stock, restockedAt: stats.restocked_at,
  }
}

/**
 * The wishes whose price history is read (usePriceStats, one call): those
 * still to buy with a web link, never a general wish's model; sorted, so the
 * Wishlist and Needs a look ask with the same ids.
 */
export function watchedWishIds(items: readonly ShopItem[]): string[] {
  return items
    .filter(i => listOf(i) === 'wishlist' && i.status === 'wishlist' && !i.option_for && i.kind !== 'general' && /^https?:\/\//i.test(i.url ?? ''))
    .map(i => i.id)
    .sort()
}

/** The lowest and highest clean price ever read from a row's link, and how many reads. */
export interface PriceSpan { low: number; high: number; reads: number; currency: string }

/** The history's span — null unless there is one: two clean reads or more that differ. */
export function spanOf(f: PriceFacts | null | undefined): PriceSpan | null {
  if (!f || !f.currency || f.lowAll == null || f.highAll == null || f.readsAll < 2 || !(f.highAll > f.lowAll)) return null
  return { low: f.lowAll, high: f.highAll, reads: f.readsAll, currency: f.currency }
}

/** Where `now` sits between the lowest (0) and the highest (1) seen. */
export function spanPosition(now: number, span: PriceSpan): number {
  return Math.min(1, Math.max(0, (now - span.low) / (span.high - span.low)))
}

/** The clean price read from the row's link is at or under its target (the same currency only; a typed price never counts). */
export function atTarget(item: ShopItem, watch: ShopPriceWatch | null | undefined): boolean {
  const now = cleanPrice(item, watch)
  return !!now && item.target_price != null && now.currency === currencyOf(item) && now.amount <= item.target_price
}

/**
 * Today's clean read is the lowest of the last 60 days' (which have seen it higher): the one "lowest" rule, for
 * the tile's belt and Needs a look's row alike ("60-day low").
 */
export function lowestIn60(now: Money | null, f: PriceFacts | null | undefined): boolean {
  return !!now && !!f && f.low60 != null && f.high60 != null && f.reads60 >= 2 && f.high60 > f.low60
    && now.currency === f.currency && now.amount <= f.low60
}

/**
 * The shop's "before" price (`was`) is above every clean price read in the
 * last 60 days, and those reads reach back a month at least: a "before" the
 * link never showed.
 */
export function fakeBefore(item: Pick<ShopItem, 'url'>, watch: ShopPriceWatch | null | undefined, f: PriceFacts | null | undefined, today: string): boolean {
  const now = cleanPrice(item, watch)
  return !!now && !!f && watch?.was != null && f.high60 != null && f.since60 != null && f.since60 <= addDays(today, -30)
    && now.currency === f.currency && watch.was > f.high60
}

/** Back in stock: the last read has it again, right after one without (and the price now is clean and in stock). */
export function backInStock(item: Pick<ShopItem, 'url'>, watch: ShopPriceWatch | null | undefined, f: PriceFacts | null | undefined): boolean {
  return !!f?.backInStock && !!cleanPrice(item, watch) && watch?.in_stock !== false
}

/** Waiting for a deal that has started (or has no start day). */
export function dealOn(item: Pick<ShopItem, 'wait_for_deal' | 'planned_date'>, today: string): boolean {
  return !!item.wait_for_deal && (!item.planned_date || item.planned_date <= today)
}

/** The tile's one belt: at target · 60-day low · restocked · deal on · need it, or none. */
export function beltOf(item: ShopItem, ctx: { watch?: ShopPriceWatch | null; facts?: PriceFacts | null; today: string }): BeltKind | null {
  const one = item.kind !== 'general'
  const holds: Record<BeltKind, () => boolean> = {
    at_target: () => one && atTarget(item, ctx.watch),
    lowest:    () => one && lowestIn60(cleanPrice(item, ctx.watch), ctx.facts),
    back:      () => one && backInStock(item, ctx.watch, ctx.facts),
    deal:      () => dealOn(item, ctx.today),
    need:      () => item.reason === 'need',
  }
  return BELT_ORDER.find(k => holds[k]()) ?? null
}

/** "CG" for "Coffee grinder": the first letter or digit of the first two words. */
export function initialsOf(title: string): string {
  const words = title.trim().split(/\s+/).map(w => w.match(/[\p{L}\p{N}]/u)?.[0] ?? '').filter(Boolean)
  return words.slice(0, 2).join('').toLocaleUpperCase('en') || '?'
}

/**
 * Every picture tile in the Shop is one size — the Wishlist's tiles and Owned's big-picture cards alike (owner, 24.11.2026:
 * "Every box should have the same exact size!"): from a 40rem list exactly `TILE_REM` wide, a fixed grid track (never
 * `minmax` or `1fr`: those made tiles of different widths in grids of different widths), and below it two to a row, equal.
 * The height is fixed by the tile's parts (`WishTile`, `GeneralWishTile`, `OwnedCard`). One gap everywhere.
 */
export const TILE_REM = 12
export const TILE_GAP_REM = 0.625
/** Below this list width the tiles are two to a row (a phone); from it they are `TILE_REM` wide. */
export const TILE_NARROW_REM = 40
/**
 * The tile grid before it is measured (and the loading copy's): two equal columns on a phone, fixed 12rem tracks from a
 * 40rem page, `gap-2.5` (`TILE_GAP_REM`). Literal for Tailwind; verify-shop-record checks it against the numbers above.
 */
export const TILE_GRID = 'grid grid-cols-2 items-start gap-2.5 @[40rem]/page:grid-cols-[repeat(auto-fill,12rem)]'
/** The gap between two stacks of categories. */
export const STACK_GAP_REM = 1.5

/** How wide `n` tiles are with the gaps between them. */
export const tilesRem = (n: number): number => n * TILE_REM + Math.max(0, n - 1) * TILE_GAP_REM

/** How many fixed tiles a row of `widthRem` takes (at least one). */
export function tileColumns(widthRem: number): number {
  return Math.max(1, Math.floor((widthRem + TILE_GAP_REM) / (TILE_REM + TILE_GAP_REM)))
}

/** A tile grid's columns and template: two equal columns on a narrow list, else as many fixed tracks as `widthRem` holds. */
export function tileTrack(widthRem: number, narrow: boolean): { cols: number; template: string } {
  if (narrow) return { cols: 2, template: 'repeat(2, minmax(0, 1fr))' }
  const cols = tileColumns(widthRem)
  return { cols, template: `repeat(${cols}, ${TILE_REM}rem)` }
}

/**
 * How many column stacks the category sections are dealt into, by the list's
 * own width in rem (W2: sections of different heights stack, never a row
 * grid). A stack keeps room for three tiles (37.25rem with their gaps) and
 * 1.5rem between stacks: one on a phone and a 1469 laptop, two at 1795 and
 * 1920, three at 2450. Unmeasured: one.
 */
export function categoryColumns(widthRem: number | null): number {
  if (widthRem == null || !Number.isFinite(widthRem)) return 1
  return Math.max(1, Math.floor((widthRem + STACK_GAP_REM) / (tilesRem(3) + STACK_GAP_REM)))
}

/** One stack's width: the whole tiles its share of the list holds, so its tiles fill it and every stack is as wide. */
export function stackRem(widthRem: number, stacks: number): number {
  const share = (widthRem - (stacks - 1) * STACK_GAP_REM) / Math.max(1, stacks)
  return tilesRem(tileColumns(share))
}

/** One placed piece of a packed category: a subcategory's label over its first tiles, or a tile. */
export interface Placed { group: number; line: number; col: number; span: number; label: boolean; index: number }

/**
 * The subcategories of one category packed into rows of `cols` tiles, so a
 * small one doesn't leave the rest of its row empty: a group shares the row
 * of the one before when it fits in the cells left, else it starts a row (a
 * group is never split to fill a gap); a group longer than a row fills whole
 * rows. Each group's label gets a line above its first tiles, spanning them.
 * Lines are 1-based grid rows; every tile of a row is on the same line, so
 * the row's tiles line up.
 */
export function packGroups(counts: readonly number[], cols: number): Placed[] {
  const out: Placed[] = []
  const rows: { labels: Placed[]; tiles: Placed[] }[] = []
  let row = { labels: [] as Placed[], tiles: [] as Placed[] }
  let col = 0
  const close = () => { if (row.tiles.length) rows.push(row); row = { labels: [], tiles: [] }; col = 0 }
  counts.forEach((n, group) => {
    if (n <= 0) return
    if (col > 0 && n > cols - col) close()
    let index = 0
    while (index < n) {
      const take = Math.min(n - index, cols - col)
      if (index === 0) row.labels.push({ group, line: 0, col, span: take, label: true, index: 0 })
      for (let k = 0; k < take; k++) row.tiles.push({ group, line: 0, col: col + k, span: 1, label: false, index: index + k })
      index += take
      col += take
      if (col >= cols) close()
    }
  })
  close()
  let line = 1
  for (const r of rows) {
    if (r.labels.length) { for (const l of r.labels) out.push({ ...l, line }); line++ }
    for (const t of r.tiles) out.push({ ...t, line })
    line++
  }
  return out
}

/**
 * A category's tint, 1–6 (the chart series): one per top category, so a
 * subcategory shares its parent's; no category is the slate (6).
 */
export function tintOf(topId: string | null): number {
  if (!topId) return 6
  let h = 0
  for (const ch of topId) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return (h % 5) + 1
}
