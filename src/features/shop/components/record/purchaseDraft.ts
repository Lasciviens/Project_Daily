// A purchase's facts as the one body edits them (RecordBody's Purchase section, every mode): online or in a shop, the
// store, the day, Arrived, the return and complaint days with their reasons, the extra warranty, the receipt note, and
// what a read receipt adds (its paid price as a chip, its discount and normal price, its extra costs). Pure, so
// scripts/verify-shop-one-body.mjs runs it against the real module: Just bought writes exactly what it wrote before the
// three screens became one (24.11.2026), and a thing being added carries the same facts only when the owner set them.
import { formatDate } from '../../../../shared/utils/dateFormat'
import { middayIso } from '../../../media/watchedWhen'
import { matchLine, RECEIPT_CURRENCIES, type ReceiptFill, type ReceiptRead } from '../../../ai/claude/featureRules'
import { complaintYears } from '../../ownModel'
import { categoryPath } from '../../shopModel'
import { boughtDayOf, complaintYearsOf, dateSource, factsOf, storeOfItem } from '../../purchaseModel'
import { purchaseDeadlines, type PurchaseDeadlines } from '../../storeRules'
import type { PurchasePatch } from '../../api/shopPurchaseApi'
import type { CreateShopCostInput, ShopCategory, ShopCurrency, ShopItem, ShopLawRule, ShopStore, ShopStoreRule } from '../../types'

export type Channel = 'online' | 'in_store'
/** The store picker's "Somewhere else…". */
export const OTHER_STORE = 'other'
export const NOTE_MAX = 2000

/** What the owner chose in the Purchase editor; everything else is worked out from it and the row (`purchaseView`). */
export interface PurchaseForm {
  /** A store row's id, OTHER_STORE, '' for none — null while untouched (the row's own store shows). */
  storePick: string | null
  /** The typed name for "Somewhere else…" — null while untouched. */
  otherName: string | null
  day: string
  channel: Channel | null
  arrived: string
  years: 2 | 5
  keepComplain: boolean
  /** The owner's own return date; null = the rules' date; undefined = as the row had it. */
  ownReturn: string | null | undefined
  extra: string
  note: string
  /** A read receipt (Just bought's own photo, or Read a receipt's hand-off). */
  rd: { fill: ReceiptFill; read: ReceiptRead } | null
  usePaid: boolean
  useReceiptComplain: boolean
  /** The receipt's extra costs left unticked (by label + amount). */
  costOff: readonly string[]
  /** What the last receipt put in the store, the day and the other name: a later receipt replaces only those. */
  last: { store: string | null; day: string | null; other: string | null }
}

export interface PurchaseCtx {
  stores: readonly ShopStore[]
  rules: readonly ShopStoreRule[]
  law: readonly ShopLawRule[]
  categories: readonly ShopCategory[]
  today: string
}

/** The editor as it opens on a row: its own facts, the suggested complaint years when it has none. */
export function purchaseFormOf(item: ShopItem, ctx: Pick<PurchaseCtx, 'categories' | 'today'>): PurchaseForm {
  const path = categoryPath(item.category_id, ctx.categories)
  const suggested = complaintYears([path.topName ?? '', path.subName ?? ''], item.region)
  const storedYears = complaintYearsOf(item)
  const complainOwn = storedYears == null && item.warranty_until ? item.warranty_until : null
  return {
    storePick: null, otherName: null, day: boughtDayOf(item) ?? ctx.today, channel: item.bought_channel ?? null, arrived: item.arrived_on ?? '',
    years: storedYears ?? suggested, keepComplain: complainOwn != null, ownReturn: undefined, extra: item.extra_warranty_until ?? '', note: item.receipt_note ?? '',
    rd: null, usePaid: false, useReceiptComplain: false, costOff: [], last: { store: null, day: null, other: null },
  }
}

const costKey = (c: { label: string; amount: number }) => c.label + c.amount

/** Everything the editor shows, worked out from the row and the form (the deadlines with their reasons, the receipt's line). */
export function purchaseView(item: ShopItem, f: PurchaseForm, ctx: PurchaseCtx) {
  const { stores, rules, law, categories, today } = ctx
  const pickable = stores.filter(s => !s.hidden && s.kind !== 'price_site').sort((a, b) => a.name.localeCompare(b.name, 'en'))
  const first = storeOfItem(item, stores)
  const storeId = f.storePick ?? (first?.id ?? (item.platform ? OTHER_STORE : ''))
  const store: ShopStore | null = storeId && storeId !== OTHER_STORE ? stores.find(s => s.id === storeId) ?? null : null
  const other = f.otherName ?? (first ? '' : item.platform ?? '')
  const boughtDay = boughtDayOf(item) ?? today
  const path = categoryPath(item.category_id, categories)
  const suggestedYears = complaintYears([path.topName ?? '', path.subName ?? ''], item.region)
  const storedYears = complaintYearsOf(item)
  // The deadlines as the form stands; a date the owner set before stays theirs (shown beside the rules' one).
  const draft = { ...item, bought_at: middayIso(f.day), bought_channel: f.channel, arrived_on: f.channel === 'online' ? f.arrived || null : null }
  const facts = factsOf(draft, store, f.years)
  const dl: PurchaseDeadlines | null = facts ? purchaseDeadlines(facts, { store, rules, law }) : null
  const firstFacts = factsOf(item, first)
  const initial = firstFacts ? purchaseDeadlines(firstFacts, { store: first, rules, law }) : null
  const returnOwn = f.ownReturn !== undefined ? f.ownReturn
    : dateSource(item.return_by, initial?.returnBy?.day) === 'own' ? item.return_by ?? null : null
  const complainOwn = storedYears == null && item.warranty_until ? item.warranty_until : null
  const returnBy = returnOwn ?? dl?.returnBy?.day ?? null
  // The line that is this thing, and what was paid for it: the line's price; with no lines the receipt's total.
  const rd = f.rd
  const lineAt = rd?.read.items?.length ? matchLine(item.title, rd.fill.lines) : null
  const paid = !rd ? null : lineAt !== null ? rd.read.items?.[lineAt]?.price ?? null : rd.read.items?.length ? null : rd.read.total ?? null
  const paidCur = rd?.read.currency && RECEIPT_CURRENCIES.includes(rd.read.currency) ? rd.read.currency as ShopCurrency : null
  const noLine = !!rd && !!rd.read.items?.length && lineAt === null
  const line = rd && lineAt !== null ? rd.read.items?.[lineAt] ?? null : null
  const costs = rd?.fill.costs ?? []
  const receiptWarranty = rd?.fill.warrantyUntil ?? null
  const complainBy = f.useReceiptComplain && rd?.fill.warrantyUntil ? rd.fill.warrantyUntil : f.keepComplain && complainOwn ? complainOwn : dl?.complaintBy?.day ?? null
  const valid = !!f.day && f.day <= today && (!f.arrived || f.channel !== 'online' || f.arrived >= f.day) && f.note.length <= NOTE_MAX
  return {
    pickable, storeId, store, other, boughtDay, suggestedYears, dl, returnOwn, complainOwn, returnBy, complainBy,
    paid, paidCur, noLine, line, costs, costOn: (c: { label: string; amount: number }) => !f.costOff.includes(costKey(c)), receiptWarranty, valid,
  }
}

export type PurchaseView = ReturnType<typeof purchaseView>

/**
 * A read receipt on the form: the store, the day and the note (a printed warranty goes in the note); what the owner chose or
 * typed is never overwritten (only a value an earlier receipt put there is replaced). The amount and the warranty's day are
 * offered as chips, never filled. A receipt that says how it was bought sets it, once, only while it is not chosen.
 */
export function withReceiptOnForm(f: PurchaseForm, fill: ReceiptFill, read: ReceiptRead, boughtDay: string, today: string): PurchaseForm {
  const next: PurchaseForm = { ...f, rd: { fill, read }, last: { ...f.last } }
  const nextStore = fill.storeId ?? (fill.storeName ? OTHER_STORE : null)
  if (nextStore) {
    if (next.storePick === null || next.storePick === f.last.store) next.storePick = nextStore
    if (!fill.storeId && fill.storeName) {
      if (next.otherName === null || next.otherName === '' || next.otherName === f.last.other) next.otherName = fill.storeName
      next.last.other = fill.storeName
    }
    next.last.store = nextStore
  }
  if (fill.day && fill.day <= today) {
    if (next.day === boughtDay || next.day === f.last.day) next.day = fill.day
    next.last.day = fill.day
  }
  if (fill.note) next.note = next.note.includes(fill.note) ? next.note : next.note.trim() ? `${next.note.trim()}\n${fill.note}` : fill.note
  if (read.channel && next.channel == null) next.channel = read.channel as Channel
  return next
}

/** What Save writes: the purchase's columns (savePurchase), the receipt's ticked extra costs, and the toast's words. Null while it can't be saved. */
export function purchaseWrite(item: ShopItem, f: PurchaseForm, v: PurchaseView): { patch: PurchasePatch; costs: Omit<CreateShopCostInput, 'item_id'>[]; done: string } | null {
  if (!v.valid) return null
  const name = v.store ? v.store.name : v.storeId === OTHER_STORE ? v.other.trim() || null : null
  const patch: PurchasePatch = {
    bought_channel: f.channel,
    arrived_on: f.channel === 'online' ? f.arrived || null : null,
    return_by: v.returnBy,
    warranty_until: v.complainBy,
    extra_warranty_until: f.extra || null,
    receipt_note: f.note.trim() || null,
  }
  if (f.usePaid && v.paid != null && v.paidCur) { patch.price = v.paid; patch.currency = v.paidCur }
  // What the receipt says about this line's discount (and the normal price it prints), only while the thing has none and its paid
  // price is the receipt's own: never over what is there, never subtracted from the price.
  const paidIsReceipts = v.paid != null && v.paidCur != null && ((f.usePaid) || (item.price === v.paid && item.currency === v.paidCur))
  if (v.line && paidIsReceipts && v.paidCur) {
    if (v.line.discount !== undefined && item.discount_amount == null) { patch.discount_amount = v.line.discount; patch.discount_reason = v.line.discount_reason ?? 'other' }
    if (v.line.before !== undefined && item.market_price == null) { patch.market_price = v.line.before; patch.market_currency = v.paidCur }
  }
  const written = v.costs.filter(v.costOn)
  if (f.storePick !== null || f.otherName !== null) patch.platform = name
  if (f.day !== v.boughtDay) patch.bought_at = middayIso(f.day)
  return {
    patch,
    costs: written.map(c => ({ label: c.label, amount: c.amount, currency: c.currency as ShopCurrency, spent_on: f.day })),
    done: v.returnBy ? `Purchase saved — return by ${formatDate(v.returnBy)}` : 'Purchase saved',
  }
}

/**
 * The purchase facts a thing being ADDED carries, only when the owner opened its Purchase part and set them (`touched`): how it was
 * bought, Arrived, the return and complaint days and the extra warranty and receipt note — the day, the store and the price are the
 * add's own facts, never written twice. An untouched Purchase writes nothing, so an add saves exactly what it saved before.
 */
export function purchaseAtCreate(f: PurchaseForm | null, v: PurchaseView | null): Partial<Pick<ShopItem, 'bought_channel' | 'arrived_on' | 'return_by' | 'warranty_until' | 'extra_warranty_until' | 'receipt_note'>> {
  if (!f || !v) return {}
  const out: Partial<Pick<ShopItem, 'bought_channel' | 'arrived_on' | 'return_by' | 'warranty_until' | 'extra_warranty_until' | 'receipt_note'>> = {}
  if (f.channel) out.bought_channel = f.channel
  if (f.channel === 'online' && f.arrived) out.arrived_on = f.arrived
  if (v.returnBy) out.return_by = v.returnBy
  if (v.complainBy) out.warranty_until = v.complainBy
  if (f.extra) out.extra_warranty_until = f.extra
  if (f.note.trim()) out.receipt_note = f.note.trim()
  return out
}
