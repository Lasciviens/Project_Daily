import { useState } from 'react'
import { ModalShell } from '../../../../shared/modals/ModalShell'
import { Button } from '../../../../shared/ui'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { formatMoney } from '../../../settings/subscriptionRules'
import { useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../../shared/query'
import { fetchShopCosts } from '../../api/shopApi'
import { useShopStores, useStoreRules } from '../../hooks/useShopStores'
import { useWatchMap } from '../../hooks/useShopPrices'
import { useGotMoneyBack } from '../../hooks/usePurchase'
import { currencyOf, watchedPrice } from '../../shopModel'
import { gotBackOf, watchOffers, protectedPrice, protectionOf, rebateLabel, storeOfItem } from '../../purchaseModel'
import { DecimalInput } from '../../../recipes/components/foodLogKit'
import { DateFact, SourceLink } from './purchaseKit'
import type { ShopItem } from '../../types'

/**
 * Money to claim on a thing: cheaper now than what was paid (past what was already got back), while a price
 * protection holds or it can still be returned — how to claim it, and "Got 500 back", which records a rebate (a
 * cost below 0) so every sum counts it off what the thing cost. The amount is the owner's to change.
 */
export function ClaimSheet({ item, onClose }: { item: ShopItem; onClose: () => void }) {
  const today = todayStr()
  const { data: stores = [] } = useShopStores()
  const { data: rules = [] } = useStoreRules()
  // useShopCosts' query, read here so this sheet's chunk doesn't pull the page's money hooks apart.
  const { data: costs = [] } = useQuery({ queryKey: qk.shop.costs(), queryFn: fetchShopCosts, staleTime: STALE.short })
  const watches = useWatchMap()
  const got = useGotMoneyBack()
  const watch = watches.get(item.id) ?? null
  const currency = currencyOf(item)
  const store = storeOfItem(item, stores)
  const protection = store ? protectionOf(item, store, rules, today) : null
  const protectedNow = store && protection ? protectedPrice(protection, store, watch, watchOffers(watch, stores), stores) : null
  // A clean price read just now (a new offer's or the shop's own page) — never a figure that may be a used one.
  const clean = watch?.status === 'ok' && (watch.condition === 'new' || watch.condition === 'unknown')
  const now = protectedNow ?? (clean ? watchedPrice(item, watch) : null)
  const back = gotBackOf(costs.filter(c => c.item_id === item.id), currency)
  const paid = item.price != null ? item.price - back : null
  const claim = now && paid != null && now.currency === currency && now.amount < paid ? paid - now.amount : null
  const [amount, setAmount] = useState<number | null>(claim != null ? Math.round(claim) : null)
  const returnable = !!item.return_by && item.return_by >= today

  function submit() {
    if (amount == null || amount <= 0) return
    got.mutate({
      itemId: item.id, amount, currency, on: today,
      label: rebateLabel(protection ? 'protection' : 'other', protection ? store?.name ?? null : null),
    }, { onSuccess: onClose })
  }

  return (
    <ModalShell onClose={onClose} title="Money to claim" subtitle={item.title} size="sm" compact dismissible={!got.isPending}
      footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} className="ml-auto">Not now</Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={amount == null || amount <= 0} loading={got.isPending}>
            Got {amount != null && amount > 0 ? formatMoney(amount, currency) : 'it'} back
          </Button>
        </div>
      }>
      <div className="flex flex-col gap-3">
        <p className="text-body text-fg-2">
          {claim != null
            ? <>Now <span className="font-semibold tabular-nums text-fg">{formatMoney(now?.amount ?? 0, currency)}</span>{protectedNow ? ` at ${protectedNow.where}` : ''} — you paid {formatMoney(paid ?? 0, currency)}{back > 0 ? ` (after ${formatMoney(back, currency)} back)` : ''}.</>
            : 'No price under what you paid was read just now — type what you got back.'}
        </p>
        {protection && (
          <DateFact label="Claim by" day={protection.until} today={today}>
            <p className="text-meta text-fg-muted">{protection.words} <SourceLink url={protection.rule.source_url} /></p>
          </DateFact>
        )}
        {returnable && (
          <DateFact label="Or return by" day={item.return_by ?? null} today={today}>
            <p className="text-meta text-fg-muted">Return it and buy it again at the lower price, if the store won't pay the difference.</p>
          </DateFact>
        )}
        <div>
          <label htmlFor="claim-amount" className="field-label">What you got back</label>
          <span className="flex items-center gap-2">
            <DecimalInput id="claim-amount" value={amount} onValue={setAmount} placeholder="0" className="input input-sm w-[8rem] tabular-nums" />
            <span className="text-body text-fg-muted">{currency}</span>
          </span>
          <p className="mt-1 text-meta text-fg-muted">Counted off what it cost, on {formatDate(today)}.</p>
        </div>
      </div>
    </ModalShell>
  )
}
