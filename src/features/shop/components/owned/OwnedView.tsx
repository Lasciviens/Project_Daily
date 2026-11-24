import { useMemo, useState } from 'react'
import { PackagePlus } from 'lucide-react'
import { Button, EmptyState, PageBoard } from '../../../../shared/ui'
import { useEntityModal } from '../../../../shared/modals'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { useRememberedFlag } from '../../../../shared/hooks/useLayoutMemory'
import { useShopItems } from '../../hooks/useShop'
import { useShopLinks, useShopMoney } from '../../hooks/useShopMoney'
import { useWatchMap } from '../../hooks/useShopPrices'
import { useListings } from '../../hooks/useShopResale'
import { openListingsByItem } from '../../sellingModel'
import { useCategoryPictures } from '../../hooks/useCategoryPictures'
import { groupByCategory } from '../../shopModel'
import { FoldAll } from '../CategorySection'
import { useCollapsedGroups } from '../../hooks/useCollapsedGroups'
import {
  accessoriesByItem, NO_OWNED_FILTERS, ownedCards, ownedFilterCount, sortOwned,
  type OwnedFilters, type OwnedSort,
} from '../../ownModel'
import { chainIndex, chainsOf, chainTitle } from '../../chainModel'
import { OWNED_BOARD } from '../../shopBoard'
import { useOwnedLayout } from '../../hooks/useOwnedLayout'
import { OwnedFiltersCard } from './OwnedFilters'
import { GoneFold, OwnedList, OwnedListSkeleton, type RowContext } from './OwnedList'
import type { ShopCategory, ShopItem } from '../../types'

/**
 * Owned → Things: what you have (by category, as compact rows) and what you
 * had, as rows, one line each, or big pictures (the device remembers which).
 * A tapped row opens its record in the popup, at every width (owner, 23.11.2026:
 * one popup everywhere, no side pane).
 */
export function OwnedView({ items, categories, isLoading }: {
  items: ShopItem[]; categories: ShopCategory[]; isLoading: boolean
}) {
  const modal = useEntityModal()
  const itemsQ = useShopItems()
  const today = todayStr()
  const { ctx } = useShopMoney()
  const { data: links = [] } = useShopLinks()
  const watches = useWatchMap()
  const { data: listingRows } = useListings()
  const listings = useMemo(() => openListingsByItem(listingRows ?? []), [listingRows])
  const pictures = useCategoryPictures()
  const [filters, setFilters] = useState<OwnedFilters>(NO_OWNED_FILTERS)
  const [sort, setSort] = useState<OwnedSort>('recent')
  const [layout, setLayout] = useOwnedLayout()

  const acc = useMemo(() => accessoriesByItem(items), [items])
  const allChains = useMemo(() => chainsOf(items, links, ctx), [items, links, ctx])
  const chains = useMemo(() => chainIndex(allChains), [allChains])
  // Chains joining at least two things you have or had (a link to a wish alone is a plan).
  const chainOptions = useMemo(() => allChains.filter(c => c.nodes.filter(n => n.state !== 'wish').length > 1).map(c => ({ id: c.id, title: chainTitle(c) })), [allChains])
  const inChain = useMemo(() => {
    const c = allChains.find(x => x.id === filters.chain)
    return c ? new Set(c.nodes.flatMap(n => [n.id, ...n.accessories.map(a => a.id)])) : undefined
  }, [allChains, filters.chain])
  const shown = useMemo(() => sortOwned(ownedCards(items, categories, filters, inChain), sort, ctx, today, acc), [items, categories, filters, inChain, sort, ctx, today, acc])
  const groups = useMemo(() => groupByCategory(shown, categories), [shown, categories])
  const gone = useMemo(
    () => (filters.show === 'mine' ? sortOwned(ownedCards(items, categories, { ...filters, show: 'gone' }, inChain), 'recent', ctx, today, acc) : []),
    [items, categories, filters, inChain, ctx, today, acc],
  )
  const filtered = ownedFilterCount(filters) > 0
  const fold = useCollapsedGroups('owned')
  const anything = useMemo(() => ownedCards(items, categories, { ...NO_OWNED_FILTERS, show: 'all' }).length > 0, [items, categories])

  // While the list loads, the filter bar keeps its room where it showed last time (a first visit keeps it: an
  // empty account has no bar, and the bar arriving after the read pushed the whole list down — 0.16 on a phone).
  const showFilters = useRememberedFlag('shop:ownedFilters', anything, !isLoading && !itemsQ.isError, true)
  // Fold all stays in the filter row while it loads only where there were two categories or more last time.
  const foldable = useRememberedFlag('shop:ownedFoldAll', groups.length >= 2, !isLoading && !itemsQ.isError, true)
  // The rows wait for the default pictures with their reads, so a picture never changes under a drawn row.
  const listLoading = isLoading || !pictures.ready

  const openThing = (id: string) => modal.open({ kind: 'shop-item', id })

  const rows: RowContext = {
    acc, ctx, today, categories, watches, listings,
    chainOf: id => {
      const c = chains.get(id)
      const linked = c ? c.nodes.filter(n => n.state !== 'wish').length : 0
      return c && linked > 1 ? c.name ?? `chain of ${linked}` : null
    },
    pictureFor: pictures.pictureFor,
  }

  const list = listLoading ? (
    <OwnedListSkeleton key="loading" layout={layout} />
  ) : !anything ? (
    <EmptyState key="empty" bordered className="max-w-md" icon={<PackagePlus />} title="Start with what you use every day"
      description="Your phone, your console, the TV — with what they cost and when. Mark a wish bought and it lands here too."
      action={<Button icon={<PackagePlus />} onClick={() => modal.open({ kind: 'shop-own' })} tip="Add something I own">Add</Button>} />
  ) : (
    <div key="list" className="flex flex-col gap-4">
      {shown.length === 0 && (filtered
        ? (
          <p className="text-body text-fg-muted">
            Nothing matches these filters.{' '}
            <button type="button" onClick={() => setFilters({ ...NO_OWNED_FILTERS, show: filters.show })} className="inline-flex min-h-[44px] items-center font-semibold text-accent-600 hover:underline">Clear filters</button>
          </p>
        )
        : <p className="text-body text-fg-muted">{filters.show === 'gone' ? 'Nothing sold or gone yet.' : 'Nothing is yours right now.'}</p>)}
      <OwnedList groups={groups} rows={rows} collapsed={fold.collapsed} onToggle={fold.toggle} onOpen={openThing} layout={layout} />
      <GoneFold gone={gone} rows={rows} onOpen={openThing} layout={layout} />
    </div>
  )

  return (
    <PageBoard
      layout={OWNED_BOARD}
      stackGap="gap-4"
      sections={{
        filters: showFilters && (
          <OwnedFiltersCard filters={filters} onChange={setFilters} sort={sort} onSort={setSort} categories={categories} chains={chainOptions}
            layout={layout} onLayout={setLayout}
            fold={<FoldAll keys={groups.map(g => g.key)} collapsed={fold.collapsed} onSet={fold.setAll} pending={isLoading && foldable} />} />
        ),
        groups: list,
      }}
    />
  )
}
