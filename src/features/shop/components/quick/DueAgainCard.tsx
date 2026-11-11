import { useState } from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import { Card, Truncate, cx } from '../../../../shared/ui'
import { useAddAgain } from '../../hooks/useShop'
import { rhythmWords, type DueAgain } from '../../buyAgainModel'
import { buyAgainInput } from '../../shopModel'
import { RowPicture } from './QuickRows'

/**
 * Suggestions shown before "Show N more", the most overdue first: a full first row of cells — 4 in two columns
 * (3 left a cell empty), 3 in three.
 */
const SHOWN_TWO = 4
const SHOWN_THREE = 3

/**
 * Buy again: what your own ticks say is due — "Milk · Every 6 days · last
 * bought 5 days ago" — one compact group right above the list. A tap puts it
 * back on the list with its store, category and product (so its price comes
 * back too), "On the quick list · Milk · Undo"; a second tap while it saves
 * does nothing. Narrow (a phone) it is one line — what is due, by name — that
 * opens in place (cleanup, 11.11.2026: open, it took about 190 px of the
 * phone's first screen); from 40rem the rows flow into columns, like the
 * stores under it. The widths are the card's own (container queries), so the
 * first paint is already right.
 */
export function DueAgainCard({ rows }: { rows: readonly DueAgain[] }) {
  const { add, isSaving } = useAddAgain()
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState(false)
  const moreTwo = rows.length - SHOWN_TWO
  const moreThree = rows.length - SHOWN_THREE
  return (
    <Card padded={false} className="@container overflow-hidden">
      {/* Narrow: one line that opens in place, naming what is due. */}
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}
        className="flex w-full min-w-0 items-center gap-2 px-3.5 py-2 text-left transition-colors hover:bg-surface-hover @[40rem]:hidden">
        <span className="shrink-0 text-ui font-semibold text-fg">Buy again</span>
        <span className="count-badge shrink-0">{rows.length}</span>
        {!open && <Truncate as="span" className="min-w-0 flex-1 text-meta text-fg-muted">{rows.map(r => r.title).join(', ')}</Truncate>}
        <ChevronDown aria-hidden className={cx('ml-auto h-4 w-4 shrink-0 text-fg-muted transition-transform', open && 'rotate-180')} />
      </button>
      <div className="hidden items-baseline gap-2 px-3.5 py-2 @[40rem]:flex">
        <h2 className="text-ui font-semibold text-fg">Buy again</h2>
        <span className="count-badge">{rows.length}</span>
      </div>
      {/* Each cell draws its top and left line; -ml-px tucks the first column's left line under the card's edge. */}
      <ul className={cx('-ml-px @[40rem]:grid @[40rem]:grid-cols-2 @[72rem]:grid-cols-3', open ? 'grid' : 'hidden')}>
        {rows.map((r, i) => {
          const words = rhythmWords(r)
          const saving = isSaving(r.row.id)
          return (
            <li key={r.row.id} className={cx('min-w-0 border-l border-t border-line',
              !all && i >= SHOWN_TWO && '@[40rem]:hidden', !all && i >= SHOWN_THREE && '@[72rem]:hidden')}>
              <button type="button" onClick={() => void add(r.row.id, buyAgainInput(r))} aria-busy={saving || undefined}
                aria-label={`Add ${r.title} to the quick list — ${words}`}
                className="flex w-full items-center gap-2.5 py-1.5 pl-3.5 pr-2.5 text-left transition-colors hover:bg-surface-hover aria-busy:opacity-60">
                <span className="min-w-0 flex-1">
                  <Truncate as="span" className="block text-body font-medium leading-5 text-fg">{r.title}</Truncate>
                  <Truncate as="span" className="block text-meta text-fg-muted tabular-nums">{words}</Truncate>
                </span>
                <RowPicture src={r.row.image_url} />
                <span aria-hidden className="inline-flex shrink-0 items-center gap-1 rounded-control px-1.5 py-1 text-meta font-semibold text-accent-600">
                  <Plus className="h-3.5 w-3.5" /> Add
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {/* Wide only (narrow, the open line shows them all): there only while rows are left out at the card's width. */}
      {moreThree > 0 && (
        <button type="button" onClick={() => setAll(a => !a)} aria-expanded={all}
          className={cx('hidden min-h-[36px] w-full items-center border-t border-line px-3.5 text-meta font-semibold text-accent-600 hover:underline [@media(pointer:coarse)]:min-h-[44px]',
            moreTwo > 0 ? '@[40rem]:flex' : '@[72rem]:flex')}>
          {all ? 'Show fewer' : <>
            {moreTwo > 0 && <span className="@[72rem]:hidden">Show {moreTwo} more</span>}
            <span className="hidden @[72rem]:inline">Show {moreThree} more</span>
          </>}
        </button>
      )}
    </Card>
  )
}
