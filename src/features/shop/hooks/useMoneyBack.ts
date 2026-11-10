import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk } from '../../../shared/query'
import { createShopCost } from '../api/shopApi'
import { REBATE_LABEL, type RebateKind } from '../complaintModel'
import { money } from '../components/shopFormat'
import { useDeleteShopCost, useFillRatesNow } from './useShopMoney'
import type { ShopCurrency, ShopItemCost } from '../types'

export interface MoneyBackInput { item_id: string; kind: RebateKind; amount: number; currency: ShopCurrency; spent_on?: string }

/**
 * "Got 500 back": money back from a claim or a price match, as a rebate on the thing — a negative extra cost, the
 * one money path for money back (137) — labelled so Stats counts it as saved. The toast offers Undo, which takes
 * the rebate off again. (Its own file: the Shop page's first download never carries it.)
 */
export function useMoneyBack() {
  const fill = useFillRatesNow()
  const del = useDeleteShopCost()
  return useMutationWithFeedback({
    action:      'record_shop_money_back',
    silent:      'its toast with Undo reports it',
    mutationFn:  (input: MoneyBackInput) => createShopCost({
      item_id: input.item_id, label: REBATE_LABEL[input.kind], amount: -Math.abs(input.amount), currency: input.currency, spent_on: input.spent_on,
    }),
    invalidates: [qk.shop.costs()],
    onSuccess:   (row: ShopItemCost, input: MoneyBackInput) => {
      if (row.currency !== 'NOK' && row.fx_nok == null) fill()
      const words = `Got ${money(Math.abs(row.amount), row.currency)} back${input.kind === 'other' ? '' : ' · counted as saved'}`
      toast.undo(words, () => {
        del.remove.mutateAsync([row.id]).then(() => toast.success('Money back taken off')).catch(() => { /* its hook toasted the failure */ })
      })
    },
  })
}
