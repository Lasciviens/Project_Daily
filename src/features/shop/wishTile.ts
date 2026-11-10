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
 * A category's tint, 1–6 (the chart series): one per top category, so a
 * subcategory shares its parent's; no category is the slate (6).
 */
export function tintOf(topId: string | null): number {
  if (!topId) return 6
  let h = 0
  for (const ch of topId) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return (h % 5) + 1
}
