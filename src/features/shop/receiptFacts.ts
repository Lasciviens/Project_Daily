// What a read receipt gives the add sheet's autofill (autofillModel.ts): facts like any other input's, so they land in
// the same "Filled in for you · untick what's wrong" list, each with its source ("the receipt") and how sure it is,
// and `mergeFacts` / `fieldsAfter` already guarantee the rest: a fact fills its field only when the field is empty or
// still holds what an earlier receipt fact put there — never over what the owner typed — and a new pick of a receipt
// line replaces the earlier receipt facts. Pure: scripts/verify-ai-features.cjs runs it.
import type { Fact, FactSource } from './autofillModel'
import type { ReceiptFill } from '../ai/claude/featureRules'
import type { ShopCategory, ShopCurrency } from './types'

const SOURCE: FactSource = { origin: 'receipt', label: 'the receipt' }
/** What a web search found: it says so, and the owner checks it. */
const SEARCHED: FactSource = { origin: 'receipt', label: 'receipt + web search' }

/** The name, the amount (with its currency), the category and the store of a read receipt, as autofill facts (all `on`). */
export function receiptFacts(fill: ReceiptFill, at: string, categories: readonly ShopCategory[] = []): Fact[] {
  const facts: Fact[] = []
  const found = !!fill.searched
  const source = found ? SEARCHED : SOURCE
  if (fill.title) facts.push({ key: 'title', value: fill.title, source, confidence: found ? 'check' : 'likely', on: true, at })
  if (fill.price !== undefined && fill.currency) {
    facts.push({ key: 'price', value: { amount: fill.price, currency: fill.currency as ShopCurrency }, source: SOURCE, confidence: 'exact', on: true, at })
  }
  // What the receipt took off this line, with its reason: its own field, ticked, never subtracted from the paid price.
  if (fill.discount !== undefined) facts.push({ key: 'discount', value: { amount: fill.discount, reason: fill.discountReason ?? 'other' }, source: SOURCE, confidence: 'exact', on: true, at })
  // Printed: "likely", so it beats the title's own guess in the add sheet (an equal confidence loses). Found by a search: "check".
  if (fill.brand) facts.push({ key: 'brand', value: fill.brand, source, confidence: found ? 'check' : 'likely', on: true, at })
  if (fill.model) facts.push({ key: 'model', value: fill.model, source, confidence: found ? 'check' : 'likely', on: true, at })
  if (fill.condition) facts.push({ key: 'condition', value: fill.condition, source: SOURCE, confidence: 'likely', on: true, at })
  // The category the function chose from the owner's own list (by number, mapped back to an id that was sent): the
  // subcategory when one fits. A guess from a line, so "check"; an id that is no longer in the list is left out.
  const cat = fill.categoryId ? categories.find(c => c.id === fill.categoryId) : undefined
  if (cat) {
    const top = cat.parent_id ? categories.find(c => c.id === cat.parent_id) : undefined
    if (!cat.parent_id || top) {
      facts.push({ key: 'category', value: { topId: top ? top.id : cat.id, subId: top ? cat.id : '', name: top ? `${top.name} › ${cat.name}` : cat.name }, source, confidence: 'check', on: true, at })
    }
  }
  if (fill.storeLabel) facts.push({ key: 'store', value: fill.storeLabel, source: SOURCE, confidence: fill.storeId ? 'exact' : 'check', on: true, at })
  return facts
}
