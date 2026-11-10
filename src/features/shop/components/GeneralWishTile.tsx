import { Plus, Scale } from 'lucide-react'
import { IconButton, MetaLine, TonePill, Truncate } from '../../../shared/ui'
import { currencyOf, priceNow, wishRange, type Money } from '../shopModel'
import { SHOP_PRIORITY_TONE } from '../shopMeta'
import { openModels } from '../wishModel'
import { beltOf, initialsOf, tintOf } from '../wishTile'
import { imageOf, money, moneyRange } from './shopFormat'
import { PictureWell } from './tileKit'
import type { UsdRates } from '../../settings/subscriptionRules'
import type { ShopItem, ShopPriceWatch } from '../types'

/**
 * A general wish as a picture tile: up to three of its models' pictures,
 * "from 2 299 NOK" (its cheapest model now) and "Any model · 1 500–3 500 NOK
 * · 3 models". Compare opens the record on its models; + adds one.
 */
export function GeneralWishTile({ wish, models, watches, rates, topId, today, onOpen, onAddModel }: {
  wish: ShopItem
  models: ShopItem[]
  watches: ReadonlyMap<string, ShopPriceWatch>
  rates: UsdRates | null
  topId: string | null
  today: string
  onOpen: () => void
  onAddModel: () => void
}) {
  const cur = currencyOf(wish)
  const open = openModels(models)
  const range = wishRange(wish, models, rates, watches)
  const prices = open.map(m => priceNow(m, watches.get(m.id))).filter((p): p is Money => !!p)
  // The cheapest in the wish's own currency; another currency only when no model has it.
  const same = prices.filter(p => p.currency === cur)
  const pool = same.length ? same : prices.filter(p => p.currency === prices[0]?.currency)
  const from = pool.length ? pool.reduce((a, b) => (b.amount < a.amount ? b : a)) : null
  const pictures = open.map(m => imageOf(m, watches.get(m.id))).filter((s): s is string => !!s)
  const belt = beltOf(wish, { today })

  return (
    <div className="card flex flex-col p-1.5">
      <button type="button" onClick={onOpen} className="flex flex-col rounded-row text-left">
        <PictureWell srcs={pictures} initials={initialsOf(wish.title)} tint={tintOf(topId)} belt={belt}
          corner={wish.priority !== 'medium' && (
            <TonePill tone={SHOP_PRIORITY_TONE[wish.priority]}>{wish.priority === 'high' ? 'High' : 'Low'}<span className="sr-only"> priority</span></TonePill>
          )} />
        <Truncate as="span" lines={2} className="mx-1.5 mt-2 min-h-10 text-body font-semibold text-fg">{wish.title}</Truncate>
      </button>
      <div className="flex flex-col gap-0.5 px-1.5 pb-2 pt-0.5">
        <p className="text-meta text-fg-muted">
          {from
            ? <>from <span className="whitespace-nowrap text-ui font-semibold tabular-nums text-fg">{money(from.amount, from.currency)}</span></>
            : range
              ? <span className="whitespace-nowrap text-ui font-semibold tabular-nums text-fg">{moneyRange(range.min, range.max, cur)}</span>
              : <span className="text-ui">No price yet</span>}
        </p>
        <MetaLine className="text-meta tabular-nums text-fg-muted" items={[
          'Any model',
          range && moneyRange(range.min, range.max, cur),
          `${open.length} model${open.length === 1 ? '' : 's'}`,
        ]} />
      </div>
      <div className="mt-auto flex items-center gap-1 border-t border-line pt-1">
        <button type="button" onClick={onOpen} className="btn-ghost btn-sm min-w-0 flex-1 justify-center">
          <Scale aria-hidden className="h-4 w-4" /> Compare
        </button>
        <IconButton label={`Add a model to ${wish.title}`} onClick={onAddModel}
          className="h-9 w-9 text-accent-600 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
          <Plus aria-hidden />
        </IconButton>
      </div>
    </div>
  )
}
