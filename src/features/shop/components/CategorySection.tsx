import type { ReactNode } from 'react'
import { ChevronDown, ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { IconButton, Truncate, cx } from '../../../shared/ui'
import type { CategoryGroup } from '../shopModel'
import type { ShopItem } from '../types'

// Cards in rows of equal height (owner, 08.10.2026: "ALIGNED"): every row
// stretches its cards to the tallest, and each card keeps its actions at the
// bottom, so prices and buttons line up across a row.
export const CARD_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] items-stretch gap-2 sm:gap-3'

/**
 * One category as a full-width section with a folding header (count and a
 * total stay visible when folded) and all its cards in one aligned grid, in
 * subcategory order: each subcategory's label once, across the grid, above
 * its cards.
 */
export function CategorySection({ group, collapsed, onToggle, aside, card, body }: {
  group: CategoryGroup
  collapsed: boolean
  onToggle: () => void
  /** Right of the title — a total. */
  aside?: ReactNode
  card: (item: ShopItem) => ReactNode
  /** Replaces the cards' grid (the Wishlist's picture tiles); `id` belongs on its root. */
  body?: (id: string) => ReactNode
}) {
  const id = `shop-cat-${group.key}`
  // With subcategories, each group of cards gets its label once — a row of its own in the one grid, so the cards' rows stay aligned.
  const labelled = group.subs.some(sub => sub.title)
  return (
    <section className="flex flex-col gap-2">
      <button type="button" aria-expanded={!collapsed} aria-controls={id} onClick={onToggle}
        className="-mx-1 flex min-h-[44px] items-center gap-2 rounded-row px-1 text-left hover:bg-surface-hover">
        <ChevronDown aria-hidden className={cx('h-4 w-4 shrink-0 text-fg-muted transition-transform', collapsed && '-rotate-90')} />
        <h2 className={cx('text-lead font-semibold', group.topId ? 'text-fg' : 'text-fg-muted')}>{group.title}</h2>
        <span className="count-badge">{group.items.length}</span>
        {aside != null && <span className="ml-auto text-meta tabular-nums text-fg-muted">{aside}</span>}
      </button>
      {!collapsed && body && body(id)}
      {!collapsed && !body && (
        <div id={id} className={CARD_GRID}>
          {group.subs.flatMap(sub => [
            labelled && <Truncate key={`label:${sub.key}`} as="p" className="section-label col-span-full -mb-1 pt-1 first:pt-0">{sub.title ?? 'Other'}</Truncate>,
            ...sub.items.map(item => <div key={item.id} className="flex min-w-0 flex-col [&>*]:flex-1">{card(item)}</div>),
          ])}
        </div>
      )}
    </section>
  )
}

/**
 * "Fold all" / "Open all" for the sections on screen: a line above them, or
 * (`compact`, on a phone) an icon button in the filter row, so it costs no
 * line of its own.
 */
export function FoldAll({ keys, collapsed, onSet, compact }: { keys: string[]; collapsed: ReadonlySet<string>; onSet: (keys: string[], fold: boolean) => void; compact?: boolean }) {
  if (keys.length < 2) return null
  const allFolded = keys.every(k => collapsed.has(k))
  const label = allFolded ? 'Open all categories' : 'Fold all categories'
  if (compact) {
    return (
      <IconButton bordered label={label} onClick={() => onSet(keys, !allFolded)} className="shrink-0">
        {allFolded ? <ChevronsUpDown aria-hidden /> : <ChevronsDownUp aria-hidden />}
      </IconButton>
    )
  }
  return (
    <button type="button" onClick={() => onSet(keys, !allFolded)}
      className="flex min-h-[44px] w-fit items-center text-meta font-medium text-fg-muted transition-colors hover:text-fg-2">
      {label}
    </button>
  )
}
