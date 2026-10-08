import { useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Button, PageContainer, PageHeader, SegmentedControl } from '../../../shared/ui'
import { useEntityModal } from '../../../shared/modals'
import { useBreakpoint } from '../../../shared/hooks/useBreakpoint'
import { useShopCategories, useShopItems } from '../hooks/useShop'
import { useAutoFillRates, useShopCosts } from '../hooks/useShopMoney'
import { listOf, quickGroups } from '../shopModel'
import { todayStr } from '../../../shared/utils/dateUtils'
import { WishlistView } from '../components/WishlistView'
import { QuickListView } from '../components/QuickListView'
import { OwnedView } from '../components/owned/OwnedView'
import { ShopStatsView } from '../components/stats/ShopStatsView'
import { ShopHeroArt } from '../components/ShopHeroArt'

type View = 'wishlist' | 'quick' | 'owned'
type OwnedTab = 'things' | 'stats'
const VIEWS: View[] = ['wishlist', 'quick', 'owned']

/**
 * Shop — the Wishlist (someday purchases, general wishes with their models,
 * deals and the price watch), the Quick list (errands by store, with grocery
 * prices) and Owned (what you have and had: money chains, accessories,
 * selling, and Stats). `?view=` and `?tab=` keep the place so Back and a
 * shared link land on it; the old `?view=bought` opens Owned.
 */
export function ShopPage() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('view')
  const view: View = raw === 'bought' ? 'owned' : VIEWS.includes(raw as View) ? raw as View : 'wishlist'
  const ownedTab: OwnedTab = params.get('tab') === 'stats' ? 'stats' : 'things'
  const set = (v: View, tab?: OwnedTab) => setParams(p => {
    const n = new URLSearchParams(p)
    if (v === 'wishlist') n.delete('view'); else n.set('view', v)
    if (v === 'owned' && tab === 'stats') n.set('tab', 'stats'); else n.delete('tab')
    return n
  })
  const isPhone = useBreakpoint() === 'phone'
  const modal = useEntityModal()
  const { data: items = [], isLoading: itemsLoading } = useShopItems()
  const { data: categories = [], isLoading: catsLoading } = useShopCategories()
  const { data: costs = [] } = useShopCosts()
  useAutoFillRates(items, costs)
  const isLoading = itemsLoading || catsLoading

  const wishCount = items.filter(i => listOf(i) === 'wishlist' && i.status === 'wishlist' && !i.option_for).length
  const quickCount = quickGroups(items, todayStr()).reduce((n, g) => n + g.items.length, 0)
  // Counts only where there is room for them (a phone's three segments are tight).
  const count = (n: number) => !isPhone && n > 0 && <span className="ml-1 tabular-nums text-fg-faint">{n}</span>

  function add() {
    if (view === 'owned') modal.open({ kind: 'shop-own' })
    else modal.open({ kind: 'shop-item', defaults: { list: view === 'quick' ? 'quick' : 'wishlist' } })
  }

  return (
    <PageContainer>
      <PageHeader title="Shop">
        <div className="relative isolate flex flex-col justify-center gap-2 sm:min-h-[7rem] sm:overflow-hidden sm:rounded-card sm:border sm:border-line sm:bg-surface sm:p-3">
          <ShopHeroArt />
          <div className="relative z-10 flex items-center gap-2">
            <div className="min-w-0 flex-1 sm:flex-none">
              <SegmentedControl<View>
                value={view}
                onChange={v => set(v)}
                fullWidth={isPhone}
                options={[
                  { value: 'wishlist', label: <>Wishlist{count(wishCount)}</> },
                  { value: 'quick', label: <>Quick list{count(quickCount)}</> },
                  { value: 'owned', label: 'Owned' },
                ]}
              />
            </div>
            {view === 'owned' && !isPhone && (
              <SegmentedControl<OwnedTab> size="sm" value={ownedTab} onChange={t => set('owned', t)}
                options={[{ value: 'things', label: 'Things' }, { value: 'stats', label: 'Stats' }]} />
            )}
            <Button variant="primary" icon={<Plus />} aria-label={view === 'owned' ? 'Add something you own' : 'Add item'} className="shrink-0 sm:ml-auto" onClick={add}>
              <span className="max-sm:hidden">{view === 'owned' ? 'Add something I own' : 'Add item'}</span>
            </Button>
          </div>
          {view === 'owned' && isPhone && (
            <div className="relative z-10">
              <SegmentedControl<OwnedTab> size="sm" fullWidth value={ownedTab} onChange={t => set('owned', t)}
                options={[{ value: 'things', label: 'Things' }, { value: 'stats', label: 'Stats' }]} />
            </div>
          )}
        </div>
      </PageHeader>

      {view === 'quick'
        ? <QuickListView items={items} isLoading={isLoading} />
        : view === 'owned'
          ? ownedTab === 'stats'
            ? <ShopStatsView items={items} categories={categories} isLoading={isLoading} />
            : <OwnedView items={items} categories={categories} isLoading={isLoading} />
          : <WishlistView items={items} categories={categories} isLoading={isLoading} />}
    </PageContainer>
  )
}
