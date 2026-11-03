import type { ReactNode } from 'react'
import { cx } from './cx'

/**
 * One place for controls that change with the open section (a tab's own views, a day picker),
 * as big as the largest of them on every section, so the bar around it keeps its size, lines
 * and places on a switch (owner, 31.10.2026 and 03.11.2026: "should not be reshaped, moved,
 * resized when changing tabs"). Every item sits in the same grid cell, stretched to the slot;
 * only `show`'s is seen — the others keep their room hidden (`invisible` + `inert`: no focus,
 * no screen reader). `show` null keeps the whole slot empty. THEME.md §6.3.
 */
export function SteadySlot<K extends string>({ show, items, className }: {
  show: K | null
  items: Record<K, ReactNode>
  className?: string
}) {
  return (
    <div className={cx('grid items-center', className)}>
      {(Object.keys(items) as K[]).map(k => (
        <div key={k} className={cx('col-start-1 row-start-1 min-w-0', k !== show && 'invisible')} inert={k !== show} aria-hidden={k !== show || undefined}>
          {items[k]}
        </div>
      ))}
    </div>
  )
}
