import { useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ChevronDown } from 'lucide-react'
import { Skeleton, Truncate, cx } from '../../../../shared/ui'
import { useElementWidthRem } from '../../../../shared/hooks/useElementWidth'
import { dealByIndex } from '../../../projects/projectBoard'
import { rowStacks, subColumns } from '../../ownedRow'
import { TILE_GRID, type TileLayout } from '../../wishTile'
import { categoryPath, type CategoryGroup, type SubGroup } from '../../shopModel'
import type { MoneyCtx } from '../../ownModel'
import { CategorySection } from '../CategorySection'
import { OwnedRow } from './OwnedRow'
import { OwnedCard, OwnedCardSkeleton, OwnedLine } from './OwnedViews'
import { PictureBlocks, PictureCategories } from '../tileKit'
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
export function OwnedList({ groups, gone, rows, collapsed, onToggle, onOpen, layout }: {
  groups: readonly CategoryGroup[]
  /** The things sold or gone: in Big pictures their fold packs with the categories (elsewhere it follows the list). */
  gone: readonly ShopItem[]
  rows: RowContext
  layout: OwnedLayout
  collapsed: ReadonlySet<string>
  onToggle: (key: string) => void
  onOpen: (id: string) => void
}) {
  const { ref, width } = useElementWidthRem()
  const columns = rowStacks(width)
  const row = (item: ShopItem) => <OwnedThing key={item.id} item={item} rows={rows} onOpen={onOpen} layout={layout} />
  const section = (group: CategoryGroup, cols: number, tiles?: TileLayout) => (
    <CategorySection key={group.key} group={group} collapsed={collapsed.has(group.key)} onToggle={() => onToggle(group.key)} card={row}
      body={id => layout === 'pictures'
        ? <PictureBlocks id={id} subs={group.subs} card={row} layout={tiles} />
        : <SubLists id={id} subs={group.subs} row={row} columns={cols} />} />
  )
  // Big pictures: the Wishlist's own layout (THEME §6 picture tiles) — categories that fit in one row share a line, each
  // subcategory a block of cards packed side by side; the Gone fold packs as one more.
  if (layout === 'pictures') {
    const items = [...groups.map(g => ({ key: g.key, blocks: g.subs.map(s => s.items.length) })), ...(gone.length ? [{ key: 'gone', blocks: [gone.length] }] : [])]
    return (
      <PictureCategories items={items}
        render={(i, tiles) => i < groups.length ? section(groups[i], 1, tiles) : <GoneFold gone={gone} rows={rows} onOpen={onOpen} layout={layout} tiles={tiles} />} />
    )
  }
  // Rows and lines: the categories are one grid of 21–40rem columns, each category as wide as its subcategories can fill and
  // `dense`, so small categories pack side by side instead of each sitting alone in a nearly empty band (owner, 23.11.2026).
  return (
    <div ref={ref} className="min-w-0">
      <div className="grid items-start gap-x-6 gap-y-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 40rem))`, gridAutoFlow: 'row dense' }}>
        {groups.map(g => {
          const span = subColumns(g.subs.length, columns)
          return <div key={g.key} className="min-w-0" style={{ gridColumn: `span ${span}` }}>{section(g, span)}</div>
        })}
      </div>
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

/**
 * A category's rows and lines: each subcategory named once, above its own card, dealt into `columns` stacks of 21–40rem.
 * (Big pictures are `PictureBlocks`.)
 */
function SubLists({ id, subs, row, columns }: { id: string; subs: readonly SubGroup[]; row: (item: ShopItem) => ReactNode; columns: number }) {
  const labelled = subs.some(s => s.title)
  const block = (sub: SubGroup) => (
    <div key={sub.key} className="flex min-w-0 flex-col gap-1">
      {labelled && <Truncate as="p" className="section-label px-1">{sub.title ?? 'Other'}</Truncate>}
      <ThingsBox>{sub.items.map(row)}</ThingsBox>
    </div>
  )
  const stacks = dealByIndex([...subs], subColumns(subs.length, columns))
  if (stacks.length <= 1) return <div id={id} className="flex flex-col gap-1.5">{subs.map(sub => block(sub))}</div>
  return (
    <div id={id} className="grid items-start gap-x-6 gap-y-1.5" style={{ gridTemplateColumns: `repeat(${stacks.length}, minmax(0, 1fr))` }}>
      {stacks.map((stack, i) => <div key={i} className="flex min-w-0 flex-col gap-1.5">{stack.map(sub => block(sub))}</div>)}
    </div>
  )
}

/** A subcategory's rows or lines in one card. */
function ThingsBox({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cx('card divide-y divide-line overflow-hidden', className)}>{children}</ul>
}

/** The things sold or gone, folded under Mine: the same rows in one card, or the same cards as Big pictures. */
export function GoneFold({ gone, rows, onOpen, layout, tiles }: {
  gone: readonly ShopItem[]; rows: RowContext; onOpen: (id: string) => void; layout: OwnedLayout
  /** In Big pictures, the layout the packed list hands down. */
  tiles?: TileLayout
}) {
  const [show, setShow] = useState(false)
  if (!gone.length) return null
  const thing = (i: ShopItem) => <OwnedThing key={i.id} item={i} rows={rows} onOpen={onOpen} layout={layout} />
  return (
    <section className={layout === 'pictures' ? undefined : STACK_CAP}>
      <button title="Gone — sold or gone" type="button" aria-expanded={show} onClick={() => setShow(s => !s)}
        className="flex min-h-[44px] items-center gap-1.5 text-body font-semibold text-fg-muted transition-colors hover:text-fg-2">
        <ChevronDown aria-hidden className={cx('h-4 w-4 transition-transform', show && 'rotate-180')} />
        Gone <span className="count-badge">{gone.length}</span>
      </button>
      {show && (layout === 'pictures'
        ? <div className="mt-1"><PictureBlocks subs={[{ key: 'gone', title: null, items: gone }]} card={thing} layout={tiles} /></div>
        : <ThingsBox className="mt-1">{gone.map(thing)}</ThingsBox>)}
    </section>
  )
}

/** The list's loading copy at its geometry: a category's title and a card of rows — or, in Big pictures, cards. */
export function OwnedListSkeleton({ layout }: { layout: OwnedLayout }) {
  if (layout === 'pictures') {
    return (
      <div aria-busy="true" className="flex flex-col gap-2">
        <span className="flex min-h-[44px] items-center"><Skeleton className="h-5 w-40" /></span>
        <div className={TILE_GRID}>{Array.from({ length: 6 }, (_, i) => <OwnedCardSkeleton key={i} />)}</div>
      </div>
    )
  }
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
