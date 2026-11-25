// What Shop's 📷✨ (the `product_photo` job, owner, 25.11.2026) gives the one body's autofill: facts like any other input's,
// so the draft lands in the same "Filled in for you · untick what's wrong" list, each labelled "photo + AI" and "check", and
// `mergeFacts` / `fieldsAfter` already hold the rest: a fact fills its field only while the field is empty or still holds an
// earlier fact — never over what the owner typed — and nothing is written until Save. The call id rides on the facts' source
// (never saved), so the save can say what the owner kept (`photoLearnReport`). Pure: scripts/verify-shop-photo.cjs runs it.
import type { Fact, FactSource } from './autofillModel'
import { categoryFactValue } from './receiptFacts'
import type { PhotoDraft } from '../ai/claude/photoProductRules'
import type { SaveReport } from '../ai/claude/learnSave'
import type { ShopCategory, ShopCurrency, ShopItemFacts } from './types'

/** The source every fact of the draft says: the photo read by the AI (and the web, when it searched). */
export const PHOTO_LABEL = 'photo + AI'
export const PHOTO_SEARCHED_LABEL = 'photo + AI + web search'

/** The draft's name, brand, model, category, condition and a printed price, as autofill facts (all `on`, all "check": the AI's reading). */
export function photoFacts(draft: PhotoDraft, categories: readonly ShopCategory[], at: string, callId: string | null): Fact[] {
  const source: FactSource = { origin: 'photo', label: draft.searched ? PHOTO_SEARCHED_LABEL : PHOTO_LABEL, ...(callId ? { call: callId } : {}) }
  const facts: Fact[] = []
  if (draft.name) facts.push({ key: 'title', value: draft.name, source, confidence: 'check', on: true, at })
  if (draft.price !== undefined && draft.currency) facts.push({ key: 'price', value: { amount: draft.price, currency: draft.currency as ShopCurrency }, source, confidence: 'check', on: true, at })
  const cat = categoryFactValue(draft.category_id, categories)
  if (cat) facts.push({ key: 'category', value: cat, source, confidence: 'check', on: true, at })
  if (draft.brand) facts.push({ key: 'brand', value: draft.brand, source, confidence: 'check', on: true, at })
  if (draft.model) facts.push({ key: 'model', value: draft.model, source, confidence: 'check', on: true, at })
  if (draft.condition) facts.push({ key: 'condition', value: draft.condition, source, confidence: 'check', on: true, at })
  return facts
}

/** The field each photo fact is in the job's learn spec (supabase/claude-src/learn-specs.ts, `product_photo`). */
const LEARN_FIELD: Partial<Record<Fact['key'], string>> = { title: 'name', brand: 'brand', model: 'model', category: 'category_id', condition: 'condition' }

/**
 * What the owner saved of a photo draft, for the function to compare with its own copy of the answer: the saved row's name,
 * brand, model, category and condition, and the draft's fields the owner unticked. Null when no fact of the draft is there
 * (no AI call to report). Sent only at the form's Save, never at a mere keep.
 */
export function photoLearnReport(facts: readonly Fact[], row: { title: string; category_id: string | null; facts?: ShopItemFacts | null }): SaveReport | null {
  const mine = facts.filter(f => f.source.origin === 'photo')
  const callId = mine.find(f => f.source.call)?.source.call
  if (!callId) return null
  const text = (v: unknown) => (typeof v === 'string' ? v : '')
  return {
    callId,
    saved: {
      name: row.title, brand: text(row.facts?.brand?.value), model: text(row.facts?.model?.value), category_id: row.category_id ?? '',
      condition: text(row.facts?.condition?.value),
    },
    unticked: mine.filter(f => !f.on).map(f => LEARN_FIELD[f.key]).filter((x): x is string => !!x),
  }
}
