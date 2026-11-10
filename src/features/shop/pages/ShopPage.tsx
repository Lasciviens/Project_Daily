import { Suspense, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { History, Link2, ListChecks, MoreHorizontal, Plus } from 'lucide-react'
import { Button, PageContainer, PageHeader, SegmentedControl } from '../../../shared/ui'
import { useEntityModal } from '../../../shared/modals'
import { useBreakpoint } from '../../../shared/hooks/useBreakpoint'
import { useIdlePreload } from '../../../shared/hooks/useIdlePreload'
import { lazyPart } from '../../../shared/utils/lazyPage'
import { useShopCategories, useShopItems } from '../hooks/useShop'
import { useAutoFillRates, useShopCosts } from '../hooks/useShopMoney'
import { listOf, quickGroups } from '../shopModel'
import { todayStr } from '../../../shared/utils/dateUtils'
import { WishlistView } from '../components/WishlistView'
import { QuickListView } from '../components/QuickListView'
import { OwnedView } from '../components/owned/OwnedView'
import { ShopHeroArt } from '../components/ShopHeroArt'
import type { StatsScope } from '../statsModel'

// Stats (the only charts on the page) loads when opened, and in idle time once the page shows.
const ShopStatsView = lazyPart('shop-stats', () => import('../components/stats/ShopStatsView').then(m => m.ShopStatsView))
const OTHER_VIEWS = [ShopStatsView]

type View = 'wishlist' | 'quick' | 'owned'
type OwnedTab = 'things' | 'stats'
const VIEWS: View[] = ['wishlist', 'quick', 'owned']
const WHOLE_COLLECTION: StatsScope = { categories: [], chains: [], things: [], stores: [] }

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
  // Stats' filter and period live here, so Owned's summary line can open Stats on its own things.
  const [statsScope, setStatsScope] = useState<StatsScope>(WHOLE_COLLECTION)
  const [statsYear, setStatsYear] = useState<string | null | undefined>(undefined)
  const openStats = (scope: StatsScope) => { setStatsScope(scope); setStatsYear(null); set('owned', 'stats') }
  useIdlePreload(OTHER_VIEWS)
  const modal = useEntityModal()
  const { data: items = [], isLoading: itemsLoading } = useShopItems()
  const { data: categories = [], isLoading: catsLoading } = useShopCategories()
  const { data: costs = [] } = useShopCosts()
  useAutoFillRates(items, costs)
  const isLoading = itemsLoading || catsLoading

  const wishCount = items.filter(i => listOf(i) === 'wishlist' && i.status === 'wishlist' && !i.option_for).length
  const quickCount = quickGroups(items, todayStr()).reduce((n, g) => n + g.items.length, 0)
  // Counts only where there is room for them (a phone's three segments are tight).
  const count = (n: number) => !isPhone && n > 0 && <span className="ml-1 tabular-nums text-fg-muted">{n}</span>

  function add() {
    if (view === 'owned') modal.open({ kind: 'shop-own' })
    else modal.open({ kind: 'shop-item', defaults: { list: view === 'quick' ? 'quick' : 'wishlist' } })
  }

  const ownedTabs = (fullWidth: boolean) => (
    <SegmentedControl<OwnedTab> size="sm" fullWidth={fullWidth} value={ownedTab} onChange={t => set('owned', t)}
      options={[{ value: 'things', label: 'Things' }, { value: 'stats', label: 'Stats' }]} />
  )
  // The header's one ⋯ on every view (the bar keeps its shape): Stores and rules, and Owned's other ways in
  // where the row has no room for their buttons.
  const moreMenu = (
    <Menu as="div">
      <MenuButton className="icon-btn-bordered" aria-label="More" title="Stores and rules, more ways to add">
        <MoreHorizontal aria-hidden className="h-[18px] w-[18px]" />
      </MenuButton>
      <MenuItems anchor="bottom end" transition className="menu w-56 [--anchor-gap:4px] transition duration-150 data-[closed]:scale-95 data-[closed]:opacity-0">
        <MenuItem><button type="button" onClick={() => modal.open({ kind: 'shop-stores' })} className="menu-item"><ListChecks aria-hidden className="h-4 w-4" /> Stores and rules</button></MenuItem>
        {view === 'owned' && <>
          <MenuItem><button type="button" onClick={() => modal.open({ kind: 'shop-own', had: true })} className="menu-item @[72rem]/page:hidden"><History aria-hidden className="h-4 w-4" /> Something I had</button></MenuItem>
          <MenuItem><button type="button" onClick={() => modal.open({ kind: 'shop-chain-builder' })} className="menu-item @[72rem]/page:hidden"><Link2 aria-hidden className="h-4 w-4" /> New money chain</button></MenuItem>
        </>}
      </MenuItems>
    </Menu>
  )

  // The bar keeps one row and the view switch one width on every view (owner,
  // 03.11.2026: a tab switch never reshapes the bar). On a phone Owned's own
  // controls — Things | Stats and the menu of other ways in — sit in the row
  // right under it instead of growing it by a row and narrowing the switch;
  // from a tablet they share the bar's row, where they fit without moving it.
  return (
    <PageContainer>
      <PageHeader title="Shop" art={<ShopHeroArt />}>
        <div className="flex items-center gap-2">
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
          {view === 'owned' && !isPhone && ownedTabs(false)}
          <div className="flex shrink-0 items-center gap-2 sm:ml-auto">
            {view === 'owned' && !isPhone && <>
              {/* Owned's other ways in: buttons where the row has room, one menu where it has not. */}
              <Button variant="ghost" icon={<History />} className="hidden @[72rem]/page:inline-flex" onClick={() => modal.open({ kind: 'shop-own', had: true })}>Something I had</Button>
              <Button variant="ghost" icon={<Link2 />} className="hidden @[72rem]/page:inline-flex" onClick={() => modal.open({ kind: 'shop-chain-builder' })}>New money chain</Button>
            </>}
            {moreMenu}
            <Button variant="primary" icon={<Plus />} aria-label={view === 'owned' ? 'Add something you own' : 'Add item'} onClick={add}>
              <span className="max-sm:hidden">{view === 'owned' ? 'Add something I own' : 'Add item'}</span>
            </Button>
          </div>
        </div>
      </PageHeader>
      {view === 'owned' && isPhone && (
        <div className="mb-3 flex items-center gap-2 sm:mb-4">
          <div className="min-w-0 flex-1">{ownedTabs(true)}</div>
        </div>
      )}

      {view === 'quick'
        ? <QuickListView items={items} isLoading={isLoading} />
        : view === 'owned'
          ? ownedTab === 'stats'
            ? (
              <Suspense fallback={<div aria-busy="true" />}>
                <ShopStatsView items={items} categories={categories} isLoading={isLoading}
                  scope={statsScope} onScope={setStatsScope} year={statsYear} onYear={setStatsYear} />
              </Suspense>
            )
            : <OwnedView items={items} categories={categories} isLoading={isLoading} onStats={openStats} />
          : <WishlistView items={items} categories={categories} isLoading={isLoading} />}
    </PageContainer>
  )
}
