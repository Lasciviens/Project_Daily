import { useMemo } from 'react'
import { CardHeader, cx } from '../../../../shared/ui'
import { categoryScope, keptWords, ownershipCost, ownershipPrices, worthShowing, type OwnershipKind, type OwnershipOption } from '../../ownershipCost'
import { money, num } from '../shopFormat'
import type { ShopCategory, ShopItem, ShopPriceWatch } from '../../types'
import type { MoneyCtx } from '../../ownModel'

const KIND_LABEL: Record<OwnershipKind, string> = { new: 'New', used: 'Used', refurbished: 'Refurbished' }

/**
 * New vs used vs refurbished in a wish's record (step C): what owning each would cost you, net — its price less
 * what you would get back at your own kept % — and per month over the months yours were usually kept. New is the
 * clean read of the wish's link or your own price; used and refurbished are Prisjakt's cheapest offers on it.
 * Shown only when it has something to say: two prices, or one with its net cost (`worthShowing`).
 */
export function RecordOwnership({ item, items, categories, watch, ctx }: {
  item: ShopItem; items: readonly ShopItem[]; categories: readonly ShopCategory[]; watch: ShopPriceWatch | null; ctx: MoneyCtx
}) {
  const { cost, newFrom } = useMemo(() => {
    const { prices, currency, newFrom } = ownershipPrices(item, watch)
    return { newFrom, cost: ownershipCost({ items, categoryIds: categoryScope(item.category_id, categories), prices, currency, rates: ctx.rates }) }
  }, [item, watch, items, categories, ctx.rates])
  if (!worthShowing(cost)) return null
  const categoryName = categories.find(c => c.id === item.category_id)?.name ?? null
  // The price read above may be a mixed one: say when "New" is the wish's own price instead.
  const footnote = [newFrom === 'yours' && cost.options.length > 1 && 'New is your own price.', keptWords(cost, categoryName) ?? cost.note]
    .filter(Boolean).join(' ')
  return (
    <div className="flex flex-col gap-0.5">
      <CardHeader title="New vs used vs refurbished" variant="label" className="mb-0.5" />
      <dl className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-baseline gap-x-3 text-meta tabular-nums">
        {cost.options.map(o => (
          <div key={o.kind} className="contents">
            <dt className="text-fg-muted">{KIND_LABEL[o.kind]}</dt>
            <dd className="text-right text-fg-2">{money(o.price, o.currency)}</dd>
            <dd className={cx(o.kind === cost.cheapest && cost.options.length > 1 ? 'font-semibold text-fg' : 'text-fg-muted')}>
              <NetWords o={o} />
            </dd>
          </div>
        ))}
      </dl>
      {footnote && <p className="text-micro text-fg-muted">{footnote}</p>}
    </div>
  )
}

/** "≈ 2 800 net · 117 a month"; a profit in the success tone ("makes ≈ 200"); nothing without a kept %. */
function NetWords({ o }: { o: OwnershipOption }) {
  if (o.net === null) return null
  if (o.net < 0) return <span className="text-success">makes ≈ {num(-o.net)}</span>
  return <>≈ {num(o.net)} net{o.perMonth !== null && o.perMonth > 0 ? ` · ${num(o.perMonth)} a month` : ''}</>
}
