// A wish's picture tile (phase 2 prototype): which one belt it wears, where
// today's price sits in its history, and the designed face of a thing with no
// picture. Pure — scripts/verify-shop-suggestions.cjs.
import type { Tone } from '../../shared/ui/Tone'
import { currencyOf, watchedPrice, type Money } from './shopModel'
import type { ShopItem, ShopPricePoint, ShopPriceWatch } from './types'

/** One belt per tile, the first that holds in this order. */
export type BeltKind = 'at_target' | 'lowest' | 'deal' | 'need'
export const BELT_ORDER: readonly BeltKind[] = ['at_target', 'lowest', 'deal', 'need']
export const BELT: Record<BeltKind, { label: string; tone: Tone }> = {
  at_target: { label: 'At target', tone: 'success' },
  lowest:    { label: 'Lowest seen', tone: 'success' },
  deal:      { label: 'Deal on', tone: 'warn' },
  need:      { label: 'Need it', tone: 'highlight' },
}

/** The lowest and highest price read from a row's link, and how many reads. */
export interface PriceSpan { low: number; high: number; reads: number; currency: string }

/**
 * The history's lowest and highest in `currency` — null unless there is a
 * history: two reads or more that differ (one read, or one price all along,
 * places nothing).
 */
export function priceSpan(points: readonly ShopPricePoint[], currency: string): PriceSpan | null {
  const cur = currency.toUpperCase()
  const lows = points.filter(p => (p.currency ?? cur).toUpperCase() === cur && Number.isFinite(p.low)).map(p => p.low)
  if (lows.length < 2) return null
  const low = Math.min(...lows), high = Math.max(...lows)
  return high > low ? { low, high, reads: lows.length, currency: cur } : null
}

/** Where `now` sits between the lowest (0) and the highest (1) seen. */
export function spanPosition(now: number, span: PriceSpan): number {
  return Math.min(1, Math.max(0, (now - span.low) / (span.high - span.low)))
}

/** The price read from the row's link is at or under its target (the same currency only; a typed price never counts). */
export function atTarget(item: ShopItem, watch: ShopPriceWatch | null | undefined): boolean {
  const now = watchedPrice(item, watch)
  return !!now && item.target_price != null && now.currency === currencyOf(item) && now.amount <= item.target_price
}

/** Today's read is the lowest the history has seen (and it has been higher). */
export function atLowest(now: Money | null, span: PriceSpan | null): boolean {
  return !!now && !!span && now.currency === span.currency && now.amount <= span.low
}

/** Waiting for a deal that has started (or has no start day). */
export function dealOn(item: Pick<ShopItem, 'wait_for_deal' | 'planned_date'>, today: string): boolean {
  return !!item.wait_for_deal && (!item.planned_date || item.planned_date <= today)
}

/** The tile's one belt: at target · lowest seen · deal on · need it, or none. */
export function beltOf(item: ShopItem, ctx: { watch?: ShopPriceWatch | null; span?: PriceSpan | null; today: string }): BeltKind | null {
  const holds: Record<BeltKind, () => boolean> = {
    at_target: () => item.kind !== 'general' && atTarget(item, ctx.watch),
    lowest:    () => item.kind !== 'general' && atLowest(watchedPrice(item, ctx.watch), ctx.span ?? null),
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
 * How many column stacks the category sections are dealt into, by the list's
 * own width in rem (W2: sections of different heights stack, never a row
 * grid). A stack keeps room for three 10rem tiles (31.5rem with their gaps)
 * and 1.5rem between stacks: one on a phone and a 1469 laptop, two at 1920,
 * three at 2450. Unmeasured: one.
 */
export function categoryColumns(widthRem: number | null): number {
  if (widthRem == null || !Number.isFinite(widthRem)) return 1
  return Math.max(1, Math.floor((widthRem + 1.5) / 33))
}

/** The tile grid's column width and gap, in rem (tileKit.TILE_GRID). */
export const TILE_MIN_REM = 10
export const TILE_GAP_REM = 0.625

/** How many tiles a row of `widthRem` takes — auto-fill's own count for minmax(10rem, 1fr). */
export function tileColumns(widthRem: number): number {
  return Math.max(1, Math.floor((widthRem + TILE_GAP_REM) / (TILE_MIN_REM + TILE_GAP_REM)))
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
