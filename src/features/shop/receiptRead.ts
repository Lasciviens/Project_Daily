// "Read a receipt" in Shop (owner, 23.11.2026): what the popup does with a read receipt, by code, never by the model.
// A read gives a kind (bought or sold) and product lines. A bought line opens Add something I own with that line's
// values through the one receipt path (`receiptFill` → `receiptFacts`: facts with the source "the receipt", never over
// what the owner types); a sold line is matched to one of the owner's things (never a new thing) and opens Sell with the
// amount and the day. Nothing is saved here: both sheets save, and only on the owner's tap. Pure: scripts/verify-ai-features.cjs.
import { foldName, matchLine, matchStore, receiptFill, type ReceiptFill, type ReceiptLine, type ReceiptRead } from '../ai/claude/featureRules'
import { isMine, isPossession } from './ownModel'
import { listOf, SHOP_CURRENCIES } from './shopModel'
import type { ShopCurrency, ShopItem, ShopStore } from './types'

export type ReceiptSide = 'bought' | 'sold'

/** The switch's first position: what the receipt says it is, else Bought (the owner changes it). */
export const sideOf = (read: ReceiptRead): ReceiptSide => (read.kind === 'sold' ? 'sold' : 'bought')

/**
 * What Add something I own starts from for one line: the receipt's own fill for that line (name, brand, model, condition,
 * the line's price, currency, day, store matched to the owner's stores), without "the other lines as accessories" (each
 * line has its own Add here).
 */
export function addFillFor(read: ReceiptRead, index: number, stores: readonly { id: string; name: string; hidden?: boolean; kind?: string }[]): ReceiptFill {
  return { ...receiptFill(read, stores as readonly ShopStore[], index), others: [] }
}

/** What Sell starts from: the line's price and the receipt's day. Each is left out unless it is usable. */
export interface SaleDefaults {
  amount?: number; currency?: ShopCurrency; day?: string
  /** The buyer or marketplace, when the receipt's store is one of your own stores. */
  to?: string
  /** The thing the money went to (a bought line of a read receipt, saved first): Sell's "Money goes to" starts on it, only when the sheet itself lists it. */
  moneyTo?: string
}

export function saleFor(read: ReceiptRead, line: ReceiptLine, stores: readonly { id: string; name: string; hidden?: boolean; kind?: string }[] = []): SaleDefaults {
  const out: SaleDefaults = {}
  const store = matchStore(read.store, stores)
  if (store) out.to = store.name
  const currency = SHOP_CURRENCIES.find(c => c === read.currency)
  if (line.price !== null && currency) { out.amount = line.price; out.currency = currency }
  if (read.date) out.day = read.date
  return out
}

/** The ways a line may be written as a thing's name: as printed, and the brand and model together. */
function namesOf(line: ReceiptLine): string[] {
  return [line.name, line.product ?? '', [line.brand, line.model].filter(Boolean).join(' ')].filter(n => foldName(n).length >= 3)
}

/**
 * The one of `pool` a receipt line is: a thing whose name equals the line's (folded: case, accents and spacing gone), else
 * one whose name holds the line's or the other way round (at least 6 characters and only one such thing), else the one
 * thing that `matchLine` finds (a model-like word, two shared words). A second equal match is no match: the picker shows
 * it and the owner picks. The line's product name, brand and model are tried as well as its printed name.
 */
function matchIn(line: ReceiptLine, pool: readonly ShopItem[]): ShopItem | null {
  const names = namesOf(line).map(foldName)
  const exact = pool.filter(t => names.includes(foldName(t.title)))
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return null
  const holds = pool.filter(t => {
    const title = foldName(t.title)
    return title.length >= 6 && names.some(n => n.length >= 6 && (n.includes(title) || title.includes(n)))
  })
  if (holds.length === 1) return holds[0]
  if (holds.length > 1) return null
  for (const name of namesOf(line)) {
    const at = matchLine(name, pool.map(t => t.title))
    // One shared everyday word ("demo") is not enough to say which thing it is: a model-like word (with a digit) or two shared words.
    if (at !== null && strongShare(name, pool[at].title)) return pool[at]
  }
  return null
}

const tokensOf = (s: string): Set<string> => new Set(s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])
/** Whether two names share a word with a digit ("x1", "xm5") or at least two words. */
function strongShare(a: string, b: string): boolean {
  const mine = tokensOf(a)
  const shared = [...tokensOf(b)].filter(w => mine.has(w))
  return shared.length >= 2 || shared.some(w => /\d/.test(w))
}

/** The owner's own thing a sold line is: only things still the owner's, never an accessory. */
export function thingForLine(line: ReceiptLine, things: readonly ShopItem[]): ShopItem | null {
  return matchIn(line, things.filter(t => isMine(t) && !t.accessory_of))
}

/** An owner's thing that is already sold in the app, never an accessory: a sold line that is one of these needs no sale, only a link. */
export function soldThingForLine(line: ReceiptLine, things: readonly ShopItem[]): ShopItem | null {
  return matchIn(line, things.filter(t => isPossession(t) && !!t.disposal && t.disposal !== 'returned' && !t.accessory_of))
}

/** The wish a bought line is (a thing still to buy: its row becomes bought, Just bought opens), by the same match. */
export function wishForLine(line: ReceiptLine, items: readonly ShopItem[]): ShopItem | null {
  return matchIn(line, items.filter(t => listOf(t) === 'wishlist' && t.status === 'wishlist' && t.kind !== 'general' && !t.option_for && !t.accessory_of))
}

/** One line of the popup, in words: "Sony WH-1000XM5 · Sony · new · ×2". */
export function lineFacts(line: ReceiptLine): string {
  return [line.brand, line.model, line.condition === 'outlet' ? 'Outlet' : line.condition, line.quantity && line.quantity > 1 ? `×${line.quantity}` : null]
    .filter((p): p is string => !!p && foldName(p) !== foldName(line.name)).join(' · ')
}
