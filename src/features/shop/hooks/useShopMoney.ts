import { useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { logError } from '../../../shared/utils/logError'
import { qk, STALE } from '../../../shared/query'
import {
  createShopCost, createShopLink, deleteShopCost, deleteShopLink, fetchShopCosts, fetchShopLinks,
  recordSale, restoreShopCost, undoSale, updateShopCost, type SaleInput,
} from '../api/shopApi'
import { fillRates } from '../api/shopPriceApi'
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

export function useCreateShopLink() {
  return useMutationWithFeedback({
    action:      'create_shop_link',
    mutationFn:  (input: { from_id: string; to_id: string; amount?: number | null }) => createShopLink(input),
    invalidates: [qk.shop.links()],
  })
}

export function useDeleteShopLink() {
  return useMutationWithFeedback({
    action:      'delete_shop_link',
    mutationFn:  (id: string) => deleteShopLink(id),
    invalidates: [qk.shop.links()],
  })
}

export function useCreateShopCost() {
  const fill = useFillRatesNow()
  return useMutationWithFeedback({
    action:      'create_shop_cost',
    mutationFn:  (input: CreateShopCostInput) => createShopCost(input),
    onSuccess:   (row: ShopItemCost) => { if (row.currency !== 'NOK' && row.fx_nok == null) fill() },
    invalidates: [qk.shop.costs()],
  })
}

export function useUpdateShopCost() {
  return useMutationWithFeedback({
    action:      'update_shop_cost',
    mutationFn:  ({ id, patch }: { id: string; patch: Parameters<typeof updateShopCost>[1] }) => updateShopCost(id, patch),
    invalidates: [qk.shop.costs()],
  })
}

/** Deletes at once with Undo. */
export function useDeleteShopCost() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:      'delete_shop_cost',
    mutationFn:  (id: string) => deleteShopCost(id),
    invalidates: [qk.shop.costs()],
    onSuccess:   (row: ShopItemCost | null) => {
      if (!row) return
      toast.undo(`Removed ${row.label}`, () => {
        restoreShopCost(row)
          .then(() => qc.invalidateQueries({ queryKey: qk.shop.costs() }))
          .catch((e: Error) => { toast.error(e.message || 'Could not restore'); logError(`restore_shop_cost: ${e.message}`, { action: 'restore_shop_cost' }) })
      })
    },
  })
}

/** One sale (or giving away) in one transaction; the toast offers Undo. */
export function useRecordSale() {
  const qc = useQueryClient()
  const fill = useFillRatesNow()
  return useMutationWithFeedback({
    action:      'record_shop_sale',
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
