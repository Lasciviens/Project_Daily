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
 * The tile grid before it is measured (and the loading copies'): two equal columns on a phone, fixed 12rem tracks from a
 * 40rem page, `gap-2.5` (`TILE_GAP_REM`). Literal for Tailwind; verify-shop-suggestions checks it against the numbers above.
 */
export const TILE_GRID = 'grid grid-cols-2 items-start gap-2.5 @[40rem]/page:grid-cols-[repeat(auto-fill,12rem)]'
/**
 * A category's subcategory blocks side by side: the same gap across as between tiles, so every block starts on one column
 * grid and the tiles of every subcategory line up; the subcategory's label above its block tells them apart.
 */
export const TILE_LINE = 'flex items-start gap-2.5'
/** The lines of blocks, one under the other. */
export const TILE_LINES = 'flex flex-col gap-3'

/** How wide `n` tiles are with the gaps between them. */
export const tilesRem = (n: number): number => n * TILE_REM + Math.max(0, n - 1) * TILE_GAP_REM

/** How many fixed tiles a row of `widthRem` takes (at least one). */
export function tileColumns(widthRem: number): number {
  return Math.max(1, Math.floor((widthRem + TILE_GAP_REM) / (TILE_REM + TILE_GAP_REM)))
}

/** How many tile columns a subcategory's block takes on a line of `line` columns: its tiles, at most a line. */
export const pictureColumns = (cards: number, line: number): number => Math.max(1, Math.min(cards, Math.floor(line)))

/**
 * The lines of a category's blocks (each line the indexes of its blocks, in order) on a line of `line` columns — the one
 * layout of every picture view (the Wishlist, Owned's big pictures, the Gone fold). A block shares a line only when ALL its
 * tiles fit in what is left of it, so every shared line is one row of tiles and has no hole under a shorter block. Each
 * block goes on the first line it fits (first fit: a small block fills the end of an earlier line rather than leaving it
 * empty, owner-critic 24.11.2026: "no empty strips"); a block with as many tiles as a line holds, or more, takes a line of
 * its own (its tiles wrap).
 */
export function pictureLines(cards: readonly number[], line: number): number[][] {
  const width = Math.max(1, Math.floor(line))
  const lines: { left: number; blocks: number[] }[] = []
  cards.forEach((raw, i) => {
    const n = Math.max(1, raw)
    const open = n < width ? lines.find(l => l.left >= n) : undefined
    if (open) { open.blocks.push(i); open.left -= n } else lines.push({ left: Math.max(0, width - n), blocks: [i] })
  })
  return lines.map(l => l.blocks)
}

/** A category's tile layout, handed down by the list that packs the categories: two equal columns or `line` fixed ones. */
export interface TileLayout { narrow: boolean; line: number }

/**
 * The same packing one level up (owner-critic, 24.11.2026: a one-tile category took a whole line and left ~1300px empty):
 * a category whose blocks fit in one row of `line` columns is as wide as that row (`cols`), and such categories share a
 * line, first fit, when they fit in what is left of it — so a line of categories is one row of tiles each and has no hole;
 * a category that needs more than one row (`cols` null) has the whole width, on a line of its own.
 */
export function categoryLines(blocks: readonly (readonly number[])[], line: number): { lines: number[][]; cols: (number | null)[] } {
  const width = Math.max(1, Math.floor(line))
  const cols = blocks.map(b => (pictureLines(b, width).length === 1 ? Math.min(width, b.reduce((s, n) => s + pictureColumns(n, width), 0)) : null))
  return { lines: pictureLines(cols.map(c => c ?? width), width), cols }
}

/**
 * A category's blocks in a list `widthRem` wide: under 40rem (a phone) two equal columns — a block of one tile is half the
 * row, so two one-tile subcategories share a row — else fixed 12rem columns, as many as the width holds.
 */
export function tileBlocks(cards: readonly number[], widthRem: number): { narrow: boolean; line: number; lines: number[][] } {
  const narrow = widthRem < TILE_NARROW_REM
  const line = narrow ? 2 : tileColumns(widthRem)
  return { narrow, line, lines: pictureLines(cards, line) }
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
