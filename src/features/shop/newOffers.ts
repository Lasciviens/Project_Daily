import type { ShopNewOffer } from './types'

// Kept apart from storeRows so the price API reads the offers without the store maths (the Shop page's first download).

// ── Prisjakt's new offers (shop_price_watch.new_offers, 191) ────────────────

/** A shop name a screen may show: one line, 1–120 characters, no control, zero-width or direction characters (191's check). */
const plainName = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= 120 && v === v.replace(/\s+/g, ' ').trim()
  && ![...v].some(ch => { const c = ch.codePointAt(0) as number; return c < 0x20 || (c >= 0x7f && c <= 0x9f) || (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff })

/** The new offers read back, checked as 191 checks them: at most 50, each whole; anything else is none (null). */
export function parseNewOffers(v: unknown): ShopNewOffer[] | null {
  if (!Array.isArray(v) || v.length > 50) return null
  const out: ShopNewOffer[] = []
  for (const o of v) {
    if (!o || typeof o !== 'object') return null
    const r = o as Record<string, unknown>
    if (!(typeof r.shop_id === 'number' && Number.isSafeInteger(r.shop_id) && r.shop_id > 0 && r.shop_id < 1e10)) return null
    if (!(typeof r.price === 'number' && Number.isFinite(r.price) && r.price >= 0 && r.price < 1e9)) return null
    if (typeof r.currency !== 'string' || !/^[A-Z]{3}$/.test(r.currency)) return null
    if (r.in_stock !== null && typeof r.in_stock !== 'boolean') return null
    if (r.shop_name !== null && !plainName(r.shop_name)) return null
    out.push({ shop_id: r.shop_id, shop_name: r.shop_name as string | null, price: r.price, currency: r.currency, in_stock: r.in_stock as boolean | null })
  }
  return out
}
