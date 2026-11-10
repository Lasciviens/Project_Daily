// A product's facts as text — its EAN, a model code inside its name, Prisjakt's product number — for the
// add sheet (autofillModel.ts, in the browser) and the page reader (priceRead.ts, in shop-price) alike. Its own
// module so the browser loads it only with the add sheet's autofill: priceRead's parsePrice sits in a chunk the
// Shop page loads first. Pure.
//
// The block between the <product-facts> markers is a HAND MIRROR in supabase/functions/shop-price/index.ts
// (Deno cannot import from src/); scripts/verify-shop-price-read.cjs fails while the two differ.

// <product-facts>
/** The longest name kept (as Delete's Undo keeps it: 187's left(name, 300)); a longer one is looked at no further. */
export const NAME_MAX = 300

/**
 * An EAN (GTIN) as 13 digits: 8 to 14 digits as text or a number — a shorter one padded with zeros in front, as
 * Power's `gtin13` drops them ("195949822629", "45496321444"); a 14-digit one only with a leading 0 — and only when
 * its check digit holds and it isn't all zeros. Else null. A text longer than 20 characters is none.
 */
export function ean13(v: unknown): string | null {
  const s = typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? String(v) : typeof v === 'string' && v.length <= 20 ? v.trim() : ''
  if (!/^\d{8,14}$/.test(s)) return null
  const d = s.length === 14 ? (s[0] === '0' ? s.slice(1) : '') : s.padStart(13, '0')
  if (!d || /^0+$/.test(d)) return null
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(d[i]) * (i % 2 === 0 ? 1 : 3)
  return (10 - (sum % 10)) % 10 === Number(d[12]) ? d : null
}

/** A size or an amount, never a model code: "128GB", "9.5L", "2x5Ah", "825GB". */
const AMOUNT_WORD = /^\d+([.,]\d+)?(x\d+([.,]\d+)?)?[a-z]{0,4}$/i

/**
 * A model code inside a product's name — the last word of 5 to 24 letters, digits, "-" and "." with a letter and at
 * least two digits that isn't a size or an amount: "Makita DDF485RTJ (2x5Ah)" → DDF485RTJ, "LG C5 55" … (2025) -
 * OLED55C51LA" → OLED55C51LA, "Apple iPhone 16 128GB" → null. A guess, so the app says "check". A name longer than a
 * kept one (300) is none.
 */
export function modelInName(name: string | null): string | null {
  if (!name || name.length > NAME_MAX) return null
  let found: string | null = null
  for (const raw of name.split(/[\s,;:()[\]{}/\\"'”“«»+&|*!?]+/)) {
    const w = raw.replace(/^[.-]+|[.-]+$/g, '')
    if (w.length < 5 || w.length > 24 || !/^[A-Za-z0-9.-]+$/.test(w) || !/[A-Za-z]/.test(w) || (w.match(/\d/g) ?? []).length < 2) continue
    if (!AMOUNT_WORD.test(w)) found = w
  }
  return found
}

/** Whether a link is a Prisjakt product page: prisjakt.no or a subdomain, `/product.php` (or `/produkt.php`) with a number as `p`. */
export function isPrisjaktUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return /(^|\.)prisjakt\.no$/i.test(u.hostname) && /^\/(product|produkt)\.php$/i.test(u.pathname) && /^\d+$/.test(u.searchParams.get('p') ?? '')
  } catch { return false }
}

/** Prisjakt's product number on one of its product links (`p=13854649`), else null. */
export function prisjaktProduct(url: string): string | null {
  if (!isPrisjaktUrl(url)) return null
  const p = new URL(url).searchParams.get('p') ?? ''
  return /^\d{1,12}$/.test(p) ? p : null
}
// </product-facts>
