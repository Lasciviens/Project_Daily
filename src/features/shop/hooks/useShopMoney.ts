import { useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { useRowsDelete } from '../../../shared/hooks/useRowsDelete'
import { logError } from '../../../shared/utils/logError'
import { qk, STALE } from '../../../shared/query'
import {
  createShopCost, createShopLink, deleteShopLinks, fetchShopCosts, fetchShopLinks,
  recordSale, undoSale, type SaleInput,
} from '../api/shopApi'
import { fillRates, type RatesOutcome } from '../api/shopPriceApi'
import { moneyCtx, ratesPending, type MoneyCtx } from '../ownModel'
import { useShopRates } from './useShopRates'
import { SHOP_ROWS } from './useShop'
import type { CreateShopCostInput, ShopItem, ShopItemCost } from '../types'

// Money beside the rows (migration 137): the "Paid with money from" links,
// extra costs, selling, and the NOK rates the database fills per day.

export function useShopLinks() {
  return useQuery({ queryKey: qk.shop.links(), queryFn: fetchShopLinks, staleTime: STALE.short })
}

export function useShopCosts() {
  return useQuery({ queryKey: qk.shop.costs(), queryFn: fetchShopCosts, staleTime: STALE.short })
}

/** Extra costs by item and today's rates — what every money sum needs beside the rows. */
export function useShopMoney(enabled = true): { ctx: MoneyCtx; costs: ShopItemCost[]; ratesDate: string | null; ratesFailed: boolean } {
  const { data: costs = [] } = useShopCosts()
  const { rates, date, failed } = useShopRates(enabled)
  const ctx = useMemo(() => moneyCtx(costs, rates), [costs, rates])
  return { ctx, costs, ratesDate: date, ratesFailed: failed }
}

// Once per page load at most every 30 minutes: rates are published once a
// day, and the nightly sweep fills the rest.
let lastFill = 0

/**
 * When a purchase, sale or cost waits for its day's rate, asks the function
 * to fetch Norges Bank's rates once; the rows are filled by the database.
 * Silent: until then the amount reads "rate pending", never a guess.
 */
export function useAutoFillRates(items: readonly ShopItem[], costs: readonly ShopItemCost[]) {
  const qc = useQueryClient()
  const pending = useMemo(() => ratesPending(items, costs), [items, costs])
  useEffect(() => {
    if (!pending || Date.now() - lastFill < 30 * 60_000) return
    lastFill = Date.now()
    fillRates()
      .then(r => { if (r.filled > 0) for (const key of SHOP_ROWS) void qc.invalidateQueries({ queryKey: key }) })
      .catch((e: Error) => logError(`shop_fill_rates: ${e.message}`, { action: 'shop_fill_rates' }))
  }, [pending, qc])
}

/**
 * "Fetch again" in a rate's editor: asks Norges Bank's rates now and keeps the answer (`needed`, `filled`, `pending`)
 * for the editor to say — silent otherwise; a failed call is the function's own message as a toast.
 */
export function useFetchRatesAgain() {
  return useMutationWithFeedback<RatesOutcome>({
    action: 'shop_fetch_rates',
    silent: 'the rate editor shows the answer in its own line',
    mutationFn: () => { lastFill = Date.now(); return fillRates() },
    invalidates: SHOP_ROWS,
  })
}

/** Asks for the waiting rates now (after a save that needs one), without the 30-minute pause. */
export function useFillRatesNow() {
  const qc = useQueryClient()
  return () => {
    lastFill = Date.now()
    fillRates()
      .then(r => { if (r.filled > 0) for (const key of SHOP_ROWS) void qc.invalidateQueries({ queryKey: key }) })
      .catch((e: Error) => logError(`shop_fill_rates: ${e.message}`, { action: 'shop_fill_rates' }))
  }
}

/**
 * `report: false` when the link is one step of a bigger save (Add something I own). Otherwise the toast is
 * "Money linked · Undo", and Undo deletes exactly the link this call made (never one that was there already).
 */
export function useCreateShopLink({ report = true }: { report?: boolean } = {}) {
  const undo = useMutationWithFeedback({
    action:      'undo_create_shop_link',
    successMessage: 'Link removed',
    mutationFn:  (ids: string[]) => deleteShopLinks(ids),
    invalidates: [qk.shop.links()],
  })
  return useMutationWithFeedback({
    action:      'create_shop_link',
    silent:      'its toast with Undo reports it (a step of a bigger save leaves it to that save)',
    mutationFn:  (input: { from_id: string; to_id: string; amount?: number | null }) => createShopLink(input),
    onSuccess:   ({ id, existed }) => {
      if (!report) return
      if (existed) toast.success('Money linked')
      else toast.undo('Money linked', () => undo.mutate([id]))
    },
    invalidates: [qk.shop.links()],
  })
}

/** Several links in one go (a read receipt's money chain): one toast, one Undo that deletes exactly the links this call made. */
export function useCreateShopLinks() {
  const undo = useMutationWithFeedback({
    action:      'undo_create_shop_links',
    successMessage: 'Links removed',
    mutationFn:  (ids: string[]) => deleteShopLinks(ids),
    invalidates: [qk.shop.links()],
  })
  return useMutationWithFeedback<{ made: string[]; existed: number; failed: number }, { from_id: string; to_id: string }[]>({
    action:      'create_shop_links',
    silent:      'its toast with Undo reports it',
    mutationFn:  async pairs => {
      const made: string[] = []
      let existed = 0, failed = 0
      for (const p of pairs) {
        try { const r = await createShopLink(p); if (r.existed) existed++; else made.push(r.id) } catch (e) {
          failed++
          logError(`create_shop_links: ${(e as Error).message}`, { action: 'create_shop_links' })
        }
      }
      if (!made.length && !existed && failed) throw new Error('The links were not made — try again')
      return { made, existed, failed }
    },
    onSuccess:   ({ made, existed, failed }) => {
      const words = `Money linked${made.length > 1 ? ` · ${made.length} links` : ''}${failed ? ` · ${failed} not made` : ''}`
      if (made.length) toast.undo(words, () => undo.mutate(made))
      else if (existed) toast.success('Already linked')
    },
    invalidates: [qk.shop.links()],
  })
}

export function useDeleteShopLink() {
  return useRowsDelete({ table: 'shop_item_links', action: 'delete_shop_link', invalidates: [qk.shop.links()], cache: qk.shop.links() })
}

export function useCreateShopCost() {
  const fill = useFillRatesNow()
  return useMutationWithFeedback({
    action:      'create_shop_cost',
    successMessage: (row) => (row.amount < 0 ? `Added ${row.label} (money back)` : `Added ${row.label}`),
    mutationFn:  (input: CreateShopCostInput) => createShopCost(input),
    onSuccess:   (row: ShopItemCost) => { if (row.currency !== 'NOK' && row.fx_nok == null) fill() },
    invalidates: [qk.shop.costs()],
  })
}

export function useDeleteShopCost() {
  return useRowsDelete({ table: 'shop_item_costs', action: 'delete_shop_cost', invalidates: [qk.shop.costs()], cache: qk.shop.costs() })
}

/** One sale (or giving away) in one transaction; the toast offers Undo. */
export function useRecordSale() {
  const qc = useQueryClient()
  const fill = useFillRatesNow()
  return useMutationWithFeedback({
    action:      'record_shop_sale',
    silent:      'its toast with Undo reports it',
    mutationFn:  ({ input }: { input: SaleInput; label: string }) => recordSale(input),
    invalidates: SHOP_ROWS,
    onSuccess:   (_d, { input, label }) => {
      if (input.currency !== 'NOK' && input.rows.some(r => r.sale_price != null)) fill()
      toast.undo(label, () => {
        undoSale(input.rows[0].id)
          .then(() => { for (const key of SHOP_ROWS) void qc.invalidateQueries({ queryKey: key }) })
          .catch((e: Error) => { toast.error(e.message || 'Could not undo'); logError(`undo_shop_sale: ${e.message}`, { action: 'undo_shop_sale' }) })
      })
    },
  })
}

export function useUndoSale() {
  return useMutationWithFeedback({
    action:         'undo_shop_sale',
    successMessage: 'Yours again',
    mutationFn:     (id: string) => undoSale(id),
    invalidates:    SHOP_ROWS,
  })
}
