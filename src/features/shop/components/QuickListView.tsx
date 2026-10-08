import { useMemo, useState } from 'react'
import { ListChecks } from 'lucide-react'
import { Card, EmptyState, PageBoard, Skeleton } from '../../../shared/ui'
import { useEntityModal } from '../../../shared/modals'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useBuyNow } from '../hooks/useShop'
import { useGroceryPrices } from '../hooks/useShopPrices'
import { buyAgain, listOf, pickedUpOn, quickGroups, quickOpen, storeNames } from '../shopModel'
import { QUICK_BOARD } from '../shopBoard'
import { QuickAdd } from './quick/QuickAdd'
import { QuickRow, WishlistRow, type RowPrice } from './quick/QuickRows'
import { QuickBasketCard } from './quick/QuickBasketCard'
import { BuyAgainCard, PickedUpToday } from './quick/QuickExtras'
import { FindPriceSheet } from './quick/FindPriceSheet'
import type { ShopItem } from '../types'

/**
 * The quick list: errands and groceries by store, ticked off as you go. The
 * wishlist's errands and due deals join their store's group (ticking one
 * buys it); a row matched to a product shows its cheapest chain, and the
 * basket card compares the chains for the whole list.
 */
export function QuickListView({ items, isLoading }: { items: ShopItem[]; isLoading: boolean }) {
  const modal = useEntityModal()
  const today = todayStr()
  const open = useMemo(() => quickOpen(items), [items])
  const groups = useMemo(() => quickGroups(items, today), [items, today])
  const picked = useMemo(() => pickedUpOn(items, today), [items, today])
  const again = useMemo(() => buyAgain(items), [items])
  const storeList = useMemo(() => storeNames(items), [items])
  const buyNow = useBuyNow(id => modal.open({ kind: 'shop-item', id }))
  const [find, setFind] = useState<{ id: string; open: boolean } | null>(null)
  const findRow = find ? items.find(i => i.id === find.id) ?? null : null

  // One bulk call prices the rows and the basket. Rows picked up today stay in
  // it, so ticking milk off in the shop doesn't ask for a new one.
  const eans = useMemo(() => [...open, ...picked].map(i => i.ean).filter((e): e is string => !!e), [open, picked])
  const pricesQuery = useGroceryPrices(eans)
  const prices = useMemo(() => new Map((pricesQuery.data ?? []).map(p => [p.ean, p])), [pricesQuery.data])
  const rowPrice = (item: ShopItem): RowPrice | null =>
    !item.ean ? null
      : pricesQuery.isError ? { state: 'error' }
      : pricesQuery.isPending ? { state: 'loading' }
      : { state: 'ok', price: prices.get(item.ean) }

  const shown = groups.reduce((n, g) => n + g.items.length, 0)
  const findPrice = (id: string) => setFind({ id, open: true })

  const list = isLoading ? (
    <div className="flex flex-col gap-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}</div>
  ) : shown === 0 && picked.length === 0 ? (
    <EmptyState bordered className="max-w-md" icon={<ListChecks />} title="Nothing to pick up"
      description="Add what you need — milk, batteries, a birthday card — or scan a barcode. Tick it off in the shop." />
  ) : (
    <div className="flex flex-col gap-4">
      {shown === 0 && <p className="text-body text-fg-muted">Everything is picked up.</p>}
      {/* Stores A–Z read down each column (THEME W2), so a long store never leaves a hole beside it. */}
      {shown > 0 && (
        <div className="@container">
          <div className="gap-4 @[40rem]:columns-2 @[72rem]:columns-3">
            {groups.map(store => (
              <Card key={store.key} padded={false} className="mb-4 break-inside-avoid">
                {store.title && (
                  <div className="flex items-baseline gap-2 border-b border-line px-3.5 py-2">
                    <h2 className="text-ui font-semibold text-fg">{store.title}</h2>
                    <span className="count-badge">{store.items.length}</span>
                  </div>
                )}
                <ul className="divide-y divide-line">
                  {store.items.map(item => listOf(item) === 'quick'
                    ? <QuickRow key={item.id} item={item} price={rowPrice(item)} onFindPrice={findPrice} />
                    : <WishlistRow key={item.id} item={item} onBuy={buyNow} />)}
                </ul>
              </Card>
            ))}
          </div>
        </div>
      )}
      {picked.length > 0 && <PickedUpToday items={picked} />}
    </div>
  )

  return (
    <>
      <PageBoard
        layout={QUICK_BOARD}
        stackGap="gap-4"
        sections={{
          add: <QuickAdd stores={storeList} />,
          // Nothing to compare until something is on the list.
          basket: !isLoading && open.length > 0 && (
            <QuickBasketCard rows={open} prices={prices} loading={pricesQuery.isPending} error={pricesQuery.error}
              onRetry={() => void pricesQuery.refetch()} />
          ),
          again: again.length > 0 && <BuyAgainCard rows={again} />,
          list,
        }}
      />
      <FindPriceSheet item={findRow} open={!!find?.open} current={findRow?.ean ? prices.get(findRow.ean) : undefined}
        onClose={() => setFind(f => f && { ...f, open: false })} />
    </>
  )
}
