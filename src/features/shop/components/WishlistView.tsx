import { useMemo, useState } from 'react'
import { ChevronDown, Plus, ShoppingBag, Undo2 } from 'lucide-react'
import { Button, EmptyState, PageBoard, Skeleton, cx } from '../../../shared/ui'
import { useEntityModal } from '../../../shared/modals'
import { toast } from '../../../app/store'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useBreakpoint } from '../../../shared/hooks/useBreakpoint'
import { useTasksByIds } from '../../todo/hooks/useTodos'
import { useBuyNow, useDeleteShopItems, useUpdateShopItem } from '../hooks/useShop'
import { useShopRates } from '../hooks/useShopRates'
import { useShopLinks, useShopMoney } from '../hooks/useShopMoney'
import { useWatchMap } from '../hooks/useShopPrices'
import {
  NO_FILTERS, droppedItems, filterWishlist, filtersActive, groupByCategory, listOf, modelsByWish, planDefaults, sortItems, totalsIn, totalsLabel,
  type ShopSort, type WishlistFilters,
} from '../shopModel'
import { cashNeeded, chainsOf } from '../chainModel'
import type { Amount } from '../ownModel'
import { GeneralWishCard } from './GeneralWishCard'
import { CARD_GRID, CategorySection, FoldAll } from './CategorySection'
import { useCollapsedGroups } from '../hooks/useCollapsedGroups'
import { WISHLIST_BOARD } from '../shopBoard'
import { ShopFilters } from './ShopFilters'
import { ShopItemCard } from './ShopItemCard'
import { ShopTotalsCard } from './ShopTotalsCard'
import type { ShopCategory, ShopItem } from '../types'


/** The wishlist: what to buy someday, by category, with prices and totals. */
export function WishlistView({ items, categories, isLoading }: { items: ShopItem[]; categories: ShopCategory[]; isLoading: boolean }) {
  const modal = useEntityModal()
  const update = useUpdateShopItem()
  const remove = useDeleteShopItems()
  const today = todayStr()
  const isPhone = useBreakpoint() === 'phone'
  const [filters, setFilters] = useState<WishlistFilters>(NO_FILTERS)
  const [sort, setSort] = useState<ShopSort>('priority')
  const [showDropped, setShowDropped] = useState(false)

  const all = useMemo(() => items.filter(i => listOf(i) === 'wishlist' && i.status === 'wishlist' && !i.option_for), [items])
  const { rates, date: ratesDate, failed } = useShopRates(true)
  const watches = useWatchMap()
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
    // Before migration 134 the row has no task_id column: the task would be
    // made and the link then refused — and a second tap would make another.
    if (!('list' in item)) {
      toast.warning('Plan it needs migration 134 (Shop lists) — apply it first.')
      return
    }
    modal.open({
      kind: 'task',
      config: { heading: 'Plan this purchase' },
      defaults: { ...planDefaults(item), domain: 'personal' },
      onSaved: r => { if (r.taskId) update.mutate({ id: item.id, patch: { task_id: r.taskId }, quiet: true }) },
    })
  }

  const card = (item: ShopItem) => item.kind === 'general' ? (
    <GeneralWishCard
      key={item.id}
      wish={item}
      models={models.get(item.id) ?? []}
      watches={watches}
      rates={rates}
      onOpen={() => modal.open({ kind: 'shop-item', id: item.id })}
      onOpenModel={id => modal.open({ kind: 'shop-item', id })}
      onAddModel={() => modal.open({ kind: 'shop-model', wishId: item.id })}
    />
  ) : (
    <ShopItemCard
      key={item.id}
      item={item}
      task={item.task_id ? taskById.get(item.task_id) ?? null : null}
      rates={rates}
      today={today}
      watch={watches.get(item.id) ?? null}
      afterSale={afterSale.get(item.id) ?? null}
      onEdit={() => modal.open({ kind: 'shop-item', id: item.id })}
      onBought={() => buy(item)}
      onPlan={() => plan(item)}
      onOpenTask={() => { if (item.task_id) modal.open({ kind: 'task', id: item.task_id }) }}
      onMoveToQuick={() => update.mutate({ id: item.id, patch: { list: 'quick' } })}
      onDrop={() => update.mutate({ id: item.id, patch: { status: 'dropped' } })}
      onDelete={() => remove.mutate({ ids: [item.id], label: item.title })}
    />
  )

  const groupsSection = isLoading ? (
    <div className={CARD_GRID}>{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} rounded="rounded-card" className="h-32" />)}</div>
  ) : all.length === 0 && dropped.length === 0 ? (
    <EmptyState bordered className="max-w-md" icon={<ShoppingBag />} title="Nothing on the wishlist yet"
      description="Things you want to buy someday — with a price, where to buy them and when."
      action={<Button icon={<Plus />} onClick={() => modal.open({ kind: 'shop-item', defaults: { list: 'wishlist' } })}>Add item</Button>} />
  ) : (
    <div className="flex flex-col gap-4">
      {shown.length === 0 && all.length > 0 && (
        <p className="text-body text-fg-muted">
          Nothing matches these filters.{' '}
          <button type="button" onClick={() => setFilters(NO_FILTERS)} className="inline-flex min-h-[44px] items-center font-semibold text-accent-600 hover:underline">Clear filters</button>
        </p>
      )}
      <FoldAll keys={groups.map(g => g.key)} collapsed={fold.collapsed} onSet={fold.setAll} />
      {groups.map(group => {
        const t = totalsIn(group.items, 'NOK', rates, models, watches)
        return (
          <CategorySection key={group.key} group={group} collapsed={fold.collapsed.has(group.key)} onToggle={() => fold.toggle(group.key)}
            aside={(t.amount > 0 || t.unconverted.length > 0) ? totalsLabel(t) : undefined} card={card} />
        )
      })}
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
                    {listOf(item) === 'quick' && <span className="ml-1.5 text-meta text-fg-faint">· quick list</span>}
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
        // Always shown, even at 0: the rail keeps its track, and an empty one
        // would leave a blank column left of the list (THEME W7).
        totals: (
          <ShopTotalsCard
            label={filtersActive(filters) ? 'Shown · to buy' : 'Wishlist · to buy'}
            totals={totals}
            rates={rates}
            ratesDate={ratesDate}
            failed={failed}
            note={filtersActive(filters) ? `${shown.length} of ${all.length} items match the filters.` : undefined}
          />
        ),
        filters: all.length > 0 && (
          <ShopFilters filters={filters} onChange={setFilters} sort={sort} onSort={setSort} categories={categories} collapsible={isPhone} />
        ),
        groups: groupsSection,
      }}
    />
  )
}
