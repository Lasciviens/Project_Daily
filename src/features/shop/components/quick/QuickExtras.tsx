import { useState } from 'react'
import { Check, ChevronDown, RotateCcw } from 'lucide-react'
import { Card, CardHeader, Truncate, cx } from '../../../../shared/ui'
import { useCreateShopItem, useUpdateShopItem } from '../../hooks/useShop'
import { buyAgainInput, type BuyAgain } from '../../shopModel'
import type { ShopItem } from '../../types'

/**
 * Things bought from this list before — one tap adds a fresh row (the old
 * ones stay as the record of earlier purchases, which is what ×N counts). The
 * new row keeps the product it was matched to, so its price comes back too.
 */
export function BuyAgainCard({ rows }: { rows: readonly BuyAgain[] }) {
  const create = useCreateShopItem()
  return (
    <Card>
      <CardHeader title="Buy again" />
      <div className="flex flex-wrap gap-1.5">
        {rows.map(r => (
          <button key={r.row.id} type="button" onClick={() => create.mutate({ input: buyAgainInput(r), quiet: true })}
            title={`Put ${r.title} back on the quick list`}
            className="chip min-h-[44px] max-w-full gap-1 hover:bg-surface-hover">
            <RotateCcw aria-hidden className="h-3 w-3 shrink-0 text-fg-faint" />
            <Truncate as="span" className="min-w-0">{r.title}</Truncate>
            {r.count > 1 && <span className="shrink-0 text-fg-muted tabular-nums">×{r.count}</span>}
          </button>
        ))}
      </div>
    </Card>
  )
}

/** Ticked off today — kept in sight so a mis-tap is one tap to undo. */
export function PickedUpToday({ items }: { items: readonly ShopItem[] }) {
  const update = useUpdateShopItem()
  const [open, setOpen] = useState(false)
  return (
    <section className="max-w-2xl">
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}
        className="flex min-h-[44px] items-center gap-1.5 text-body font-semibold text-fg-muted transition-colors hover:text-fg-2">
        <ChevronDown aria-hidden className={cx('h-4 w-4 transition-transform', open && 'rotate-180')} />
        Picked up today <span className="count-badge">{items.length}</span>
      </button>
      {open && (
        <ul className="mt-1 divide-y divide-line rounded-card border border-line bg-surface">
          {items.map(item => (
            <li key={item.id} className="flex items-center gap-1 pr-1">
              <button type="button" onClick={() => update.mutate({ id: item.id, patch: { status: 'wishlist' }, quiet: true })}
                aria-label={`Not picked up: ${item.title}`} title="Not picked up after all"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-control text-success">
                <span className="grid h-5 w-5 place-items-center rounded-[6px] bg-success text-surface"><Check aria-hidden className="h-3.5 w-3.5" /></span>
              </button>
              <Truncate as="span" className="min-w-0 flex-1 text-body text-fg-muted line-through">{item.title}</Truncate>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
