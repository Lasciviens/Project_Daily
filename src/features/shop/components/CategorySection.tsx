import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cx } from '../../../shared/ui'
import type { CategoryGroup } from '../shopModel'
import type { ShopItem } from '../types'

// Cards in rows of equal height (owner, 08.10.2026: "ALIGNED"): every row
// stretches its cards to the tallest, and each card keeps its actions at the
// bottom, so prices and buttons line up across a row.
export const CARD_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] items-stretch gap-2 sm:gap-3'

/**
 * One category as a full-width section with a folding header (count and a
 * total stay visible when folded) and all its cards in one aligned grid, in
 * subcategory order, each labelled with its subcategory.
 */
export function CategorySection({ group, collapsed, onToggle, aside, card }: {
  group: CategoryGroup
  collapsed: boolean
  onToggle: () => void
  /** Right of the title — a total. */
  aside?: ReactNode
  card: (item: ShopItem) => ReactNode
}) {
  const id = `shop-cat-${group.key}`
  // With subcategories, every card carries its own (one grid, so the rows stay full and aligned).
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
      {!collapsed && (
        <div id={id} className={CARD_GRID}>
          {group.subs.flatMap(sub => sub.items.map(item => (
            <div key={item.id} className="flex min-w-0 flex-col gap-1">
              {labelled && <p className="section-label truncate">{sub.title ?? 'Other'}</p>}
              <div className="flex flex-1 flex-col [&>*]:flex-1">{card(item)}</div>
            </div>
          )))}
        </div>
      )}
    </section>
  )
}

/** "Fold all" / "Open all" for the sections on screen. */
export function FoldAll({ keys, collapsed, onSet }: { keys: string[]; collapsed: ReadonlySet<string>; onSet: (keys: string[], fold: boolean) => void }) {
  if (keys.length < 2) return null
  const allFolded = keys.every(k => collapsed.has(k))
  return (
    <button type="button" onClick={() => onSet(keys, !allFolded)}
      className="flex min-h-[44px] w-fit items-center text-meta font-medium text-fg-muted transition-colors hover:text-fg-2">
      {allFolded ? 'Open all categories' : 'Fold all categories'}
    </button>
  )
}
