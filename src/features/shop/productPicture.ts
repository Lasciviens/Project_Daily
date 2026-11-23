// A product's picture from its own page (owner, 23.11.2026: "Shop AI don't bring picture link"). The AI may name the
// product's page, but only an address its own web search returned (the function checks that); the picture is never an
// address the model wrote. This module is what the app does with such a page, pure (scripts/verify-shop-picture.cjs):
//   · the page is read ONLY through shop-price's `read` (its site policies, robots.txt, once-an-hour reuse, address and
//     redirect checks, `keptText`), never fetched here and never opened by the browser;
//   · the picture is that read's `image`, checked once more: https, at most 2 048 characters, no user name, no IP address,
//     localhost, .local or single-label host — the same rules as a quick-list picture;
//   · it becomes a fact "Picture · product page (host)" the owner sees and can untick before Save.
import { siteOf, type Fact } from './autofillModel'
import { pictureNote } from './watchWords'
import type { PriceReadResult } from './api/shopPriceApi'

export interface PagePicture {
  /** A picture address that may be shown, or null. */
  image: string | null
  /** The page's own host ("elkjop.no"), or null. */
  host: string | null
  /** Why there is no picture, in the app's words, or null. */
  note: string | null
}

const IMAGE_MAX = 2048
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

/** A picture address that is safe to put in an image tag: https on a public host, never an address of this device or network. */
export function shownPicture(value: unknown): string | null {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
  if (typeof value !== 'string' || !value || value.length > IMAGE_MAX || /[\s\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/.test(value)) return null
  let url: URL
  try { url = new URL(value) } catch { return null }
  const host = url.hostname.toLowerCase().replace(/\.+$/, '')
  if (url.protocol !== 'https:' || url.username || url.password) return null
  if (!host.includes('.') || host.startsWith('[') || IPV4.test(host) || host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost') || host.endsWith('.internal')) return null
  return value
}

/** What a read of the product's page gives as a picture. A site that does not let apps read it gives none, and says so in the shared words. */
export function pictureOf(r: PriceReadResult | null): PagePicture {
  if (!r) return { image: null, host: null, note: 'The product page could not be read — no picture.' }
  const image = r.status === 'not_allowed' ? null : shownPicture(r.image)
  const host = siteOf(r.finalUrl) ?? r.site ?? null
  return { image, host, note: pictureNote(r, !!image) }
}

/**
 * Whether a page is about the product wanted (a page the search returned that was not the one the AI named): they share a model-like
 * word (one with a digit, "xm5") or at least two words of 3 letters or more. A page with no name is never taken.
 */
export function samePage(pageName: string | null | undefined, product: string): boolean {
  if (!pageName) return false
  const words = (s: string) => new Set(s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
  const shared = [...words(pageName)].filter(w => words(product).has(w))
  return shared.some(w => /\d/.test(w)) || shared.length >= 2
}

/** The fact the picture is: ticked, "check" (a page found by a search is a guess), its source the page's own host. */
export function pictureFact(p: PagePicture, at: string): Fact | null {
  if (!p.image) return null
  return { key: 'image', value: p.image, source: { origin: 'page', label: `product page (${p.host ?? 'its site'})` }, confidence: 'check', on: true, at }
}
