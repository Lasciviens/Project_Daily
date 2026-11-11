// ─────────────────────────────────────────────────────────────────────────────
//  ✨'s mark on a row it filled (step 4 of docs/features/item-screen-plan.md):
//  shown after the row's label until the owner keeps the fill ("Use these",
//  Add) or puts it back (Cancel, Undo). The screen names the rows by their
//  labels (itemFillForm.fillForm's `rows`); ItemRows' Label asks here.
// ─────────────────────────────────────────────────────────────────────────────

import { createContext, useContext, type ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import { cx } from '../../ui'

const NONE: ReadonlySet<string> = new Set()
const FilledRowsContext = createContext<ReadonlySet<string>>(NONE)

export function FilledRows({ rows, children }: { rows?: ReadonlySet<string>; children: ReactNode }) {
  return <FilledRowsContext.Provider value={rows ?? NONE}>{children}</FilledRowsContext.Provider>
}

/** The mark, when ✨ filled the row labelled `row` (a label that isn't plain text never is). */
export function FilledMark({ row, className }: { row: ReactNode; className?: string }) {
  const rows = useContext(FilledRowsContext)
  if (typeof row !== 'string' || !rows.has(row)) return null
  return (
    <span role="img" aria-label="Filled from your sentence — not kept yet" title="Filled from your sentence — not kept yet"
      data-tone="accent" className={cx('tone-text inline-flex shrink-0', className)}>
      <Sparkles aria-hidden className="h-3.5 w-3.5" />
    </span>
  )
}
