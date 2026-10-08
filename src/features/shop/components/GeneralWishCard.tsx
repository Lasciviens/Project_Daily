import { Plus } from 'lucide-react'
import { TonePill, Truncate } from '../../../shared/ui'
import { currencyOf, priceNow, wishRange } from '../shopModel'
import { bestMatch, metCount, openModels, requirementsOf } from '../wishModel'
import { money } from './shopFormat'
import type { UsdRates } from '../../settings/subscriptionRules'
import type { ShopItem, ShopPriceWatch } from '../types'

/**
 * A general wish on the wishlist: "A tablet with a pen · 5 000–8 000 NOK ·
 * 3 models · from 3 990", the best match and the models in the running.
 */
export function GeneralWishCard({ wish, models, watches, rates, onOpen, onOpenModel, onAddModel }: {
  wish: ShopItem
  models: ShopItem[]
  watches: ReadonlyMap<string, ShopPriceWatch>
  rates: UsdRates | null
  onOpen: () => void
  onOpenModel: (id: string) => void
  onAddModel: () => void
}) {
  const cur = currencyOf(wish)
  const open = openModels(models)
  const range = wishRange(wish, models, rates, watches)
  const price = (m: ShopItem) => priceNow(m, watches.get(m.id))
  const prices = open.map(price).filter((p): p is NonNullable<typeof p> => !!p)
  const best = bestMatch(wish, models, price)
  const reqs = requirementsOf(wish)
  return (
    <div className="card flex flex-col gap-2 p-3">
      <button type="button" onClick={onOpen} className="min-h-[44px] text-left">
        <span className="block text-ui font-semibold leading-snug text-fg">{wish.title}</span>
        <span className="block text-meta tabular-nums text-fg-muted">
          Any model{range ? ` · ${money(range.min, cur).replace(` ${cur}`, '')}–${money(range.max, cur)}` : ''}
          {` · ${open.length} model${open.length === 1 ? '' : 's'}`}
          {prices.length > 0 && ` · from ${money(Math.min(...prices.map(p => p.amount)), prices[0].currency)}`}
        </span>
      </button>
      {open.length > 0 && (
        <ul className="flex flex-col divide-y divide-line rounded-row border border-line">
          {open.slice(0, 4).map(m => {
            const p = price(m)
            const c = metCount(m, reqs)
            return (
              <li key={m.id}>
                <button type="button" onClick={() => onOpenModel(m.id)} className="flex min-h-[44px] w-full items-center gap-2 px-2.5 text-left hover:bg-surface-hover">
                  <Truncate as="span" className="min-w-0 flex-1 text-meta text-fg-2">{m.title}</Truncate>
                  {m === best && <TonePill tone="info" className="shrink-0">Best</TonePill>}
                  {reqs.length > 0 && <span className="shrink-0 text-micro tabular-nums text-fg-faint">{c.met}/{reqs.length}</span>}
                  <span className="shrink-0 text-meta tabular-nums text-fg-muted">{p ? money(p.amount, p.currency) : '—'}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <div className="mt-auto flex items-center gap-1 border-t border-line pt-1.5">
        <button type="button" onClick={onAddModel} className="btn-ghost btn-sm flex-1 justify-center text-accent-600">
          <Plus aria-hidden className="h-4 w-4" /> Model
        </button>
        <button type="button" onClick={onOpen} className="btn-ghost btn-sm flex-1 justify-center">Compare</button>
      </div>
    </div>
  )
}
