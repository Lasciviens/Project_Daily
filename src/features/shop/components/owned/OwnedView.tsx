import type { RecordFact } from '../../shopSuggestions'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PackagePlus } from 'lucide-react'
import { Button, EmptyState, PageBoard, useBoardStep } from '../../../../shared/ui'
import type { BoardLayouts } from '../../../../shared/ui/pageBoardRules'
import { useEntityModal } from '../../../../shared/modals'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { useIdlePreload } from '../../../../shared/hooks/useIdlePreload'
import { useRememberedFlag } from '../../../../shared/hooks/useLayoutMemory'
import { lazyPart } from '../../../../shared/utils/lazyPage'
import { useShopItems } from '../../hooks/useShop'
import { useShopLinks, useShopMoney } from '../../hooks/useShopMoney'
import { useWatchMap } from '../../hooks/useShopPrices'
import { useListings } from '../../hooks/useShopResale'
import { openListingsByItem } from '../../sellingModel'
import { useFoldedFilters } from '../../hooks/useFoldedFilters'
import { useCategoryPictures } from '../../hooks/useCategoryPictures'
import { groupByCategory } from '../../shopModel'
import { FoldAll } from '../CategorySection'
import { useCollapsedGroups } from '../../hooks/useCollapsedGroups'
import {
  accessoriesByItem, NO_OWNED_FILTERS, ownedCards, ownedFilterCount, sortOwned,
  type OwnedFilters, type OwnedSort,
} from '../../ownModel'
import { chainIndex, chainsOf, chainTitle } from '../../chainModel'
import { OWNED_BOARD, OWNED_PANE_BOARD, type OwnedPaneSection } from '../../shopBoard'
import { useOwnedLayout } from '../../hooks/useOwnedLayout'
import { OwnedFiltersCard } from './OwnedFilters'
import { GoneFold, OwnedList, OwnedListSkeleton, type RowContext } from './OwnedList'
import { RecordPaneSkeleton } from './paneSkeleton'
import type { ShopCategory, ShopItem } from '../../types'

// The record beside the list from 60rem: loaded when a row is first tapped, and in idle time once the list shows.
const RecordPane = lazyPart('shop-record-pane', () => import('../record/RecordPane').then(m => m.RecordPane))
const PANE_PARTS = [RecordPane]

/** What the side pane shows: a thing, opened at a fact (an old estimate), `seq` for each opening. */
interface Picked { id: string; fact?: RecordFact; seq: number }

/**
 * Focus the element that opened the pane — or, when it is gone (a Needs-a-look row: the list leaves the rail while
 * the pane has it, and its rows come back as new elements, maybe after their reads), the one with its key, for
 * up to a second.
 */
function returnFocus(back: { el: HTMLElement; key: string | null }, frames = 60) {
  requestAnimationFrame(() => {
    // The owner moved the focus on meanwhile: leave it there.
    if (document.activeElement && document.activeElement !== document.body) return
    const el = back.el.isConnected ? back.el
      : back.key ? document.querySelector<HTMLElement>(`[data-return-focus="${CSS.escape(back.key)}"]`) : null
    if (el) el.focus({ preventScroll: true })
    else if (back.key && frames > 0) returnFocus(back, frames - 1)
  })
}

/**
 * A thing opened from Needs a look's sheet (the Shop's header): on a wide board in the side pane, else in a popup. It
 * lives inside the board, where the board's step is known; it opens once and tells the page it has.
 */
function LookRequest({ request, onPick, onDone }: {
  request: { id: string; fact?: RecordFact; seq: number } | null
  onPick: (id: string, fact?: RecordFact) => void
  onDone: () => void
}) {
  const modal = useEntityModal()
  const wide = useBoardStep() >= 2
  useEffect(() => {
    if (!request) return
    if (wide) onPick(request.id, request.fact)
    else modal.open(request.fact ? { kind: 'shop-item', id: request.id, fact: request.fact } : { kind: 'shop-item', id: request.id })
    onDone()
    // One opening per request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.seq])
  return null
}

/**
 * Owned → Things: what you have (by category, as compact rows) and what you
 * had, as rows, one line each, or big pictures (the device remembers which).
 * From a board width of 60rem a tapped row's record opens beside the list (the
 * side pane, which takes the last track); a phone opens it full screen.
 */
export function OwnedView({ items, categories, isLoading, open, onOpened }: {
  items: ShopItem[]; categories: ShopCategory[]; isLoading: boolean
  /** A thing asked for from Needs a look's sheet. */
  open: { id: string; fact?: RecordFact; seq: number } | null
  onOpened: () => void
}) {
  const modal = useEntityModal()
  const itemsQ = useShopItems()
  const today = todayStr()
  const folded = useFoldedFilters()
  const { ctx } = useShopMoney()
  const { data: links = [] } = useShopLinks()
  const watches = useWatchMap()
  const { data: listingRows } = useListings()
  const listings = useMemo(() => openListingsByItem(listingRows ?? []), [listingRows])
  const pictures = useCategoryPictures()
  const [filters, setFilters] = useState<OwnedFilters>(NO_OWNED_FILTERS)
  const [sort, setSort] = useState<OwnedSort>('recent')
  const [layout, setLayout] = useOwnedLayout()
  const [picked, setPicked] = useState<Picked | null>(null)
  const dirty = useRef(false)
  // The row (or Needs-a-look row) that opened the pane: the focus goes back to it when the pane closes.
  const opener = useRef<{ el: HTMLElement; key: string | null } | null>(null)
  const seq = useRef(0)
  useIdlePreload(PANE_PARTS)

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

  /** Open a thing in the side pane — asking first when the one open has unsaved changes. */
  const pick = useCallback(async (id: string, fact?: RecordFact) => {
    if (dirty.current && !(await modal.confirm({ title: 'Discard your changes?', message: 'They are not saved yet.', confirmLabel: 'Discard', destructive: true }))) return
    dirty.current = false
    const from = document.activeElement
    if (from instanceof HTMLElement && !from.closest('[data-record-pane]')) opener.current = { el: from, key: from.dataset.returnFocus ?? null }
    setPicked(p => (p && p.id === id && !fact ? p : { id, fact, seq: ++seq.current }))
  }, [modal])
  const openThing = (id: string, pane: boolean) => (pane ? void pick(id) : modal.open({ kind: 'shop-item', id }))
  const closePane = useCallback(() => {
    dirty.current = false
    setPicked(null)
    const back = opener.current
    opener.current = null
    if (back) returnFocus(back)
  }, [])
  const onDirty = useCallback((d: boolean) => { dirty.current = d }, [])

  const rows: RowContext = {
    acc, ctx, today, categories, watches, listings, picked: picked?.id ?? null,
    chainOf: id => {
      const c = chains.get(id)
      const linked = c ? c.nodes.filter(n => n.state !== 'wish').length : 0
      return c && linked > 1 ? c.name ?? `chain of ${linked}` : null
    },
    pictureFor: pictures.pictureFor,
  }

  const list = listLoading ? (
    <OwnedListSkeleton key="loading" />
  ) : !anything ? (
    <EmptyState key="empty" bordered className="max-w-md" icon={<PackagePlus />} title="Start with what you use every day"
      description="Your phone, your console, the TV — with what they cost and when. Mark a wish bought and it lands here too."
      action={<Button icon={<PackagePlus />} onClick={() => modal.open({ kind: 'shop-own' })}>Add something I own</Button>} />
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

  // The things take every track; with the record open they leave the last one to it (the pane is sticky there).
  const board = (picked ? OWNED_PANE_BOARD : OWNED_BOARD) as BoardLayouts<OwnedPaneSection>
  return (
    <PageBoard
      layout={board}
      stackGap="gap-4"
      sections={{
        pane: picked && (
          <Suspense fallback={<RecordPaneSkeleton />}>
            <RecordPane key={picked.seq} id={picked.id} fact={picked.fact} onClose={closePane} onOpen={id => void pick(id)} onDirty={onDirty} />
          </Suspense>
        ),
        filters: showFilters && (
          <OwnedFiltersCard filters={filters} onChange={setFilters} sort={sort} onSort={setSort} categories={categories} chains={chainOptions}
            collapsible={folded} layout={layout} onLayout={setLayout}
            fold={<FoldAll keys={groups.map(g => g.key)} collapsed={fold.collapsed} onSet={fold.setAll} pending={isLoading && foldable} />} />
        ),
        groups: <>
          <LookRequest request={open} onPick={(id, fact) => void pick(id, fact)} onDone={onOpened} />
          {list}
        </>,
      }}
    />
  )
}
