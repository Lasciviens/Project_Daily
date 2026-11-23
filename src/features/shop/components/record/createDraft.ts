// A new Shop thing in the record's own popup (`ShopCreate`): its draft, worked out by code — pure, so
// scripts/verify-shop-create.cjs runs it against the real module.
//
// The draft is the record's own (`RecordDraft`: columns, `bought_day`, the names typed for a new category) on top of a
// blank row, so the same facts (`RecordFacts`, `factList`) edit it and a new thing looks like a record. The link reader,
// barcode scan and "Filled in for you" list (`ShopAutofill`) work on the add form's `ShopDraft`; `shopDraftOf` and
// `withShopPatch` translate between the two, so what they fill lands in the same fields.
import type { ReceiptFill } from '../../../ai/claude/featureRules'
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
  draft: RecordDraft
  facts: Fact[]
  /** A read receipt line that started it: its other lines can be added as accessories. */
  receipt: ReceiptFill | null
  withOthers: boolean
  /** "Paid with money from" and "Money went to": the money links of a thing you own or had. */
  paidFrom: string
  moneyTo: string
  /** The row it was saved as (a saved line shows ✓ and keeps its draft as it was). */
  savedId: string | null
  skipped: boolean
  /** The draft as it started, to tell what was changed. */
  start: string
}

/** The kind of state the facts list by: to buy, a general wish, yours, or gone. */
export function stateOf(spec: CreateSpec, had: boolean): 'buy' | 'general' | 'mine' | 'gone' {
  if (spec.preset === 'general') return 'general'
  if (spec.preset === 'wish' || spec.preset === 'model') return 'buy'
  if (spec.preset === 'accessory') return spec.parent && spec.parent.status !== 'bought' ? 'buy' : had ? 'gone' : 'mine'
  return had ? 'gone' : 'mine'
}

const snapshot = (s: Pick<CreateState, 'draft' | 'facts' | 'had' | 'paidFrom' | 'moneyTo' | 'withOthers'>) => JSON.stringify([s.draft, s.facts, s.had, s.paidFrom, s.moneyTo, s.withOthers])

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
  const state: CreateState = { had: preset === 'had', draft, facts: [], receipt: null, withOthers: false, paidFrom: '', moneyTo: '', savedId: null, skipped: false, start: '' }
  return { ...state, start: snapshot(state) }
}

/** The row the record's facts start from: blank, but of the right kind. The draft is laid over it. */
export function baseItem(spec: CreateSpec, had: boolean): ShopItem {
  const kind = stateOf(spec, had)
  const owns = kind === 'mine' || kind === 'gone'
  return {
    id: '', user_id: '', category_id: null, title: '', notes: null, price: null, price_source: null, platform: null, url: null,
    priority: 'medium', region: null, planned_date: null, status: owns ? 'bought' : 'wishlist', source_type: 'manual', created_at: '', updated_at: '',
    list: 'wishlist', currency: 'NOK', kind: kind === 'general' ? 'general' : 'item', approx_dates: owns,
    disposal: kind === 'gone' ? 'sold' : null, accessory_of: null, option_for: null,
  }
}

/** The thing as the facts see it: the base row with the draft on top. */
export const viewOf = (spec: CreateSpec, s: CreateState): ShopItem & RecordDraft => ({ ...baseItem(spec, s.had), ...s.draft })

export const isDirty = (s: CreateState): boolean => snapshot(s) !== s.start

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
  if ('currency' in patch) draft.currency = patch.currency as ShopCurrency
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

/** What a read receipt line gives a draft (the add sheet's path): facts with their source, the day and the note — never over what was typed. */
export function withReceipt(spec: CreateSpec, s: CreateState, categories: readonly ShopCategory[], fill: ReceiptFill, nowIso: string): CreateState {
  const before = shopDraftOf(spec, s, categories)
  const facts = mergeFacts(s.facts, 'receipt', receiptFacts(fill, nowIso, categories))
  let next = withShopPatch(spec, s, categories, { facts, ...fieldsAfter(before, s.facts, facts) })
  const draft: RecordDraft = { ...next.draft }
  const note = fill.note && !(draft.notes ?? '').includes(fill.note) ? ((draft.notes ?? '').trim() ? `${(draft.notes ?? '').trim()}\n${fill.note}` : fill.note) : null
  if (note) draft.notes = note
  // The day follows the same rule as a fact: only while empty or still the earlier receipt's own.
  const was = s.receipt?.day ?? ''
  if (fill.day && (!draft.bought_day || draft.bought_day === was) && OWNS_KIND(spec, s)) { draft.bought_day = fill.day; draft.approx_dates = false }
  if (fill.condition === 'used' && OWNS_KIND(spec, s)) draft.used = true
  next = { ...next, draft, receipt: fill }
  return next
}

const OWNS_KIND = (spec: CreateSpec, s: CreateState) => { const k = stateOf(spec, s.had); return k === 'mine' || k === 'gone' }

// ── what a save needs ────────────────────────────────────────────────────────

/** Why Save waits, in a few words, or null when it can go. */
export function missingFor(spec: CreateSpec, s: CreateState, today: string): string | null {
  const v = viewOf(spec, s)
  if (!v.title.trim()) return 'a name'
  if (newCategoryMissing(v)) return 'the new category\'s name'
  const kind = stateOf(spec, s.had)
  if (kind === 'mine' || kind === 'gone') {
    const day = s.draft.bought_day ?? ''
    if (!day) return 'the day it was bought'
    if (day > today) return 'a day that is not in the future'
    if (kind === 'gone') {
      if (!v.disposed_on) return 'the day it left'
      if (v.disposed_on < day) return 'a day it left that is not before it was bought'
    }
  }
  return null
}

/** The row to write, with the category already made (`categoryId`). The facts the owner kept go with their sources. */
export function inputOf(spec: CreateSpec, s: CreateState, categoryId: string | null, categories: readonly ShopCategory[]): CreateShopItemInput {
  const v = viewOf(spec, s)
  const kind = stateOf(spec, s.had)
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
    ...(v.fx_nok != null ? { fx_nok: v.fx_nok, fx_source: v.fx_source ?? 'manual' } : {}),
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
    const money = how === 'sold' || how === 'traded_in' || how === 'other' || how === 'returned'
    Object.assign(out, {
      disposal: how, disposed_on: v.disposed_on, sold_to: v.sold_to?.trim() || null,
      ...(money && v.sale_price != null ? { sale_price: v.sale_price, sale_currency: v.sale_currency ?? currencyOf(v) } : {}),
      ...(money && v.sale_price != null && v.sale_fx_nok != null ? { sale_fx_nok: v.sale_fx_nok, sale_fx_source: v.sale_fx_source ?? 'manual' } : {}),
    })
  }
  return out
}

/** The kind of toast and Undo a save keeps from its old path: an accessory is quiet (its sheet says "Added: …"). */
export const quietSave = (spec: CreateSpec): boolean => spec.preset === 'accessory'
