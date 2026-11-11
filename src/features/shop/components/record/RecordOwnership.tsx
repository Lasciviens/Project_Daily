import { CardHeader, cx } from '../../../../shared/ui'
import { keptWords, type OwnershipOption } from '../../ownershipCost'
import { num, money } from '../shopFormat'
import { KIND_LABEL, type Ownership } from './useOwnership'
import type { ShopCategory, ShopItem } from '../../types'

/**
 * New vs used vs refurbished in a wish's record (step C): what owning each would cost you, net — its price less
 * what you would get back at your own kept % — and per month over the months yours were usually kept. Shown only
 * when it has something to say (`useOwnership`).
 */
export function RecordOwnership({ item, categories, ownership }: { item: ShopItem; categories: readonly ShopCategory[]; ownership: Ownership }) {
  const { cost, newFrom } = ownership
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
