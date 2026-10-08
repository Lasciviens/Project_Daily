import { useMemo } from 'react'
import { PackageCheck, Undo2 } from 'lucide-react'
import { Button, EmptyState, PageBoard, Skeleton, Truncate } from '../../../shared/ui'
import { useEntityModal } from '../../../shared/modals'
import { formatDate } from '../../../shared/utils/dateFormat'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useUpdateShopItem } from '../hooks/useShop'
import { useShopRates } from '../hooks/useShopRates'
import { approxOther, boughtDay, boughtList, currencyOf, priceLabel, spentSummary, totalsLabel, type Totals } from '../shopModel'
import { BOUGHT_BOARD } from '../shopBoard'
import { ShopTotalsCard } from './ShopTotalsCard'
import type { ShopItem } from '../types'

const ROWS = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-2'

/** What came off the wishlist: when, for how much, and what it added up to. */
export function BoughtView({ items, isLoading }: { items: ShopItem[]; isLoading: boolean }) {
  const today = todayStr()
  const bought = useMemo(() => boughtList(items), [items])
  const { rates, date, failed } = useShopRates(bought.some(i => i.price != null))
  const spent = spentSummary(bought, today, 'NOK', rates)

  const list = isLoading ? (
    <div className={ROWS}>{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} rounded="rounded-card" className="h-16" />)}</div>
  ) : bought.length === 0 ? (
    <EmptyState bordered className="max-w-md" icon={<PackageCheck />} title="Nothing bought yet"
      description="When you mark a wishlist item bought it lands here, with the day you bought it." />
  ) : (
    <div className={ROWS}>{bought.map(item => <BoughtRow key={item.id} item={item} rates={rates} />)}</div>
  )

  return (
    <PageBoard
      layout={BOUGHT_BOARD}
      stackGap="gap-4"
      sections={{
        // Always shown, even at 0: the board keeps this rail's track, and an
        // empty one would leave a blank column left of the list (THEME W7).
        spent: (
          <ShopTotalsCard label="Spent this year" totals={spent.year} rates={rates} ratesDate={date} failed={failed}>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-line pt-2 text-meta">
              <SpentLine label="This month" totals={spent.month} />
              <SpentLine label="All time" totals={spent.all} />
            </dl>
          </ShopTotalsCard>
        ),
        bought: list,
      }}
    />
  )
}

function SpentLine({ label, totals }: { label: string; totals: Totals }) {
  return (
    <div>
      <dt className="text-fg-muted">{label}</dt>
      <dd className="font-semibold tabular-nums text-fg">{totalsLabel(totals)}</dd>
    </div>
  )
}

function BoughtRow({ item, rates }: { item: ShopItem; rates: Parameters<typeof approxOther>[2] }) {
  const modal = useEntityModal()
  const update = useUpdateShopItem()
  const day = boughtDay(item)
  const price = priceLabel(item)
  const approx = item.price != null ? approxOther(item.price, currencyOf(item), rates) : null
  return (
    <div className="card flex items-center gap-2 py-1.5 pl-3.5 pr-1.5">
      <button type="button" onClick={() => modal.open({ kind: 'shop-item', id: item.id })} className="min-h-[44px] min-w-0 flex-1 text-left">
        <Truncate as="span" className="block text-body font-medium text-fg">{item.title}</Truncate>
        <span className="block text-meta tabular-nums text-fg-muted">
          {day ? `Bought ${formatDate(day)}` : 'Bought'}
          {price && <> · {price}</>}
          {approx && <span className="text-fg-faint"> ({approx})</span>}
        </span>
      </button>
      <Button size="sm" variant="ghost" icon={<Undo2 />} onClick={() => update.mutate({ id: item.id, patch: { status: 'wishlist' } })}
        title="Not bought after all — back on the wishlist">
        Put back
      </Button>
    </div>
  )
}
