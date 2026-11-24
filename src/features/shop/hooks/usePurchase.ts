import { useQueryClient } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk } from '../../../shared/query'
import { putRowsInCache } from '../../../shared/query/cachePatch'
import { formatMoney } from '../../settings/subscriptionRules'
import { createShopCost } from '../api/shopApi'
import { addRebate, removeCost, savePurchase, type PurchasePatch, type PurchaseWrite } from '../api/shopPurchaseApi'
import { useFillRatesNow } from './useShopMoney'
import type { CreateShopCostInput, ShopCurrency, ShopItemCost } from '../types'

// Just bought, Arrived, a search noted on a wish, and money got back. Each write answers what was there before:
// the toast's Undo writes it back exactly.

type SaveVars = { id: string; patch: PurchasePatch; done: string; /** A read receipt's extra costs for this thing, written right after it (and taken off again by its Undo). */ costs?: Omit<CreateShopCostInput, 'item_id'>[] }

/** Write a purchase's facts back exactly — the Undo of a save; `done` is what it says. */
function usePutPurchase() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'put_shop_purchase',
    successMessage: (_: PurchaseWrite, v: SaveVars) => v.done,
    mutationFn:     (v: SaveVars) => savePurchase(v.id, v.patch),
    onSuccess:      (r: PurchaseWrite) => putRowsInCache(qc, qk.shop.items(), [r.after]),
    invalidates:    [qk.shop.items()],
  })
}

/**
 * Save a purchase's facts — "Purchase saved · Undo" (or the caller's words: "Arrived 10.11.2026 — return by
 * 24.11.2026"). Before migration 191 the write says so by name (NEEDS_191_ITEM) and nothing is saved.
 */
export function useSavePurchase() {
  const qc = useQueryClient()
  const put = usePutPurchase()
  const fill = useFillRatesNow()
  return useMutationWithFeedback({
    action:      'save_shop_purchase',
    silent:      'its own toast reports it with Undo ("Purchase saved · Undo")',
    mutationFn:  async (v: SaveVars): Promise<PurchaseWrite> => {
      const r = await savePurchase(v.id, v.patch)
      const costIds: string[] = []
      for (const c of v.costs ?? []) costIds.push((await createShopCost({ ...c, item_id: v.id })).id)
      return { ...r, costIds }
    },
    onSuccess:   (r: PurchaseWrite, v: SaveVars) => {
      putRowsInCache(qc, qk.shop.items(), [r.after])
      const n = r.costIds?.length ?? 0
      if ((v.costs ?? []).some(c => c.currency && c.currency !== 'NOK')) fill()
      toast.undo(n ? `${v.done} · ${n} extra ${n === 1 ? 'cost' : 'costs'}` : v.done, () => {
        put.mutate({ id: v.id, patch: r.before, done: 'Undone' })
        for (const id of r.costIds ?? []) void removeCost(id).then(() => qc.invalidateQueries({ queryKey: qk.shop.costs() }))
      })
    },
    invalidates: [qk.shop.items(), qk.shop.costs()],
  })
}

/** Money got back on a thing — a rebate, counted off what it cost: "500 NOK back · Undo". */
export function useGotMoneyBack() {
  const qc = useQueryClient()
  const undo = useMutationWithFeedback({
    action:         'undo_shop_rebate',
    successMessage: 'Money back taken off again',
    mutationFn:     (id: string) => removeCost(id),
    invalidates:    [qk.shop.costs()],
  })
  return useMutationWithFeedback({
    action:      'add_shop_rebate',
    silent:      'its own toast reports it with Undo ("500 NOK back · Undo")',
    mutationFn:  (v: { itemId: string; amount: number; currency: ShopCurrency; label: string; on: string }) => addRebate(v),
    onSuccess:   (row: ShopItemCost) => {
      qc.setQueryData<ShopItemCost[]>(qk.shop.costs(), rows => (rows ? [...rows, { ...row, amount: Number(row.amount) }] : rows))
      toast.undo(`${formatMoney(Math.abs(Number(row.amount)), row.currency)} back — counted off what it cost`, () => undo.mutate(row.id))
    },
    invalidates: [qk.shop.costs()],
  })
}
