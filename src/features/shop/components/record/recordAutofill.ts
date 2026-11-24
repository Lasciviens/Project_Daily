// The link reader, the scan and "Filled in for you" (`ShopAutofill`) on a SAVED thing — the open record's Facts (owner,
// 24.11.2026: every feature from every way in). Pure, so scripts/verify-shop-one-body.mjs runs it.
//
// The autofill works on the add form's `ShopDraft`; here that draft is the saved row with the record's edits on top, mapped
// by the same `shopDraftOfView` / `draftWithShopPatch` as a thing being added, so it fills the same fields. A form fact fills
// only an empty field or one still holding an earlier fact (`fieldsAfter`, the autofill's own rule) — what the row holds
// counts as typed. Nothing is written here: the result is the record's draft, saved by the record's Save. The facts kept go
// into `facts` over the row's own, never over one whose source is "you"; an EAN only where the row has none.
import type { Fact } from '../../autofillModel'
import { factsToSave } from '../../factsKept'
import type { ShopCategory, ShopItem, ShopItemFacts } from '../../types'
import type { ShopDraft } from '../ShopItemForm'
import { draftWithShopPatch, shopDraftOfView } from './createDraft'
import type { RecordDraft } from './useRecordDraft'

/** The autofill's draft of a saved thing with the record's edits. */
export function recordShopDraft(item: ShopItem, draft: RecordDraft, categories: readonly ShopCategory[], facts: Fact[]): ShopDraft {
  return shopDraftOfView({ ...item, ...draft } as ShopItem & RecordDraft, facts, categories)
}

/** The row's saved facts with the kept ones over them; the owner's own ("you") always stays. */
export function mergeSavedFacts(row: ShopItemFacts | null | undefined, kept: ShopItemFacts | null): ShopItemFacts | null {
  if (!kept) return row ?? null
  const out: ShopItemFacts = { ...(row ?? {}) }
  for (const [k, f] of Object.entries(kept) as [keyof ShopItemFacts, NonNullable<ShopItemFacts[keyof ShopItemFacts]>][]) {
    if (row?.[k]?.source === 'you') continue
    out[k] = f
  }
  return out
}

/**
 * What the record's draft gets from an autofill change: only the columns that differ from the row as it stands (draft on
 * top), the facts kept (the row's own object when nothing changed, so the record is not dirty for nothing) and an EAN only
 * when the row has none.
 */
export function recordAutofillPatch(item: ShopItem, draft: RecordDraft, categories: readonly ShopCategory[], facts: Fact[], patch: Partial<ShopDraft>): RecordDraft {
  const now = { ...item, ...draft } as ShopItem & RecordDraft
  const was = shopDraftOfView(now, facts, categories)
  const full = draftWithShopPatch(now, was, patch)
  const out: RecordDraft = {}
  for (const [k, v] of Object.entries(full)) {
    if ((now as unknown as Record<string, unknown>)[k] !== v) (out as Record<string, unknown>)[k] = v
  }
  const nextFacts = patch.facts ?? facts
  const kept = factsToSave(nextFacts, shopDraftOfView({ ...now, ...out } as ShopItem & RecordDraft, nextFacts, categories))
  const merged = mergeSavedFacts(item.facts, kept.facts)
  out.facts = JSON.stringify(merged) === JSON.stringify(item.facts ?? null) ? item.facts : merged
  if (kept.ean && !item.ean) out.ean = kept.ean
  return out
}
