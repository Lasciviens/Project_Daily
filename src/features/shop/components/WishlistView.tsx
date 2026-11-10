import { useMemo, useState } from 'react'
import { ChevronDown, Plus, ShoppingBag, Undo2 } from 'lucide-react'
import { Button, EmptyState, PageBoard, Skeleton, cx } from '../../../shared/ui'
import { useEntityModal } from '../../../shared/modals'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useElementWidthRem } from '../../../shared/hooks/useElementWidth'
import { dealByIndex } from '../../projects/projectBoard'
import { useTasksByIds } from '../../todo/hooks/useTodos'
import { useFoldedFilters } from '../hooks/useFoldedFilters'
import { useBuyNow, useDeleteShopItems, useShopItems, useUpdateShopItem } from '../hooks/useShop'
import { useShopRates } from '../hooks/useShopRates'
import { useShopLinks, useShopMoney } from '../hooks/useShopMoney'
import { useShopWatches } from '../hooks/useShopPrices'
import { usePriceHistories } from '../hooks/usePriceHistories'
import {
  NO_FILTERS, categoryPath, currencyOf, droppedItems, filterWishlist, filtersActive, groupByCategory, listOf, modelsByWish, planDefaults, sortItems, totalsIn, totalsLabel,
  type CategoryGroup, type ShopSort, type WishlistFilters,
} from '../shopModel'
import { cashNeeded, chainsOf } from '../chainModel'
import { needsALook, type Look } from '../shopSuggestions'
import { categoryColumns, priceSpan, type PriceSpan } from '../wishTile'
import type { Amount } from '../ownModel'
import { CategorySection, FoldAll } from './CategorySection'
import { useCollapsedGroups } from '../hooks/useCollapsedGroups'
import { WISHLIST_BOARD } from '../shopBoard'
import { ShopFilters } from './ShopFilters'
import { GeneralWishTile } from './GeneralWishTile'
import { WishTile } from './WishTile'
import { PackedTiles, TILE_GRID, TileSkeleton } from './tileKit'
import { NeedsALook } from './NeedsALook'
import { WishlistSummaryLine } from './WishlistSummaryLine'
import { webUrl } from './shopFormat'
import type { ShopCategory, ShopItem } from '../types'


/**
 * The wishlist: what to buy someday as picture tiles, by category, with a
 * one-line summary above them and "Needs a look" beside them (one line on a
 * phone).
 */
export function WishlistView({ items, categories, isLoading }: { items: ShopItem[]; categories: ShopCategory[]; isLoading: boolean }) {
  const modal = useEntityModal()
  const update = useUpdateShopItem()
  const remove = useDeleteShopItems()
  const today = todayStr()
  const folded = useFoldedFilters()
  const [filters, setFilters] = useState<WishlistFilters>(NO_FILTERS)
  const [sort, setSort] = useState<ShopSort>('priority')
  const [showDropped, setShowDropped] = useState(false)

  const all = useMemo(() => items.filter(i => listOf(i) === 'wishlist' && i.status === 'wishlist' && !i.option_for), [items])
  const { rates, date: ratesDate, failed } = useShopRates(true)
  const watchQ = useShopWatches()
  const watches = useMemo(() => new Map((watchQ.data ?? []).map(w => [w.item_id, w])), [watchQ.data])
  // Each linked wish's price history, for its belt and bar. The tiles wait for
  // these reads, so a bar never appears under a drawn tile (nothing moves).
  const historyIds = useMemo(() => all.filter(i => i.kind !== 'general' && webUrl(i.url)).map(i => i.id).sort(), [all])
  const history = usePriceHistories(historyIds)
  const spans = useMemo(() => {
    const out = new Map<string, PriceSpan>()
    for (const i of all) {
      const span = priceSpan(history.byId.get(i.id) ?? [], watches.get(i.id)?.currency ?? currencyOf(i))
      if (span) out.set(i.id, span)
    }
    return out
  }, [all, watches, history.byId])
  const looks = useMemo(() => needsALook(items, watches, today), [items, watches, today])
  // Needs a look reads the things and their price reads: either failing is a failed answer, never "nothing".
  const itemsQ = useShopItems()
  const lookFailed = (!isLoading && itemsQ.isError) || (!watchQ.isLoading && watchQ.isError)
  const retryLook = () => { void itemsQ.refetch(); void watchQ.refetch() }
  const { ref: listRef, width: listRem } = useElementWidthRem()
  const models = useMemo(() => modelsByWish(items), [items])
  const { ctx } = useShopMoney()
  const { data: links = [] } = useShopLinks()
  const buy = useBuyNow(id => modal.open({ kind: 'shop-item', id }))
  // "After selling X": the plans towards each wish, projected at "Could sell for".
  const afterSale = useMemo(() => {
    const out = new Map<string, { needed: Amount; from: string }>()
    if (!links.length) return out
    for (const c of chainsOf(items, links, ctx, { project: true })) {
      for (const n of c.nodes) {
        if (!n.projected || n.item.status !== 'wishlist') continue
        const need = cashNeeded(c, n.id)
        const from = c.edges.filter(e => e.used && e.to === n.id).map(e => c.nodes.find(x => x.id === e.from)?.item.title).filter(Boolean)
        if (need) out.set(n.id, { needed: need.needed, from: from.join(' and ') })
      }
    }
    return out
  }, [items, links, ctx])
  const shown = useMemo(() => sortItems(filterWishlist(items, categories, filters), sort, rates), [items, categories, filters, sort, rates])
  const groups = useMemo(() => groupByCategory(shown, categories), [shown, categories])
  const dropped = useMemo(() => droppedItems(items), [items])
  const totals = totalsIn(shown, 'NOK', rates, models, watches)
  const fold = useCollapsedGroups('wishlist')

  // From every open row, sorted — a new filter or sort must not refetch the tasks.
  const taskIds = useMemo(() => [...new Set(all.map(i => i.task_id).filter((id): id is string => !!id))].sort(), [all])
  const { data: tasks = [] } = useTasksByIds(taskIds)
  const taskById = new Map(tasks.map(t => [t.id, t]))

  function plan(item: ShopItem) {
    modal.open({
      kind: 'task',
      config: { heading: 'Plan this purchase' },
      defaults: { ...planDefaults(item), domain: 'personal' },
      onSaved: r => { if (r.taskId) update.mutate({ id: item.id, patch: { task_id: r.taskId }, quiet: true }) },
    })
  }

  const topOf = (item: ShopItem) => categoryPath(item.category_id, categories).topId
  const tile = (item: ShopItem) => item.kind === 'general' ? (
    <GeneralWishTile
      key={item.id}
      wish={item}
      models={models.get(item.id) ?? []}
      watches={watches}
      rates={rates}
      topId={topOf(item)}
      today={today}
      onOpen={() => modal.open({ kind: 'shop-item', id: item.id })}
      onAddModel={() => modal.open({ kind: 'shop-model', wishId: item.id })}
    />
  ) : (
    <WishTile
      key={item.id}
      item={item}
      topId={topOf(item)}
      task={item.task_id ? taskById.get(item.task_id) ?? null : null}
      today={today}
      watch={watches.get(item.id) ?? null}
      span={spans.get(item.id) ?? null}
      afterSale={afterSale.get(item.id) ?? null}
      onOpen={() => modal.open({ kind: 'shop-item', id: item.id })}
      onBought={() => buy(item)}
      onPlan={() => plan(item)}
      onOpenTask={() => { if (item.task_id) modal.open({ kind: 'task', id: item.task_id }) }}
      onMoveToQuick={() => update.mutate({ id: item.id, patch: { list: 'quick' } })}
      onDrop={() => update.mutate({ id: item.id, patch: { status: 'dropped' } })}
      onDelete={() => void remove.run(item)}
    />
  )

  // A row of Needs a look: open the thing (an old estimate at that fact), or buy it in one tap.
  const openLook = (look: Look) => modal.open(look.action === 'value' ? { kind: 'shop-item', id: look.itemId, fact: 'value' } : { kind: 'shop-item', id: look.itemId })
  const buyLook = (look: Look) => {
    const item = items.find(i => i.id === look.itemId)
    if (item) buy(item)
  }

  // Wide lists deal the category sections into column stacks by their own width (W2).
  const stacks = dealByIndex(groups, categoryColumns(listRem))
  const section = (group: CategoryGroup) => {
    const t = totalsIn(group.items, 'NOK', rates, models, watches)
    return (
      <CategorySection key={group.key} group={group} collapsed={fold.collapsed.has(group.key)} onToggle={() => fold.toggle(group.key)}
        aside={(t.amount > 0 || t.unconverted.length > 0) ? totalsLabel(t) : undefined} card={tile}
        body={id => <PackedTiles id={id} subs={group.subs} card={tile} />} />
    )
  }

  // The loading copy and the list are keyed apart (THEME §5), each measured for the stacks before it paints.
  const tilesLoading = isLoading || watchQ.isLoading || history.loading
  const groupsSection = tilesLoading ? (
    <div key="loading" ref={listRef} aria-busy="true" className="flex flex-col gap-4">
      <Skeleton className="h-4 w-72 max-w-full" />
      <section className="flex flex-col gap-2">
        <span className="flex min-h-[44px] items-center"><Skeleton className="h-5 w-44" /></span>
        <div className={TILE_GRID}>{Array.from({ length: 6 }).map((_, i) => <TileSkeleton key={i} />)}</div>
      </section>
    </div>
  ) : all.length === 0 && dropped.length === 0 ? (
    <EmptyState bordered className="max-w-md" icon={<ShoppingBag />} title="Nothing on the wishlist yet"
      description="Things you want to buy someday — with a price, where to buy them and when."
      action={<Button icon={<Plus />} onClick={() => modal.open({ kind: 'shop-item', defaults: { list: 'wishlist' } })}>Add item</Button>} />
  ) : (
    <div key="list" ref={listRef} className="flex flex-col gap-4">
      {all.length > 0 && (
        <WishlistSummaryLine totals={totals} shown={shown.length} all={all.length} filtered={filtersActive(filters)}
          rates={rates} ratesDate={ratesDate} failed={failed} />
      )}
      {shown.length === 0 && all.length > 0 && (
        <p className="text-body text-fg-muted">
          Nothing matches these filters.{' '}
          <button type="button" onClick={() => setFilters(NO_FILTERS)} className="inline-flex min-h-[44px] items-center font-semibold text-accent-600 hover:underline">Clear filters</button>
        </p>
      )}
      {stacks.length === 1 ? stacks[0].map(section) : (
        <div className="grid items-start gap-x-6 gap-y-4" style={{ gridTemplateColumns: `repeat(${stacks.length}, minmax(0, 1fr))` }}>
          {stacks.map((stack, i) => <div key={i} className="flex min-w-0 flex-col gap-4">{stack.map(section)}</div>)}
        </div>
      )}
      {dropped.length > 0 && (
        <section>
          <button type="button" aria-expanded={showDropped} onClick={() => setShowDropped(s => !s)}
            className="flex min-h-[44px] items-center gap-1.5 text-body font-semibold text-fg-muted transition-colors hover:text-fg-2">
            <ChevronDown aria-hidden className={cx('h-4 w-4 transition-transform', showDropped && 'rotate-180')} />
            Not any more <span className="count-badge">{dropped.length}</span>
          </button>
          {showDropped && (
            <ul className="mt-1 flex max-w-2xl flex-col divide-y divide-line rounded-card border border-line bg-surface">
              {dropped.map(item => (
                <li key={item.id} className="flex items-center gap-2 py-1 pl-3 pr-1">
                  <button type="button" onClick={() => modal.open({ kind: 'shop-item', id: item.id })} className="min-h-[44px] min-w-0 flex-1 text-left text-body text-fg-2">
                    {item.title}
                    {listOf(item) === 'quick' && <span className="ml-1.5 text-meta text-fg-muted">· quick list</span>}
                  </button>
                  <Button size="sm" variant="ghost" icon={<Undo2 />} onClick={() => update.mutate({ id: item.id, patch: { status: 'wishlist' } })}>Put back</Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )

  return (
    <PageBoard
      layout={WISHLIST_BOARD}
      stackGap="gap-4"
      sections={{
        // While loading too: arriving with the items, the filters pushed the list down (a layout shift).
        filters: (all.length > 0 || isLoading) && (
          <ShopFilters filters={filters} onChange={setFilters} sort={sort} onSort={setSort} categories={categories} collapsible={folded}
            fold={<FoldAll keys={groups.map(g => g.key)} collapsed={fold.collapsed} onSet={fold.setAll} compact={folded} pending={tilesLoading} />} />
        ),
        // In every outcome (loading, nothing, something): one line on a phone, the rail's card on a wide page.
        look: <NeedsALook looks={looks} loading={isLoading || watchQ.isLoading} failed={lookFailed} onRetry={retryLook} onOpen={openLook} onBought={buyLook} />,
        groups: groupsSection,
      }}
    />
  )
}
