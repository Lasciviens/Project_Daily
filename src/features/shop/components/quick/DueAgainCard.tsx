import { useState } from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import { Card, Truncate, cx } from '../../../../shared/ui'
import { useAddAgain } from '../../hooks/useShop'
import { dueSummary, rhythmWords, type DueAgain } from '../../buyAgainModel'
import { buyAgainInput } from '../../shopModel'
import { RowPicture } from './QuickRows'

/** Suggestions shown before "Show N more": two full rows of two columns, or of three on a wide track. */
const SHOWN_TWO = 4
const SHOWN_THREE = 6

/**
 * A suggestion's place in the grid. Before "Show more" only the first four
 * show (six on a three-column track), and the last one shown spans what its
 * row has left, so no cell stands empty at two or three columns.
 */
function cellClass(i: number, total: number, all: boolean): string {
  const two = all ? total : Math.min(total, SHOWN_TWO)
  const three = all ? total : Math.min(total, SHOWN_THREE)
  const spanTwo = i === two - 1 && two % 2 === 1
  const leftThree = three % 3
  return cx(
    !all && i >= SHOWN_TWO && 'hidden @[72rem]:block',
    spanTwo && '@[40rem]:col-span-2',
    i === three - 1 && leftThree === 1 ? '@[72rem]:col-span-3' : i === three - 1 && leftThree === 2 ? '@[72rem]:col-span-2' : spanTwo && '@[72rem]:col-span-1',
  )
}

/**
 * Buy again: what your own ticks say is due — "Coffee · Every week · last
 * bought 8 days ago" — one compact group leading the list. On a narrow track
 * (a phone) it is one line, "Buy again · Coffee, Dish soap +1", that opens in
 * place, so the first screen stays the things themselves; from 40rem the
 * suggestions show in two columns (three from 72rem). A tap puts one back on
 * the list with its store, category and product (so its price comes back
 * too), "On the quick list · Coffee · Undo"; a second tap while it is on its
 * way is ignored.
 */
export function DueAgainCard({ rows }: { rows: readonly DueAgain[] }) {
  const { add, busy } = useAddAgain()
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, SHOWN_THREE)
  const summary = dueSummary(rows)
  const more = (n: number) => `Show ${n} more`
  return (
    <Card padded={false} className="@container overflow-hidden">
      {/* Narrow: the one line that opens in place. */}
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-2 px-3.5 py-2 text-left @[40rem]:hidden">
        <span className="shrink-0 text-ui font-semibold text-fg">Buy again</span>
        <span aria-hidden className="shrink-0 text-fg-faint">·</span>
        <Truncate as="span" className="min-w-0 text-body text-fg-2">{summary.names}</Truncate>
        {summary.more > 0 && <span className="shrink-0 text-body text-fg-muted tabular-nums">+{summary.more}</span>}
        <ChevronDown aria-hidden className={cx('ml-auto h-4 w-4 shrink-0 text-fg-muted transition-transform', open && 'rotate-180')} />
      </button>
      {/* Wide: the header the stores have too. */}
      <div className="hidden items-baseline gap-2 px-3.5 py-2 @[40rem]:flex">
        <h2 className="text-ui font-semibold text-fg">Buy again</h2>
        <span className="count-badge">{rows.length}</span>
      </div>
      <div className={cx(!open && 'hidden', '@[40rem]:block')}>
        {/* Each cell draws its top and left line; -ml-px tucks the first column's left line under the card's edge. */}
        <ul className="-ml-px grid @[40rem]:grid-cols-2 @[72rem]:grid-cols-3">
          {shown.map((r, i) => {
            const words = rhythmWords(r)
            return (
              <li key={r.row.id} className={cx('min-w-0 border-l border-t border-line', cellClass(i, rows.length, all))}>
                <button type="button" onClick={() => add(buyAgainInput(r))} disabled={busy}
                  aria-label={`Add ${r.title} to the quick list — ${words}`}
                  className="flex w-full items-center gap-2.5 py-1.5 pl-3.5 pr-2.5 text-left transition-colors hover:bg-surface-hover disabled:opacity-60">
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
        {rows.length > SHOWN_TWO && (
          <button type="button" onClick={() => setAll(a => !a)} aria-expanded={all}
            className={cx('flex w-full items-center border-t border-line px-3.5 py-2 text-meta font-semibold text-accent-600 hover:underline',
              !all && rows.length <= SHOWN_THREE && '@[72rem]:hidden')}>
            {all ? 'Show fewer' : rows.length > SHOWN_THREE
              ? <><span className="@[72rem]:hidden">{more(rows.length - SHOWN_TWO)}</span><span className="hidden @[72rem]:inline">{more(rows.length - SHOWN_THREE)}</span></>
              : more(rows.length - SHOWN_TWO)}
          </button>
        )}
      </div>
    </Card>
  )
}
