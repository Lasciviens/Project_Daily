// A new Shop thing in the record's own popup (`ShopCreate`): its draft, worked out by code — pure, so
// scripts/verify-shop-create.cjs runs it against the real module.
//
// The draft is the record's own (`RecordDraft`: columns, `bought_day`, the names typed for a new category) on top of a
// blank row, so the same facts (`RecordFacts`, `factList`) edit it and a new thing looks like a record. The link reader,
// barcode scan and "Filled in for you" list (`ShopAutofill`) work on the add form's `ShopDraft`; `shopDraftOf` and
// `withShopPatch` translate between the two, so what they fill lands in the same fields.
import type { ReceiptCostFill, ReceiptFill } from '../../../ai/claude/featureRules'
import { middayIso } from '../../../media/watchedWhen'
import { fieldsAfter, mergeFacts, type Fact } from '../../autofillModel'
import { factsToSave } from '../../factsKept'
import { receiptFacts } from '../../receiptFacts'
import { categoryIdOf, currencyOf, localDay, pickOf } from '../../shopModel'
import type { CreateShopItemInput, ShopCategory, ShopCurrency, ShopItem } from '../../types'
import type { ShopDraft } from '../ShopItemForm'
import { isNewCategory, newCategoryId, newCategoryMissing, newPickOf, type RecordDraft } from './useRecordDraft'

/** What is being made: a wish (one product), a general wish, a thing you own, one you had, an accessory, a model of a general wish. */
export type CreatePreset = 'wish' | 'general' | 'own' | 'had' | 'accessory' | 'model'

export interface CreateSpec {
  preset: CreatePreset
  /** The thing an accessory belongs to, or the general wish a model is of. */
  parent?: ShopItem
  /** A wish added from a place that knows more (a title, a category, a store). */
  defaults?: { title?: string; categoryId?: string; platform?: string }
}

/** One draft: the record's edits over the blank row, what the autofill kept, and what only a created thing has. */
export interface CreateState {
  /** Something you own is made as "I still have it" or "I had it" (it switches in the popup). */
  had: boolean
  /** A wish is made as "One product" or "Any model that fits" (it switches in the popup). */
  general: boolean
  draft: RecordDraft
  facts: Fact[]
  /** A read receipt line that started it: its other lines can be added as accessories. */
  receipt: ReceiptFill | null
  withOthers: boolean
  /** The receipt's extra costs this draft carries (shipping, an extended warranty, a discount…): each ticked one is saved with the thing as a cost of it. */
  costs: DraftCost[]
  /** "Paid with money from" and "Money went to": the money links of a thing you own or had. */
  paidFrom: string
  moneyTo: string
  /** The row it was saved as (a saved line shows ✓ and keeps its draft as it was). */
  savedId: string | null
  skipped: boolean
  /** A sold line of a read receipt that matches none of your things: "I had it" with the day it left and what it sold for REQUIRED. */
  needSale: boolean
  /** The draft as it started, to tell what was changed. */
  start: string
}

/** One extra cost of a draft: the receipt's own words and signed amount (money off is negative), ticked unless the owner unticks it. */
export interface DraftCost extends ReceiptCostFill { id: string; on: boolean }

/** What a line of a read receipt starts with beyond its own facts. */
export interface LinePreset {
  /** A sold line that is none of your things: made as something you had, sold. */
  had?: { amount?: number; currency?: ShopCurrency; day?: string; to?: string }
  /** The thing already sold in the app whose money paid for this one. */
  paidFrom?: string
  /** The thing this sold-and-saved one's money went to (a bought line saved first). */
  moneyTo?: string
}

/** Several drafts at once: the lines of a read receipt, each kept while the owner moves between them. */
export interface CreateBatch {
  fills: readonly ReceiptFill[]
  /** Each line's name as the receipt printed it (the stepper's words before a line has its own name). */
  labels: readonly string[]
  /** Per line, what it starts with beyond the receipt (a sold line's "I had it", the money links). */
  presets?: readonly (LinePreset | undefined)[]
  /** Drafts as they were saved, to edit again after "Undo all from these receipts": they replace the starting drafts. */
  restore?: readonly (CreateState | undefined)[]
  /** A line was saved: its place, the row the database answered with, and the draft as it was saved. */
  onSaved?: (index: number, row: ShopItem, state: CreateState) => void
  /** The popup closed (every line saved or skipped, or the owner closed it). */
  onClosed?: () => void
}

/** The kind of state the facts list by: to buy, a general wish, yours, or gone. */
export function stateOf(spec: CreateSpec, had: boolean, general = false): 'buy' | 'general' | 'mine' | 'gone' {
  if (spec.preset === 'general' || (spec.preset === 'wish' && general)) return 'general'
  if (spec.preset === 'wish' || spec.preset === 'model') return 'buy'
  if (spec.preset === 'accessory') return spec.parent && spec.parent.status !== 'bought' ? 'buy' : had ? 'gone' : 'mine'
  return had ? 'gone' : 'mine'
}

const snapshot = (s: Pick<CreateState, 'draft' | 'facts' | 'had' | 'general' | 'paidFrom' | 'moneyTo' | 'withOthers' | 'costs'>) => JSON.stringify([s.draft, s.facts, s.had, s.general, s.paidFrom, s.moneyTo, s.withOthers, s.costs])

/** A blank draft for the preset, with what its place already knows (the parent's day, category and store). */
export function blankState(spec: CreateSpec, categories: readonly ShopCategory[], today: string): CreateState {
  const { preset, parent, defaults } = spec
  const draft: RecordDraft = {}
  const owns = stateOf(spec, preset === 'had') === 'mine' || stateOf(spec, preset === 'had') === 'gone'
  if (owns) { draft.approx_dates = true; draft.bought_day = '' }
  if (defaults?.title) draft.title = defaults.title
  if (defaults?.platform) draft.platform = defaults.platform
  if (defaults?.categoryId && categories.some(c => c.id === defaults.categoryId)) draft.category_id = defaults.categoryId
  if (parent) {
    draft.category_id = parent.category_id
    draft.region = parent.region
    draft.currency = currencyOf(parent)
    if (parent.platform) draft.platform = parent.platform
    if (preset === 'accessory') draft.accessory_of = parent.id
    if (preset === 'model') draft.option_for = parent.id
    if (owns || parent.status === 'bought') {
      const day = parent.bought_at ? parent.bought_at.slice(0, 10) : today
      draft.bought_day = day
      draft.approx_dates = !!parent.approx_dates
    }
  }
  const state: CreateState = { had: preset === 'had', general: preset === 'general', draft, facts: [], receipt: null, withOthers: false, costs: [], paidFrom: '', moneyTo: '', savedId: null, skipped: false, needSale: false, start: '' }
  return { ...state, start: snapshot(state) }
}

/** The row the record's facts start from: blank, but of the right kind. The draft is laid over it. */
export function baseItem(spec: CreateSpec, had: boolean, general = false): ShopItem {
  const kind = stateOf(spec, had, general)
  const owns = kind === 'mine' || kind === 'gone'
  return {
    id: '', user_id: '', category_id: null, title: '', notes: null, price: null, price_source: null, platform: null, url: null,
    priority: 'medium', region: null, planned_date: null, status: owns ? 'bought' : 'wishlist', source_type: 'manual', created_at: '', updated_at: '',
    list: 'wishlist', currency: 'NOK', kind: kind === 'general' ? 'general' : 'item', approx_dates: owns,
    disposal: kind === 'gone' ? 'sold' : null, accessory_of: null, option_for: null,
  }
}

/** The thing as the facts see it: the base row with the draft on top. */
export const viewOf = (spec: CreateSpec, s: CreateState): ShopItem & RecordDraft => ({ ...baseItem(spec, s.had, s.general), ...s.draft })

export const isDirty = (s: CreateState): boolean => snapshot(s) !== s.start

/**
 * A change to the record's draft. A changed currency takes the typed rate with it (a rate is for one currency: "1 EUR =
 * 11.5 NOK" is not "1 USD ="), the sale's as well — the database then freezes the rate of the day.
 */
export function applyDraftPatch(draft: RecordDraft, p: RecordDraft): RecordDraft {
  const next: RecordDraft = { ...draft, ...p }
  if ('currency' in p && p.currency !== draft.currency && !('fx_nok' in p)) { next.fx_nok = null; next.fx_source = null }
  if ('sale_currency' in p && p.sale_currency !== draft.sale_currency && !('sale_fx_nok' in p)) { next.sale_fx_nok = null; next.sale_fx_source = null }
  return next
}

// ── the autofill's draft ─────────────────────────────────────────────────────

/** The add form's draft of a created thing, for the link reader, the scan and the "Filled in for you" list. */
export function shopDraftOf(spec: CreateSpec, s: CreateState, categories: readonly ShopCategory[]): ShopDraft {
  const v = viewOf(spec, s)
  const pick = isNewCategory(v.category_id) ? newPickOf(v.category_id) : pickOf(v.category_id, categories)
  return {
    title: v.title, list: 'wishlist', topId: pick.topId, newTop: v.new_top ?? '', subId: pick.subId, newSub: v.new_sub ?? '',
    notes: v.notes ?? '', price: v.price, currency: currencyOf(v), platform: v.platform ?? '', url: v.url ?? '', priority: v.priority,
    region: v.region ?? '', plannedDate: v.planned_date ?? '', status: v.status, general: v.kind === 'general',
    priceMin: v.price_min ?? null, priceMax: v.price_max ?? null, requirements: v.requirements ?? '', reason: v.reason ?? '', image: v.image_url ?? null,
    facts: s.facts,
  }
}

/** A change of the add form's draft, put on the record's draft: the same fields, the facts alongside. */
export function withShopPatch(spec: CreateSpec, s: CreateState, categories: readonly ShopCategory[], patch: Partial<ShopDraft>): CreateState {
  if (!Object.keys(patch).length) return s
  const was = shopDraftOf(spec, s, categories)
  const draft: RecordDraft = { ...s.draft }
  if ('title' in patch) draft.title = patch.title as string
  if ('notes' in patch) draft.notes = (patch.notes as string) || null
  if ('price' in patch) draft.price = patch.price as number | null
  if ('currency' in patch) Object.assign(draft, applyDraftPatch(draft, { currency: patch.currency as ShopCurrency }))
  if ('platform' in patch) draft.platform = (patch.platform as string) || null
  if ('url' in patch) draft.url = (patch.url as string) || null
  if ('image' in patch) draft.image_url = (patch.image as string | null) || null
  if ('region' in patch) draft.region = (patch.region as ShopDraft['region']) || null
  if ('priority' in patch) draft.priority = patch.priority as ShopDraft['priority']
  if ('topId' in patch || 'subId' in patch) {
    const p = { topId: patch.topId ?? was.topId, subId: patch.subId ?? was.subId }
    const made = newCategoryId(p)
    if (made) draft.category_id = made
    else { draft.category_id = categoryIdOf(p); delete draft.new_top; delete draft.new_sub }
  }
  return { ...s, draft, facts: patch.facts ?? s.facts }
}

/**
 * A preset on a line's draft. A sold line that is none of your things is something you HAD: it starts sold, with the
 * receipt's day, amount and buyer, and needs both the day and the amount before it can be saved. Its receipt price is the
 * SALE's, never what was paid, and its receipt day the day it left, never the day it was bought.
 */
export function applyPreset(s: CreateState, preset: LinePreset | undefined): CreateState {
  if (!preset) return s
  let next: CreateState = { ...s, paidFrom: preset.paidFrom ?? s.paidFrom, moneyTo: preset.moneyTo ?? s.moneyTo }
  if (preset.had) {
    const h = preset.had
    const draft: RecordDraft = { ...next.draft, disposal: 'sold' }
    if (h.day) draft.disposed_on = h.day
    if (h.amount !== undefined && h.currency) { draft.sale_price = h.amount; draft.sale_currency = h.currency }
    if (h.to) draft.sold_to = h.to
    next = { ...next, had: true, needSale: true, draft }
  }
  return { ...next, start: snapshot(next) }
}

/**
 * The fill of a sold line that becomes something you had. A sold receipt describes the SALE, not the purchase: its price, day,
 * store (the buyer or marketplace), channel and warranty are never put on the thing as where, when or how it was bought, and
 * the condition printed is what it was sold as. What stays is the name, brand, model and category.
 */
export const hadFill = (fill: ReceiptFill): ReceiptFill => ({
  ...fill, price: undefined, currency: undefined, day: undefined, storeId: null, storeName: null, storeLabel: null, channel: undefined, condition: undefined, warrantyUntil: undefined, before: undefined, costs: [],
})

/**
 * The two money links a saved thing may make: "Paid with money from" only to a thing in `sources` (yours, already sold) and "Money
 * went to" only to one in `targets` (what the popup itself offers), whatever a preset or an old draft says. Never an id from anywhere else.
 */
export function linksAtSave(s: Pick<CreateState, 'paidFrom' | 'moneyTo'>, money: boolean, sources: ReadonlySet<string>, targets: ReadonlySet<string>): { from: string | null; to: string | null } {
  return { from: s.paidFrom && sources.has(s.paidFrom) ? s.paidFrom : null, to: money && s.moneyTo && targets.has(s.moneyTo) ? s.moneyTo : null }
}

/** The draft after the picture its product page gave (or none): a fact of its own origin, filling the picture only while the field is empty or still the page's. */
export function withPagePicture(spec: CreateSpec, s: CreateState, categories: readonly ShopCategory[], fact: Fact | null): CreateState {
  const before = shopDraftOf(spec, s, categories)
  const facts = mergeFacts(s.facts, 'page', fact ? [fact] : [])
  return withShopPatch(spec, s, categories, { facts, ...fieldsAfter(before, s.facts, facts) })
}

/** What a read receipt line gives a draft (the add sheet's path): facts with their source, the day and the note — never over what was typed. */
export function withReceipt(spec: CreateSpec, s: CreateState, categories: readonly ShopCategory[], fill: ReceiptFill, nowIso: string): CreateState {
  const before = shopDraftOf(spec, s, categories)
  // A new pick drops the picture an earlier pick's page gave; the new line's page is read again (ShopCreate).
  const facts = mergeFacts(mergeFacts(s.facts, 'page', []), 'receipt', receiptFacts(fill, nowIso, categories))
  let next = withShopPatch(spec, s, categories, { facts, ...fieldsAfter(before, s.facts, facts) })
  const draft: RecordDraft = { ...next.draft }
  const note = fill.note && !(draft.notes ?? '').includes(fill.note) ? ((draft.notes ?? '').trim() ? `${(draft.notes ?? '').trim()}\n${fill.note}` : fill.note) : null
  if (note) draft.notes = note
  // The day follows the same rule as a fact: only while empty or still the earlier receipt's own.
  const was = s.receipt?.day ?? ''
  if (fill.day && (!draft.bought_day || draft.bought_day === was) && OWNS_KIND(spec, s)) { draft.bought_day = fill.day; draft.approx_dates = false }
  if (fill.condition === 'used' && OWNS_KIND(spec, s)) draft.used = true
  // The discount's other half: what it cost before. Only into an empty field or the earlier receipt's own (never over what was typed).
  const wasBefore = s.receipt?.before
  if (fill.before !== undefined && fill.currency && (draft.market_price == null || draft.market_price === wasBefore)) { draft.market_price = fill.before; draft.market_currency = fill.currency as ShopCurrency }
  else if (fill.before === undefined && wasBefore !== undefined && draft.market_price === wasBefore) { draft.market_price = null; draft.market_currency = undefined }
  // The receipt's extra costs: this pick's replace the earlier pick's (a cost the owner moved here from another draft stays).
  const mine = s.costs.filter(c => !c.id.startsWith('r:'))
  const costs = [...mine, ...(fill.costs ?? []).map((c, i) => ({ ...c, id: `r:${i}`, on: true }))]
  next = { ...next, draft, receipt: fill, costs }
  return next
}

const OWNS_KIND = (spec: CreateSpec, s: CreateState) => { const k = stateOf(spec, s.had, s.general); return k === 'mine' || k === 'gone' }

// ── what a save needs ────────────────────────────────────────────────────────

/** Whether a thing that left brought money back (sold, traded in, other): "Money went to" and the sale's price only exist then. */
export function hasMoney(spec: CreateSpec, s: CreateState): boolean {
  if (stateOf(spec, s.had, s.general) !== 'gone') return false
  const how = viewOf(spec, s).disposal ?? 'sold'
  return how === 'sold' || how === 'traded_in' || how === 'other'
}

/** Why Save waits, in a few words, or null when it can go. */
export function missingFor(spec: CreateSpec, s: CreateState, today: string): string | null {
  const v = viewOf(spec, s)
  if (!v.title.trim()) return 'a name'
  if (newCategoryMissing(v)) return 'the new category\'s name'
  const kind = stateOf(spec, s.had, s.general)
  if (kind === 'mine' || kind === 'gone') {
    const day = s.draft.bought_day ?? ''
    // A sold line of a read receipt names everything it still needs at once; any other draft names the first thing.
    const all: string[] = []
    if (!day) { if (!s.needSale || kind !== 'gone') return 'the day it was bought'; all.push('the day it was bought') }
    if (day > today) return 'a day that is not in the future'
    if (kind === 'gone') {
      if (!v.disposed_on) all.push('the day it left')
      if (s.needSale && hasMoney(spec, s) && v.sale_price == null) all.push('what it sold for')
      if (all.length) return all.length > 1 ? `${all.slice(0, -1).join(', ')} and ${all[all.length - 1]}` : all[0]
      if ((v.disposed_on as string) < day) return 'a day it left that is not before it was bought'
    }
  }
  return null
}

/** The row to write, with the category already made (`categoryId`). The facts the owner kept go with their sources. */
export function inputOf(spec: CreateSpec, s: CreateState, categoryId: string | null, categories: readonly ShopCategory[]): CreateShopItemInput {
  const v = viewOf(spec, s)
  const kind = stateOf(spec, s.had, s.general)
  const view = shopDraftOf(spec, s, categories)
  const kept = factsToSave(s.facts, view)
  const base: CreateShopItemInput = {
    title: v.title.trim(), list: 'wishlist', category_id: categoryId, notes: v.notes?.trim() || null, platform: v.platform?.trim() || null,
    region: v.region ?? null, reason: v.reason ?? null,
    ...(kept.ean ? { ean: kept.ean } : {}),
    ...(kept.facts ? { facts: kept.facts } : {}),
  }
  // The record's "Accessory of" fact may name another thing than the one it opened from.
  const parentId = v.accessory_of ?? (spec.preset === 'accessory' ? spec.parent?.id : undefined)
  if (parentId) base.accessory_of = parentId
  if (spec.preset === 'model' && spec.parent) base.option_for = spec.parent.id
  if (kind === 'general') {
    return { ...base, kind: 'general', price: null, currency: currencyOf(v), platform: null, url: null, planned_date: null, priority: v.priority,
      price_min: v.price_min ?? null, price_max: v.price_max ?? null, requirements: v.requirements?.trim() || null }
  }
  const common: CreateShopItemInput = {
    ...base, price: v.price, currency: v.price != null ? currencyOf(v) : null, url: v.url?.trim() || null, image_url: v.image_url ?? null, priority: v.priority,
  }
  if (kind === 'buy') {
    return { ...common, planned_date: v.planned_date ?? null, wait_for_deal: !!v.wait_for_deal, deal_note: v.deal_note ?? null, target_price: v.target_price ?? null, errand: !!v.errand }
  }
  const out: CreateShopItemInput = {
    ...common, status: 'bought', bought_at: middayIso(s.draft.bought_day as string), approx_dates: !!v.approx_dates,
    price: v.got_as_gift && v.price == null ? 0 : v.price, currency: v.price != null || v.got_as_gift ? currencyOf(v) : null,
    got_as_gift: !!v.got_as_gift, used: !!v.used, for_resale: !!v.for_resale, ...(v.kept === false ? { kept: false } : {}),
    ...(v.fx_nok != null && currencyOf(v) !== 'NOK' ? { fx_nok: v.fx_nok, fx_source: v.fx_source ?? 'manual' } : {}),
    ...(v.market_price != null ? { market_price: v.market_price, market_currency: v.market_currency ?? currencyOf(v) } : {}),
    ...(v.serial ? { serial: v.serial } : {}),
  }
  if (kind === 'mine' && v.value_now != null) {
    out.value_now = v.value_now
    out.value_currency = v.value_currency ?? 'NOK'
    out.value_on = v.value_on ?? localDay(new Date().toISOString())
  }
  if (kind === 'gone') {
    const how = v.disposal ?? 'sold'
    const money = how === 'sold' || how === 'traded_in' || how === 'other'
    Object.assign(out, {
      disposal: how, disposed_on: v.disposed_on, sold_to: v.sold_to?.trim() || null,
      ...(money && v.sale_price != null ? { sale_price: v.sale_price, sale_currency: v.sale_currency ?? currencyOf(v) } : {}),
      ...(money && v.sale_price != null && v.sale_fx_nok != null && (v.sale_currency ?? currencyOf(v)) !== 'NOK' ? { sale_fx_nok: v.sale_fx_nok, sale_fx_source: v.sale_fx_source ?? 'manual' } : {}),
    })
  }
  return out
}

/** Only an accessory's "Add another" is quiet (the popup says "Added: …"); every plain Save names the thing, with Undo. */
export const quietSave = (spec: CreateSpec, another: boolean): boolean => spec.preset === 'accessory' && another
