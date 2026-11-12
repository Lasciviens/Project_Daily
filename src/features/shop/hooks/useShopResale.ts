import { useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { useRowsDelete } from '../../../shared/hooks/useRowsDelete'
import { qk, STALE } from '../../../shared/query'
import { putRowsInCache } from '../../../shared/query/cachePatch'
import { formatMoney } from '../../settings/subscriptionRules'
import {
  addResaleDefaults, createAdNote, createChecklist, createListing, createTradeInQuote, fetchAdNotes, fetchAdTemplates,
  fetchChecklists, fetchListings, fetchTradeInQuotes, fetchValueHistory, updateAdTemplate, updateListing,
} from '../api/shopResaleApi'
import { priceNow, withPriceChange } from '../listingNudge'
import type {
  CreateAdNoteInput, CreateChecklistInput, CreateListingInput, CreateTradeInQuoteInput, ShopAdNote, ShopAdTemplate,
  ShopHandoverChecklist, ShopListing, ShopTradeInQuote, UpdateAdTemplateInput, UpdateListingInput,
} from '../resaleTypes'

// Resale and selling (migration 192). Each write answers its row: the cached list takes it at once (a new row is
// added, a changed one replaced) and the list refreshes in the background. Every write says its result; a change
// of a listing's state or price offers Undo (it writes the fields as they were); every delete asks, then
// "… deleted · Undo" (the one delete flow, migration 144). Selling itself — Sold — is the sale (useRecordSale),
// which closes the listing in the database.

// ── Reads ────────────────────────────────────────────────────────────────────

export function useAdNotes() {
  return useQuery({ queryKey: qk.shop.adNotes(), queryFn: fetchAdNotes, staleTime: STALE.default })
}
export function useTradeInQuotes() {
  return useQuery({ queryKey: qk.shop.tradeIns(), queryFn: fetchTradeInQuotes, staleTime: STALE.default })
}
/** Every "Could sell for" with its day — under the items' key: a value edit is an item write, so it refreshes this too. */
export function useValueHistory() {
  return useQuery({ queryKey: qk.shop.valueHistory(), queryFn: fetchValueHistory, staleTime: STALE.default })
}
export function useListings() {
  return useQuery({ queryKey: qk.shop.listings(), queryFn: fetchListings, staleTime: STALE.short })
}
export function useAdTemplates() {
  return useQuery({ queryKey: qk.shop.adTemplates(), queryFn: fetchAdTemplates, staleTime: STALE.long })
}
export function useHandoverChecklists() {
  return useQuery({ queryKey: qk.shop.handovers(), queryFn: fetchChecklists, staleTime: STALE.long })
}

/** A new row joins the cached list (once). */
function addToCache<T extends { id: string }>(qc: QueryClient, key: QueryKey, row: T): void {
  qc.setQueryData<T[]>(key, rows => (rows && !rows.some(r => r.id === row.id) ? [...rows, row] : rows))
}

// ── Ad notes ─────────────────────────────────────────────────────────────────

/** "+ Note an ad": "Ad noted · finn.no · Undo" — Undo takes the note out again (the one delete flow, without asking). */
export function useCreateAdNote() {
  const qc = useQueryClient()
  const del = useRowsDelete({ table: 'shop_ad_notes', action: 'undo_create_shop_ad_note', invalidates: [qk.shop.adNotes()], cache: qk.shop.adNotes() })
  return useMutationWithFeedback({
    action:      'create_shop_ad_note',
    silent:      'its own toast reports it with Undo ("Ad noted · finn.no · Undo")',
    mutationFn:  (input: CreateAdNoteInput) => createAdNote(input),
    onSuccess:   (n: ShopAdNote) => {
      addToCache(qc, qk.shop.adNotes(), n)
      toast.undo(`Ad noted${n.marketplace ? ` · ${n.marketplace}` : ''}`, () => { void del.run([n.id], { title: 'Take out this noted ad?', ask: false, done: 'Noted ad taken out' }) })
    },
    invalidates: [qk.shop.adNotes()],
  })
}

/** Asks, deletes, "Noted ad deleted · Undo". */
export function useDeleteAdNote() {
  const del = useRowsDelete({ table: 'shop_ad_notes', action: 'delete_shop_ad_note', invalidates: [qk.shop.adNotes()], cache: qk.shop.adNotes() })
  return {
    run: (n: ShopAdNote) => del.run([n.id], { title: 'Delete this noted ad?', message: n.marketplace ?? undefined, done: 'Noted ad deleted' }),
    busy: del.busy,
  }
}

// ── Trade-in quotes ──────────────────────────────────────────────────────────

export function useCreateTradeInQuote() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'create_shop_trade_in_quote',
    successMessage: (q: ShopTradeInQuote) => `Trade-in quote added · ${formatMoney(q.amount, q.currency)}`,
    mutationFn:     (input: CreateTradeInQuoteInput) => createTradeInQuote(input),
    onSuccess:      (q: ShopTradeInQuote) => addToCache(qc, qk.shop.tradeIns(), q),
    invalidates:    [qk.shop.tradeIns()],
  })
}

/** Asks, deletes, "Trade-in quote deleted · Undo". */
export function useDeleteTradeInQuote() {
  const del = useRowsDelete({ table: 'shop_trade_in_quotes', action: 'delete_shop_trade_in_quote', invalidates: [qk.shop.tradeIns()], cache: qk.shop.tradeIns() })
  return {
    run: (q: ShopTradeInQuote) => del.run([q.id], { title: 'Delete this trade-in quote?', message: q.dealer, done: 'Trade-in quote deleted' }),
    busy: del.busy,
  }
}

// ── Listings ─────────────────────────────────────────────────────────────────

/** Listed (the ad written) or for sale (the ad up): "Listed · Headphones" / "For sale · Headphones". */
export function useCreateListing() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'create_shop_listing',
    successMessage: (l: ShopListing, v: { input: CreateListingInput; title: string; today: string }) =>
      `${l.status === 'for_sale' ? 'For sale' : 'Listed'} · ${v.title}`,
    mutationFn:     ({ input, today }: { input: CreateListingInput; title: string; today: string }) => createListing(input, today),
    onSuccess:      (l: ShopListing) => addToCache(qc, qk.shop.listings(), l),
    invalidates:    [qk.shop.listings()],
  })
}

/** The fields a change wrote, as they were — what its Undo writes back. */
function before(l: ShopListing, patch: UpdateListingInput): UpdateListingInput {
  const out: UpdateListingInput = {}
  for (const k of Object.keys(patch) as (keyof UpdateListingInput)[]) {
    if (k === 'status') {
      // Sold is never written by hand: a listing the app changed was listed, for sale or withdrawn.
      if (l.status !== 'sold') out.status = l.status
    } else {
      (out as Record<string, unknown>)[k] = l[k]
    }
  }
  // Going back to For sale or Withdrawn keeps the days it had.
  if ('status' in patch) {
    out.for_sale_on = l.for_sale_on
    out.ended_on = l.ended_on
  }
  return out
}

interface ListingChange { listing: ShopListing; patch: UpdateListingInput; done: string; today: string }

/**
 * A listing changed by hand, with Undo: `done` is what the toast says ("For sale on finn.no", "Taken down",
 * "Price lowered to 2 200 NOK"); Undo writes the changed fields back as they were.
 */
export function useChangeListing() {
  const qc = useQueryClient()
  const undo = useMutationWithFeedback({
    action:         'undo_shop_listing_change',
    successMessage: (_l: ShopListing, v: ListingChange) => v.done,
    mutationFn:     ({ listing, patch, today }: ListingChange) => updateListing(listing, patch, today),
    onSuccess:      (l: ShopListing) => putRowsInCache(qc, qk.shop.listings(), [l]),
    invalidates:    [qk.shop.listings()],
  })
  return useMutationWithFeedback({
    action:      'change_shop_listing',
    silent:      'its own toast reports it with Undo ("Taken down · Undo")',
    mutationFn:  ({ listing, patch, today }: ListingChange) => updateListing(listing, patch, today),
    onSuccess:   (l: ShopListing, v: ListingChange) => {
      putRowsInCache(qc, qk.shop.listings(), [l])
      const back = before(v.listing, v.patch)
      toast.undo(v.done, () => undo.mutate({ listing: l, patch: back, done: `${v.done} — undone`, today: v.today }))
    },
    invalidates: [qk.shop.listings()],
  })
}

/** The patch for a new price from `today` (one a day: a second change that day replaces the first); null when it can't. */
export function priceChangePatch(listing: ShopListing, price: number, today: string): UpdateListingInput | null {
  const prices = withPriceChange(listing.prices, price, today)
  return prices ? { prices } : null
}

/** "Price lowered to 2 200 NOK" / "Price raised to …" / "Price set to …". */
export function priceChangeWords(listing: ShopListing, price: number): string {
  const was = priceNow(listing)
  const verb = price < was ? 'lowered' : price > was ? 'raised' : 'set'
  return `Price ${verb} to ${formatMoney(price, listing.currency)}`
}

// ── Ad templates and hand-over checklists ────────────────────────────────────

export function useUpdateAdTemplate() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'update_shop_ad_template',
    successMessage: 'Template saved',
    mutationFn:     ({ id, patch }: { id: string; patch: UpdateAdTemplateInput }) => updateAdTemplate(id, patch),
    onSuccess:      (t: ShopAdTemplate) => putRowsInCache(qc, qk.shop.adTemplates(), [t]),
    invalidates:    [qk.shop.adTemplates()],
  })
}

export function useCreateChecklist() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'create_shop_handover_checklist',
    successMessage: (c: ShopHandoverChecklist) => `Checklist added · ${c.category}`,
    mutationFn:     (input: CreateChecklistInput) => createChecklist(input),
    onSuccess:      (c: ShopHandoverChecklist) => addToCache(qc, qk.shop.handovers(), c),
    invalidates:    [qk.shop.handovers()],
  })
}

/** "Put back the default texts": the templates and checklists you have none of. "2 default texts put back" / "…already there". */
export function useAddResaleDefaults() {
  return useMutationWithFeedback({
    action:         'add_shop_resale_defaults',
    successMessage: (n: number) => (n > 0 ? `${n} default text${n === 1 ? '' : 's'} put back` : 'The default texts are all there already'),
    mutationFn:     () => addResaleDefaults(),
    invalidates:    [qk.shop.adTemplates(), qk.shop.handovers()],
  })
}
