import { useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ChevronDown } from 'lucide-react'
import { Skeleton, Truncate, cx } from '../../../../shared/ui'
import { useElementWidthRem } from '../../../../shared/hooks/useElementWidth'
import { dealByIndex } from '../../../projects/projectBoard'
import { rowStacks } from '../../ownedRow'
import { categoryPath, type CategoryGroup, type SubGroup } from '../../shopModel'
import type { MoneyCtx } from '../../ownModel'
import { CategorySection } from '../CategorySection'
import { OwnedRow } from './OwnedRow'
import { OwnedCard, OwnedLine } from './OwnedViews'
import type { OwnedLayout } from '../../hooks/useOwnedLayout'
import type { ShopListing } from '../../resaleTypes'
import type { ShopCategory, ShopItem, ShopPriceWatch } from '../../types'

export interface RowContext {
  acc: ReadonlyMap<string, ShopItem[]>
  /** Each thing's money chain name, for the things in one with another. */
  chainOf: (id: string) => string | null
  watches: ReadonlyMap<string, ShopPriceWatch>
  ctx: MoneyCtx
  today: string
  categories: readonly ShopCategory[]
  /** A category path's default picture (useCategoryPictures), once its chunk is in. */
  pictureFor: ((top: string, sub: string | null) => LucideIcon | null) | null
  /** Each thing's open listing (its "For sale · 12 days" tag). */
  listings: ReadonlyMap<string, ShopListing>
}

/** One stack's widest (THEME W2: a content row is never wider than 40rem). */
const STACK_CAP = 'max-w-[40rem]'

/**
 * Owned's things as compact rows (step A): each category a section that folds
 * (Fold all), each subcategory named once above its own card of rows, the
 * accessories under their thing. A wide list deals its categories into
 * column stacks by its own width (`rowStacks`: one on a phone, two at 1469,
 * four at 2450). A row opens its record in the popup.
 */
export function OwnedList({ groups, rows, collapsed, onToggle, onOpen, layout }: {
  groups: readonly CategoryGroup[]
  rows: RowContext
  layout: OwnedLayout
  collapsed: ReadonlySet<string>
  onToggle: (key: string) => void
  onOpen: (id: string) => void
}) {
  const { ref, width } = useElementWidthRem()
  // Never more stacks than categories; each at most a content row wide, so a short list leaves the room at its end.
  const stacks = dealByIndex([...groups], Math.min(rowStacks(width), Math.max(1, groups.length)))
  const row = (item: ShopItem) => <OwnedThing key={item.id} item={item} rows={rows} onOpen={onOpen} layout={layout} />
  const section = (group: CategoryGroup) => (
    <CategorySection key={group.key} group={group} collapsed={collapsed.has(group.key)} onToggle={() => onToggle(group.key)} card={row}
      body={id => <SubLists id={id} subs={group.subs} row={row} layout={layout} />} />
  )
  // Big pictures are a collection: the categories stack in the list's whole width, each one a grid of cards (THEME W2).
  if (layout === 'pictures') return <div ref={ref} className="flex min-w-0 flex-col gap-4">{groups.map(section)}</div>
  return (
    <div ref={ref} className="min-w-0">
      {stacks.length <= 1 ? (
        <div className={cx('flex flex-col gap-4', STACK_CAP)}>{(stacks[0] ?? []).map(section)}</div>
      ) : (
        <div className="grid items-start gap-x-6 gap-y-4" style={{ gridTemplateColumns: `repeat(${stacks.length}, minmax(0, 40rem))` }}>
          {stacks.map((stack, i) => <div key={i} className="flex min-w-0 flex-col gap-4">{stack.map(section)}</div>)}
        </div>
      )}
    </div>
  )
}

/** One thing's row with its own picture and chain. */
function OwnedThing({ item, rows, onOpen, layout }: { item: ShopItem; rows: RowContext; onOpen: (id: string) => void; layout: OwnedLayout }) {
  const path = categoryPath(item.category_id, rows.categories)
  const Thing = layout === 'pictures' ? OwnedCard : layout === 'lines' ? OwnedLine : OwnedRow
  return (
    <Thing item={item} accessories={rows.acc.get(item.id) ?? []} chain={rows.chainOf(item.id)} watch={rows.watches.get(item.id) ?? null}
      listing={rows.listings.get(item.id) ?? null}
      ctx={rows.ctx} today={rows.today} topId={path.topId} icon={path.topId && rows.pictureFor ? rows.pictureFor(path.topName, path.subName) : null}
      onOpen={onOpen} />
  )
}

/** A category's rows: each subcategory named once, above its own card. */
function SubLists({ id, subs, row, layout }: { id: string; subs: readonly SubGroup[]; row: (item: ShopItem) => ReactNode; layout: OwnedLayout }) {
  const labelled = subs.some(s => s.title)
  return (
    <div id={id} className="flex flex-col gap-1.5">
      {subs.map(sub => (
        <div key={sub.key} className="flex flex-col gap-1">
          {labelled && <Truncate as="p" className="section-label px-1">{sub.title ?? 'Other'}</Truncate>}
          <ThingsBox layout={layout}>{sub.items.map(row)}</ThingsBox>
        </div>
      ))}
    </div>
  )
}

/** A subcategory's things: rows and lines in one card, big pictures as a grid of cards (W2: content-width columns). */
function ThingsBox({ layout, children, className }: { layout: OwnedLayout; children: ReactNode; className?: string }) {
  return layout === 'pictures'
    ? <ul className={cx('grid grid-cols-2 gap-2 @[40rem]/page:grid-cols-[repeat(auto-fill,minmax(9.5rem,12rem))]', className)}>{children}</ul>
    : <ul className={cx('card divide-y divide-line overflow-hidden', className)}>{children}</ul>
}

/** The things sold or gone, folded under Mine: the same rows in one card. */
export function GoneFold({ gone, rows, onOpen, layout }: { gone: readonly ShopItem[]; rows: RowContext; onOpen: (id: string) => void; layout: OwnedLayout }) {
  const [show, setShow] = useState(false)
  if (!gone.length) return null
  return (
    <section className={layout === 'pictures' ? undefined : STACK_CAP}>
      <button type="button" aria-expanded={show} onClick={() => setShow(s => !s)}
        className="flex min-h-[44px] items-center gap-1.5 text-body font-semibold text-fg-muted transition-colors hover:text-fg-2">
        <ChevronDown aria-hidden className={cx('h-4 w-4 transition-transform', show && 'rotate-180')} />
        Sold or gone <span className="count-badge">{gone.length}</span>
      </button>
      {show && <ThingsBox layout={layout} className="mt-1">{gone.map(i => <OwnedThing key={i.id} item={i} rows={rows} onOpen={onOpen} layout={layout} />)}</ThingsBox>}
    </section>
  )
}

/** The list's loading copy at its geometry: a category's title and a card of rows. */
export function OwnedListSkeleton() {
  return (
    <div aria-busy="true" className={cx('flex flex-col gap-2', STACK_CAP)}>
      <span className="flex min-h-[44px] items-center"><Skeleton className="h-5 w-40" /></span>
      <div className="card divide-y divide-line overflow-hidden">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-2.5 px-3 py-2">
            <Skeleton rounded="rounded-row" className="h-10 w-10 shrink-0" />
            <span className="flex min-w-0 flex-1 flex-col gap-1.5 py-0.5"><Skeleton className="h-3.5 w-3/5" /><Skeleton className="h-3 w-2/5" /></span>
            <Skeleton className="h-3.5 w-12 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  )
}
