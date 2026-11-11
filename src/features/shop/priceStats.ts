// The price figures of many things in one call (shop_price_stats, migration 190): the most ids one call takes,
// the ids split into such calls, and each answer checked where it enters (NaN or infinity is no price). Pure —
// scripts/verify-shop-signals.cjs.
import { isUuid } from './signalStates'
import type { ShopPriceStats } from './types'

/** 190 refuses more ids than this in one call. */
export const PRICE_STATS_MAX_IDS = 500
/** The sparkline's steps: 60 days in steps of 5, oldest first. */
export const SPARK_STEPS = 12

/** The ids to ask for, once each (an id that is no uuid would fail the whole call), in calls of at most 500. */
export function priceStatsBatches(ids: readonly string[]): string[][] {
  const unique = [...new Set(ids.filter(isUuid).map(id => id.toLowerCase()))].sort()
  const out: string[][] = []
  for (let i = 0; i < unique.length; i += PRICE_STATS_MAX_IDS) out.push(unique.slice(i, i + PRICE_STATS_MAX_IDS))
  return out
}

/** A finite number from PostgREST (numeric may come as a number or a string; "NaN" is no number). */
function finite(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}
const count = (v: unknown): number | null => { const n = finite(v); return n !== null && Number.isInteger(n) && n >= 0 ? n : null }
const at = (v: unknown): string | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null)

/** One answer row, checked: null unless it has an id, its counts, its lowest, highest and last price — all finite. */
export function parsePriceStats(row: unknown): ShopPriceStats | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  const points = count(r.points), low = finite(r.low_all), high = finite(r.high_all), last = finite(r.last_price), lastAt = at(r.last_at)
  if (!isUuid(r.item_id) || points === null || points < 1 || low === null || high === null || last === null || !lastAt) return null
  const spark = Array.isArray(r.spark) && r.spark.length === SPARK_STEPS ? r.spark.map(finite) : Array<number | null>(SPARK_STEPS).fill(null)
  return {
    item_id: r.item_id.toLowerCase(),
    currency: typeof r.currency === 'string' && /^[A-Z]{3}$/.test(r.currency) ? r.currency : null,
    points, low_all: low, high_all: high,
    points_60d: count(r.points_60d) ?? 0, first_60d: at(r.first_60d), low_60d: finite(r.low_60d), high_60d: finite(r.high_60d),
    last_price: last, last_in_stock: typeof r.last_in_stock === 'boolean' ? r.last_in_stock : null, last_at: lastAt,
    back_in_stock: r.back_in_stock === true, restocked_at: r.back_in_stock === true ? at(r.restocked_at) : null,
    spark,
  }
}
