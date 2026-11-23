// "Read a receipt" in Shop (owner, 23.11.2026): what the popup does with a read receipt, by code, never by the model.
// A read gives a kind (bought or sold) and product lines. A bought line opens Add something I own with that line's
// values through the one receipt path (`receiptFill` → `receiptFacts`: facts with the source "the receipt", never over
// what the owner types); a sold line is matched to one of the owner's things (never a new thing) and opens Sell with the
// amount and the day. Nothing is saved here: both sheets save, and only on the owner's tap. Pure: scripts/verify-ai-features.cjs.
import { foldName, matchLine, receiptFill, type ReceiptFill, type ReceiptLine, type ReceiptRead } from '../ai/claude/featureRules'
import { isMine } from './ownModel'
import { SHOP_CURRENCIES } from './shopModel'
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
export interface SaleDefaults { amount?: number; currency?: ShopCurrency; day?: string }

export function saleFor(read: ReceiptRead, line: ReceiptLine): SaleDefaults {
  const out: SaleDefaults = {}
  const currency = SHOP_CURRENCIES.find(c => c === read.currency)
  if (line.price !== null && currency) { out.amount = line.price; out.currency = currency }
  if (read.date) out.day = read.date
  return out
}

/** The ways a line may be written as a thing's name: as printed, and the brand and model together. */
function namesOf(line: ReceiptLine): string[] {
  return [line.name, [line.brand, line.model].filter(Boolean).join(' ')].filter(n => foldName(n).length >= 3)
}

/**
 * The owner's own thing a sold line is: a thing whose name equals the line's (folded: case, accents and spacing gone), else
 * one whose name holds the line's or the other way round (at least 6 characters and only one such thing), else the one thing
 * that `matchLine` finds (a model-like word, two shared words). Only things still the owner's, never an accessory. A
 * second equal match is no match: the picker shows it and the owner picks.
 */
export function thingForLine(line: ReceiptLine, things: readonly ShopItem[]): ShopItem | null {
  const mine = things.filter(t => isMine(t) && !t.accessory_of)
  const names = namesOf(line).map(foldName)
  const exact = mine.filter(t => names.includes(foldName(t.title)))
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return null
  const holds = mine.filter(t => {
    const title = foldName(t.title)
    return title.length >= 6 && names.some(n => n.length >= 6 && (n.includes(title) || title.includes(n)))
  })
  if (holds.length === 1) return holds[0]
  if (holds.length > 1) return null
  for (const name of namesOf(line)) {
    const at = matchLine(name, mine.map(t => t.title))
    if (at !== null) return mine[at]
  }
  return null
}

/** One line of the popup, in words: "Sony WH-1000XM5 · Sony · new · ×2". */
export function lineFacts(line: ReceiptLine): string {
  return [line.brand, line.model, line.condition === 'outlet' ? 'Outlet' : line.condition, line.quantity && line.quantity > 1 ? `×${line.quantity}` : null]
    .filter((p): p is string => !!p && foldName(p) !== foldName(line.name)).join(' · ')
}
