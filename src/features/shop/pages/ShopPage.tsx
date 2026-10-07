import { useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Button, PageContainer, PageHeader, SegmentedControl } from '../../../shared/ui'
import { useEntityModal } from '../../../shared/modals'
import { useBreakpoint } from '../../../shared/hooks/useBreakpoint'
import { useShopCategories, useShopItems } from '../hooks/useShop'
import { listOf, quickOpen } from '../shopModel'
import { WishlistView } from '../components/WishlistView'
import { QuickListView } from '../components/QuickListView'
import { BoughtView } from '../components/BoughtView'

type View = 'wishlist' | 'quick' | 'bought'
const VIEWS: View[] = ['wishlist', 'quick', 'bought']

/**
 * Shop — two lists over the same items (migration 134) plus what was bought:
 * the Wishlist (someday purchases by category, with prices and totals), the
 * Quick list (errands and groceries by store) and Bought. `?view=` keeps the
 * view so Back and a shared link land on it.
 */
export function ShopPage() {
  const [params, setParams] = useSearchParams()
  const view: View = VIEWS.includes(params.get('view') as View) ? params.get('view') as View : 'wishlist'
  const setView = (v: View) => setParams(p => { const n = new URLSearchParams(p); if (v === 'wishlist') n.delete('view'); else n.set('view', v); return n })
  const isPhone = useBreakpoint() === 'phone'
  const modal = useEntityModal()
  const { data: items = [], isLoading: itemsLoading } = useShopItems()
  const { data: categories = [], isLoading: catsLoading } = useShopCategories()
  const isLoading = itemsLoading || catsLoading

  const wishCount = items.filter(i => listOf(i) === 'wishlist' && i.status === 'wishlist').length
  const quickCount = quickOpen(items).length
  const count = (n: number) => n > 0 && <span className="ml-1 tabular-nums text-fg-faint">{n}</span>

  return (
    <PageContainer>
      <PageHeader title="Shop">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 sm:flex-none">
            <SegmentedControl<View>
              value={view}
              onChange={setView}
              fullWidth={isPhone}
              options={[
                { value: 'wishlist', label: <>Wishlist{count(wishCount)}</> },
                { value: 'quick', label: <>Quick list{count(quickCount)}</> },
                { value: 'bought', label: 'Bought' },
              ]}
            />
          </div>
          <Button variant="primary" icon={<Plus />} aria-label="Add item" className="shrink-0 sm:ml-auto"
            onClick={() => modal.open({ kind: 'shop-item', defaults: { list: view === 'quick' ? 'quick' : 'wishlist' } })}>
            <span className="max-sm:hidden">Add item</span>
          </Button>
        </div>
      </PageHeader>

      {view === 'quick'
        ? <QuickListView items={items} isLoading={isLoading} />
        : view === 'bought'
          ? <BoughtView items={items} isLoading={isLoading} />
          : <WishlistView items={items} categories={categories} isLoading={isLoading} />}
    </PageContainer>
  )
}
