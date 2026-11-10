import { useQueryClient } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk } from '../../../shared/query'
import { putRowsInCache } from '../../../shared/query/cachePatch'
import { formatMoney } from '../../settings/subscriptionRules'
import { addRebate, removeCost, savePurchase, type PurchasePatch, type PurchaseWrite } from '../api/shopPurchaseApi'
import type { ShopCurrency, ShopItemCost } from '../types'

// Just bought, Arrived, a search noted on a wish, and money got back. Each write answers what was there before:
// the toast's Undo writes it back exactly.

/** The 191 columns a write had to leave out, in words. */
const DROPPED: Record<string, string> = {
  bought_channel: 'online or in a shop', arrived_on: 'Arrived', extra_warranty_until: 'the extra warranty',
  receipt_note: 'the receipt note', search_opened_on: 'the search day',
}
const droppedWords = (keys: readonly string[]) => keys.map(k => DROPPED[k] ?? k).join(', ')

type SaveVars = { id: string; patch: PurchasePatch; done: string }

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
 * 24.11.2026"). Before migration 191 the new facts are left out and the toast names them.
 */
export function useSavePurchase() {
  const qc = useQueryClient()
  const put = usePutPurchase()
  return useMutationWithFeedback({
    action:      'save_shop_purchase',
    silent:      'its own toast reports it with Undo ("Purchase saved · Undo")',
    mutationFn:  (v: SaveVars) => savePurchase(v.id, v.patch),
    onSuccess:   (r: PurchaseWrite, v: SaveVars) => {
      putRowsInCache(qc, qk.shop.items(), [r.after])
      const words = r.dropped.length ? `${v.done} — not saved yet: ${droppedWords(r.dropped)} (migration 191)` : v.done
      toast.undo(words, () => put.mutate({ id: v.id, patch: r.before, done: 'Undone' }))
    },
    invalidates: [qk.shop.items()],
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
