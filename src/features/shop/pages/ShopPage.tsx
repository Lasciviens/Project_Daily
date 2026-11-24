import { Suspense, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { FileText, ListChecks, MoreHorizontal, Plus, Receipt, Sparkles, Tag, Waypoints } from 'lucide-react'
import { Button, PageContainer, PageHeader, SegmentedControl, SkeletonTab } from '../../../shared/ui'
import { useEntityModal } from '../../../shared/modals'
import { useBreakpoint } from '../../../shared/hooks/useBreakpoint'
import { useIdlePreload } from '../../../shared/hooks/useIdlePreload'
import { lazyPart } from '../../../shared/utils/lazyPage'
import { useShopCategories, useShopItems } from '../hooks/useShop'
import { useAutoFillRates, useShopCosts } from '../hooks/useShopMoney'
import { listOf, quickGroups } from '../shopModel'
import { todayStr } from '../../../shared/utils/dateUtils'
import { WishlistView } from '../components/WishlistView'
import { ShopNeedsALook } from '../components/ShopNeedsALook'
import type { RecordFact } from '../shopSuggestions'
import { ShopHeroArt } from '../components/ShopHeroArt'
import { useAddSuggestedCategories } from '../hooks/useAddSuggestedCategories'
import type { StatsScope } from '../statsModel'

// The Quick list (its grocery prices, Buy again and the scanner), Owned's Things
// (its rows) and Stats (the only charts on the page)
// load when opened, and in idle time once the page shows: the Wishlist, the
// default view, keeps the page's first download and carries only its own code.
const QuickListView = lazyPart('shop-quick', () => import('../components/QuickListView').then(m => m.QuickListView))
const OwnedView = lazyPart('shop-owned', () => import('../components/owned/OwnedView').then(m => m.OwnedView))
const ShopStatsView = lazyPart('shop-stats', () => import('../components/stats/ShopStatsView').then(m => m.ShopStatsView))
const OTHER_VIEWS = [QuickListView, OwnedView, ShopStatsView]

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
  // Stats' filter and period live here, so they stay while the owner switches between Things and Stats.
  const [statsScope, setStatsScope] = useState<StatsScope>(WHOLE_COLLECTION)
  const [statsYear, setStatsYear] = useState<string | null | undefined>(undefined)
  useIdlePreload(OTHER_VIEWS)
  const modal = useEntityModal()
  const { data: items = [], isLoading: itemsLoading } = useShopItems()
  const { data: categories = [], isLoading: catsLoading, isError: catsError } = useShopCategories()
  const { data: costs = [] } = useShopCosts()
  useAutoFillRates(items, costs)
  const isLoading = itemsLoading || catsLoading

  // A thing opened from Needs a look (the header's sheet) opens its popup, at the fact that needs fixing when it has one.
  const openThing = (id: string, fact?: RecordFact) => modal.open(fact ? { kind: 'shop-item', id, fact } : { kind: 'shop-item', id })

  const wishCount = items.filter(i => listOf(i) === 'wishlist' && i.status === 'wishlist' && !i.option_for).length
  const quickCount = quickGroups(items, todayStr()).reduce((n, g) => n + g.items.length, 0)
  // Counts only where there is room for them (a phone's three segments are tight).
  const count = (n: number) => !isPhone && n > 0 && <span className="ml-1 tabular-nums text-fg-muted">{n}</span>

  function add() {
    if (view === 'owned') modal.open({ kind: 'shop-own' })
    else modal.open({ kind: 'shop-item', defaults: { list: view === 'quick' ? 'quick' : 'wishlist' } })
  }
  // Short buttons (owner, 24.11.2026): "+" with its words in the tooltip, the accessible name and a long press on touch.
  // Owned's + adds what you own or had: "I have it | I had it" is the popup's first switch (critic, 24.11.2026: one way in, not two icons).
  const addWords = view === 'owned' ? 'Add something I own or had (the switch is inside)' : view === 'quick' ? 'Add to the quick list' : 'Add to the wishlist'
  // Owned's other way in: a new money chain — its icon and one word, in the bar from a tablet, beside Things | Stats on a phone.
  const ownedWays = (
    <Button size="sm" variant="secondary" icon={<Waypoints />} onClick={() => modal.open({ kind: 'shop-chain-builder' })} tip="Chain — a new money chain" className="shrink-0">Chain</Button>
  )

  const ownedTabs = (fullWidth: boolean) => (
    <SegmentedControl<OwnedTab> size="sm" fullWidth={fullWidth} value={ownedTab} onChange={t => set('owned', t)}
      options={[{ value: 'things', label: 'Things' }, { value: 'stats', label: 'Stats' }]} />
  )
  // "Add the suggested categories (34)" while the pickers have any: one tap, then "34 categories added · Undo".
  const suggested = useAddSuggestedCategories(categories)
  const suggestKnown = !catsLoading && !catsError && suggested.count != null
  // The header's one ⋯ on every view (the bar keeps its shape): Stores and rules, the suggested categories while
  // there are any, the money chains, and on Owned the insurance list.
  const moreMenu = (
    <Menu as="div">
      <MenuButton className="icon-btn-bordered h-9 w-9 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" aria-label="More in Shop" title="More in Shop">
        <MoreHorizontal aria-hidden className="h-[18px] w-[18px]" />
      </MenuButton>
      <MenuItems anchor="bottom end" transition className="menu w-72 [--anchor-gap:4px] transition duration-150 data-[closed]:scale-95 data-[closed]:opacity-0">
        <MenuItem><button type="button" onClick={() => modal.open({ kind: 'shop-receipt' })} title="Read a receipt" className="menu-item"><Receipt aria-hidden className="h-4 w-4" /> Receipts</button></MenuItem>
        <MenuItem><button type="button" onClick={() => modal.open({ kind: 'shop-tidy' })} title="Tidy up product info (AI)" className="menu-item"><Sparkles aria-hidden className="h-4 w-4" /> Tidy up</button></MenuItem>
        <MenuItem><button type="button" onClick={() => modal.open({ kind: 'shop-stores' })} title="Stores and rules" className="menu-item"><ListChecks aria-hidden className="h-4 w-4" /> Stores</button></MenuItem>
        {suggestKnown && (suggested.count ?? 0) > 0 && (
          <MenuItem disabled={suggested.busy}>
            <button type="button" onClick={() => { void suggested.add() }} title="Add the suggested categories" className="menu-item data-[disabled]:opacity-50">
              <Tag aria-hidden className="h-4 w-4" /> Add categories · {suggested.count}
            </button>
          </MenuItem>
        )}
        <MenuItem><button type="button" onClick={() => modal.open({ kind: 'shop-chains' })} className="menu-item"><Waypoints aria-hidden className="h-4 w-4" /> Money chains</button></MenuItem>
        {view === 'owned' && (
          <MenuItem><button type="button" onClick={() => modal.open({ kind: 'shop-insurance' })} className="menu-item"><FileText aria-hidden className="h-4 w-4" /> Insurance list</button></MenuItem>
        )}
      </MenuItems>
    </Menu>
  )

  // The bar keeps one row and the view switch one width on every view (owner,
  // 03.11.2026: a tab switch never reshapes the bar). On a phone Owned's own
  // controls — Things | Stats — sit in the row
  // right under it instead of growing it by a row and narrowing the switch;
  // from a tablet they share the bar's row, where they fit without moving it.
  // The ⋯ is on every view alike, so a switch never moves it.
  return (
    <PageContainer>
      <PageHeader title="Shop" art={<ShopHeroArt />}>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <div className="min-w-0 flex-1 sm:flex-none">
            <SegmentedControl<View>
              size={isPhone ? 'sm' : 'md'}
              value={view}
              onChange={v => set(v)}
              fullWidth={isPhone}
              fit={isPhone}
              options={[
                { value: 'wishlist', label: <>Wishlist{count(wishCount)}</> },
                { value: 'quick', label: <>Quick list{count(quickCount)}</> },
                { value: 'owned', label: 'Owned' },
              ]}
            />
          </div>
          {view === 'owned' && !isPhone && ownedTabs(false)}
          <div className="flex shrink-0 items-center gap-1.5 sm:ml-auto sm:gap-2">
            {view === 'owned' && !isPhone && ownedWays}
            <ShopNeedsALook items={items} isLoading={isLoading} openThing={openThing} />
            {moreMenu}
            <Button size="sm" variant="primary" icon={<Plus />} tip={addWords} onClick={add} />
          </div>
        </div>
      </PageHeader>
      {view === 'owned' && isPhone && (
        <div className="mb-3 flex items-center gap-2 sm:mb-4">
          <div className="min-w-0 flex-1">{ownedTabs(true)}</div>
          {ownedWays}
        </div>
      )}

      {view === 'quick'
        ? (
          <Suspense fallback={<SkeletonTab />}>
            <QuickListView items={items} isLoading={isLoading} />
          </Suspense>
        )
        : view === 'owned'
          ? ownedTab === 'stats'
            ? (
              <Suspense fallback={<div aria-busy="true" />}>
                <ShopStatsView items={items} categories={categories} isLoading={isLoading}
                  scope={statsScope} onScope={setStatsScope} year={statsYear} onYear={setStatsYear} />
              </Suspense>
            )
            : (
              <Suspense fallback={<SkeletonTab />}>
                <OwnedView items={items} categories={categories} isLoading={isLoading} />
              </Suspense>
            )
          : <WishlistView items={items} categories={categories} isLoading={isLoading} />}
    </PageContainer>
  )
}
