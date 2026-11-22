// What a read receipt gives the add sheet's autofill (autofillModel.ts): facts like any other input's, so they land in
// the same "Filled in for you · untick what's wrong" list, each with its source ("the receipt") and how sure it is,
// and `mergeFacts` / `fieldsAfter` already guarantee the rest: a fact fills its field only when the field is empty or
// still holds what an earlier receipt fact put there — never over what the owner typed — and a new pick of a receipt
// line replaces the earlier receipt facts. Pure: scripts/verify-ai-features.cjs runs it.
import type { Fact, FactSource } from './autofillModel'
import type { ReceiptFill } from '../ai/claude/featureRules'
import type { ShopCurrency } from './types'

const SOURCE: FactSource = { origin: 'receipt', label: 'the receipt' }

/** The name, the amount (with its currency) and the store of a read receipt, as autofill facts (all `on`). */
export function receiptFacts(fill: ReceiptFill, at: string): Fact[] {
  const facts: Fact[] = []
  if (fill.title) facts.push({ key: 'title', value: fill.title, source: SOURCE, confidence: 'likely', on: true, at })
  if (fill.price !== undefined && fill.currency) {
    facts.push({ key: 'price', value: { amount: fill.price, currency: fill.currency as ShopCurrency }, source: SOURCE, confidence: 'exact', on: true, at })
  }
  if (fill.storeLabel) facts.push({ key: 'store', value: fill.storeLabel, source: SOURCE, confidence: fill.storeId ? 'exact' : 'check', on: true, at })
  return facts
}
