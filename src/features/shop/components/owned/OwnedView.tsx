import { useMemo, useState } from 'react'
import { ChevronDown, PackagePlus } from 'lucide-react'
import { Button, EmptyState, PageBoard, Skeleton, Truncate, cx } from '../../../../shared/ui'
import { useEntityModal } from '../../../../shared/modals'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { useBreakpoint } from '../../../../shared/hooks/useBreakpoint'
import { useDeleteShopItems } from '../../hooks/useShop'
import { useShopLinks, useShopMoney, useUndoSale } from '../../hooks/useShopMoney'
import { useWatchMap } from '../../hooks/useShopPrices'
import { groupByCategory } from '../../shopModel'
import { CARD_GRID, CategorySection, FoldAll } from '../CategorySection'
import { useCollapsedGroups } from '../../hooks/useCollapsedGroups'
import {
  accessoriesByItem, comingUp, DISPOSAL_LABEL, isGone, NO_OWNED_FILTERS, ownedCards, ownedSummary, sortOwned,
  type OwnedFilters, type OwnedSort,
} from '../../ownModel'
import { chainIndex, chainsOf, chainTitle } from '../../chainModel'
import { OWNED_BOARD } from '../../shopBoard'
import { OwnedCard } from './OwnedCard'
import { OwnedSummaryCard, ComingUpCard } from './OwnedRail'
import { OwnedFiltersCard } from './OwnedFilters'
import type { ShopCategory, ShopItem } from '../../types'

/** Owned → Things: what you have (by category), what is coming up, and what you had. */
export function OwnedView({ items, categories, isLoading }: { items: ShopItem[]; categories: ShopCategory[]; isLoading: boolean }) {
  const modal = useEntityModal()
  const remove = useDeleteShopItems()
  const undoSale = useUndoSale()
  const today = todayStr()
  const isPhone = useBreakpoint() === 'phone'
  const { ctx } = useShopMoney()
  const { data: links = [] } = useShopLinks()
  const watches = useWatchMap()
  const [filters, setFilters] = useState<OwnedFilters>(NO_OWNED_FILTERS)
  const [sort, setSort] = useState<OwnedSort>('recent')
  const [showGone, setShowGone] = useState(false)

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
  const summary = useMemo(() => ownedSummary(items, ctx), [items, ctx])
  const deadlines = useMemo(() => comingUp(items, today), [items, today])
  const fold = useCollapsedGroups('owned')
  const anything = summary.mine + summary.gone > 0

  const card = (item: ShopItem) => (
    <OwnedCard
      key={item.id}
      item={item}
      accessories={acc.get(item.id) ?? []}
      chain={chains.get(item.id) ?? null}
      watch={watches.get(item.id) ?? null}
      ctx={ctx}
      today={today}
      onOpen={() => modal.open({ kind: 'shop-item', id: item.id })}
      onSell={() => modal.open({ kind: 'shop-sell', id: item.id })}
      onUndoSale={() => undoSale.mutate(item.id)}
      onAccessory={() => modal.open({ kind: 'shop-accessory', itemId: item.id })}
      onChain={() => modal.open({ kind: 'shop-chain', id: item.id })}
      onDelete={() => remove.mutate({ ids: [item.id, ...(acc.get(item.id) ?? []).map(a => a.id)], label: item.title })}
    />
  )

  const list = isLoading ? (
    <div className={CARD_GRID}>{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} rounded="rounded-card" className="h-36" />)}</div>
  ) : !anything ? (
    <EmptyState bordered className="max-w-md" icon={<PackagePlus />} title="Start with what you use every day"
      description="Your phone, your console, the TV — with what they cost and when. Mark a wish bought and it lands here too."
      action={<Button icon={<PackagePlus />} onClick={() => modal.open({ kind: 'shop-own' })}>Add something I own</Button>} />
  ) : (
    <div className="flex flex-col gap-4">
      {shown.length === 0 && (
        <p className="text-body text-fg-muted">
          Nothing matches these filters.{' '}
          <button type="button" onClick={() => setFilters(NO_OWNED_FILTERS)} className="inline-flex min-h-[44px] items-center font-semibold text-accent-600 hover:underline">Clear filters</button>
        </p>
      )}
      <FoldAll keys={groups.map(g => g.key)} collapsed={fold.collapsed} onSet={fold.setAll} />
      {groups.map(group => (
        <CategorySection key={group.key} group={group} collapsed={fold.collapsed.has(group.key)} onToggle={() => fold.toggle(group.key)} card={card} />
      ))}
      {gone.length > 0 && (
        <section>
          <button type="button" aria-expanded={showGone} onClick={() => setShowGone(s => !s)}
            className="flex min-h-[44px] items-center gap-1.5 text-body font-semibold text-fg-muted transition-colors hover:text-fg-2">
            <ChevronDown aria-hidden className={cx('h-4 w-4 transition-transform', showGone && 'rotate-180')} />
            Sold or gone <span className="count-badge">{gone.length}</span>
          </button>
          {showGone && (
            <ul className="mt-1 flex max-w-2xl flex-col divide-y divide-line rounded-card border border-line bg-surface">
              {gone.map(item => (
                <li key={item.id}>
                  <button type="button" onClick={() => modal.open({ kind: 'shop-item', id: item.id })} className="flex min-h-[44px] w-full items-center gap-2 px-3 py-1.5 text-left">
                    <Truncate as="span" className="min-w-0 flex-1 text-body text-fg-2">{item.title}</Truncate>
                    <span className="shrink-0 text-meta tabular-nums text-fg-muted">
                      {isGone(item) ? DISPOSAL_LABEL[item.disposal ?? 'other'] : 'Gone'} {item.disposed_on ? formatDate(item.disposed_on) : ''}
                    </span>
                  </button>
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
      layout={OWNED_BOARD}
      stackGap="gap-4"
      sections={{
        summary: <OwnedSummaryCard summary={summary} onAdd={() => modal.open({ kind: 'shop-own' })} onAddHad={() => modal.open({ kind: 'shop-own', had: true })} />,
        coming: deadlines.length > 0 && <ComingUpCard deadlines={deadlines} onOpen={id => modal.open({ kind: 'shop-item', id })} />,
        filters: anything && (
          <OwnedFiltersCard filters={filters} onChange={setFilters} sort={sort} onSort={setSort} categories={categories} chains={chainOptions} collapsible={isPhone} />
        ),
        groups: list,
      }}
    />
  )
}
