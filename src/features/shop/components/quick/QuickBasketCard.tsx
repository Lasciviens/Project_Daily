import { useMemo, useState } from 'react'
import { Store } from 'lucide-react'
import { Button, Card, CardHeader, Skeleton, TonePill, Truncate, cx } from '../../../../shared/ui'
import { Peek } from '../shopKit'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { formatMoney } from '../../../settings/subscriptionRules'
import { basketByChain, basketLines, leftOutNote, wholeList, wholeListWords, type BasketLine, type GroceryPrice } from '../../groceryModel'
import type { ShopItem } from '../../types'

/** Chains shown before "Show all": the full baskets lead, so these are the ones that matter. */
const SHOWN = 4

interface Props {
  /** The quick list's open rows (the ones with a product get priced). */
  rows: readonly ShopItem[]
  prices: ReadonlyMap<string, GroceryPrice>
  /** Oslo's today (`priceToday`): a price not checked in the 14 days up to it is left out. */
  today: string
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
 * What the matched quick-list rows cost at each chain with a current
 * Kassalapp price — where the whole list is cheapest in the subtitle, after
 * how many items are priced, then full baskets (only they compare), the rest
 * with what they lack. Old prices
 * (REMA 1000, Kiwi and Coop still come back with theirs, often from 2024) are
 * left out after 14 days, and the footer says so and why, with the chains on
 * a tap — a footer only when it has a line.
 */
export function QuickBasketCard({ rows, prices, today, loading, error, onRetry }: Props) {
  const [all, setAll] = useState(false)
  const basket = useMemo(() => basketByChain(rows, prices, today), [rows, prices, today])
  const lines = useMemo(() => basketLines(basket), [basket])
  const answer = useMemo(() => wholeList(basket, rows.length), [basket, rows.length])
  // The footer's lines: how fresh the prices are, and how many old ones were left out (which chains: on a tap).
  const from = basket.oldest && !loading && !error ? basket.oldest : null
  const leftOut = !loading && !error ? leftOutNote(basket) : null
  const matched = rows.filter(r => r.ean).length
  const total = rows.length
  const priced = basket.priced === total ? (total === 1 ? '1 item priced' : `All ${total} items priced`) : `${basket.priced} of ${total} items priced`
  const subtitle = matched === 0 || loading || error ? undefined : answer ? `${priced} · ${wholeListWords(answer)}` : priced

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
      {/* wrap: the answer names chains, and a cut name was the old line's fault at 402. */}
      <CardHeader icon={<Store />} title="Prices by chain" subtitle={subtitle} wrap />
      {body}
      {(from || leftOut) && (
        <div className="mt-3 border-t border-line pt-3 text-meta text-fg-muted">
          {from && <p className="tabular-nums">Prices from {formatDate(from)} · Kassalapp</p>}
          {leftOut && <p className="tabular-nums"><Peek detail={basket.leftOut.chains.join(', ')}>{leftOut}</Peek></p>}
        </div>
      )}
    </Card>
  )
}
