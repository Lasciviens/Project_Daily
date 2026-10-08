import { useMemo, useState } from 'react'
import { Store } from 'lucide-react'
import { Button, Card, CardHeader, Skeleton, TonePill, Truncate, cx } from '../../../../shared/ui'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { formatMoney } from '../../../settings/subscriptionRules'
import { basketByChain, basketLines, type BasketLine, type GroceryPrice } from '../../groceryModel'
import type { ShopItem } from '../../types'

/** Chains shown before "Show all": the full baskets lead, so these are the ones that matter. */
const SHOWN = 4

interface Props {
  /** The quick list's open rows (the ones with a product get priced). */
  rows: readonly ShopItem[]
  prices: ReadonlyMap<string, GroceryPrice>
  loading: boolean
  error: Error | null
  onRetry: () => void
}

/** "Has all 3 · 4.20 NOK more" / "Has 2 of 3". Grocery money keeps its øre. */
function coverage(l: BasketLine, priced: number): string {
  if (!l.full) return `Has ${l.covered} of ${priced}`
  const has = priced === 1 ? 'Has it' : priced === 2 ? 'Has both' : `Has all ${priced}`
  return l.more === 0 ? `${has} · same total` : l.more != null ? `${has} · ${formatMoney(l.more, 'NOK')} more` : has
}

/**
 * What the matched quick-list rows cost at each chain Kassalapp follows —
 * full baskets first (only they compare), the rest with what they lack.
 * REMA 1000 publishes no prices, so it never appears.
 */
export function QuickBasketCard({ rows, prices, loading, error, onRetry }: Props) {
  const [all, setAll] = useState(false)
  const basket = useMemo(() => basketByChain(rows, prices), [rows, prices])
  const lines = useMemo(() => basketLines(basket), [basket])
  const matched = rows.filter(r => r.ean).length
  const total = rows.length
  const subtitle = matched === 0 || loading || error ? undefined
    : basket.priced === total ? (total === 1 ? '1 item priced' : `All ${total} items priced`)
    : `${basket.priced} of ${total} items priced`

  const body = matched === 0 ? (
    <p className="text-body text-fg-muted">Find a price on an item to compare chains — it’s in the item’s ⋯ menu.</p>
  ) : error ? (
    <div className="flex flex-col items-start gap-2">
      <p className="text-body text-danger">Couldn’t load the prices: {error.message}</p>
      <Button size="sm" onClick={onRetry}>Try again</Button>
    </div>
  ) : loading ? (
    <div className="flex flex-col gap-3" aria-busy>
      {Array.from({ length: Math.min(3, matched + 1) }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
    </div>
  ) : lines.length === 0 ? (
    <p className="text-body text-fg-muted">No chain has a price for {matched === 1 ? 'this product' : 'these products'} right now.</p>
  ) : (
    <>
      <ul className="flex flex-col divide-y divide-line">
        {(all ? lines : lines.slice(0, SHOWN)).map(l => (
          <li key={l.chain} className="flex items-start gap-3 py-2 first:pt-0">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <Truncate as="span" className={cx('text-body font-semibold', l.full ? 'text-fg' : 'text-fg-2')}>{l.chain}</Truncate>
                {l.cheapest && <TonePill tone="success" className="shrink-0">Cheapest</TonePill>}
              </div>
              <p className="text-meta text-fg-muted tabular-nums">{coverage(l, basket.priced)}</p>
              {!l.full && l.missing.length > 0 && <Truncate as="p" className="text-meta text-fg-muted">{`Missing: ${l.missing.join(', ')}`}</Truncate>}
            </div>
            <span className={cx('shrink-0 text-body tabular-nums', l.full ? 'font-semibold text-fg' : 'text-fg-muted')}>{formatMoney(l.total, 'NOK')}</span>
          </li>
        ))}
      </ul>
      {lines.length > SHOWN && (
        <button type="button" onClick={() => setAll(a => !a)} aria-expanded={all}
          className="mt-1 inline-flex min-h-[36px] items-center text-meta font-semibold text-accent-600 hover:underline [@media(pointer:coarse)]:min-h-[44px]">
          {all ? 'Show fewer chains' : `Show all ${lines.length} chains`}
        </button>
      )}
    </>
  )

  return (
    <Card>
      <CardHeader icon={<Store />} title="Prices by chain" subtitle={subtitle} />
      {body}
      <div className="mt-3 border-t border-line pt-3 text-meta text-fg-muted">
        {basket.oldest && !loading && !error && <p className="tabular-nums">Prices from {formatDate(basket.oldest)} · Kassalapp</p>}
        <p>REMA 1000 publishes no prices, so it can’t be compared.</p>
      </div>
    </Card>
  )
}
