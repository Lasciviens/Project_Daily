import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Card, Truncate } from '../../../../shared/ui'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { useAddAgain } from '../../hooks/useShop'
import { rhythmWords, type DueAgain } from '../../buyAgainModel'
import { buyAgainInput } from '../../shopModel'
import { RowPicture } from './QuickRows'

/** Suggestions shown before "Show N more": the most overdue lead. */
const SHOWN = 3

/**
 * Buy again: what your own ticks say is due — "Milk · Usually every 6 days,
 * last 5 days ago" — one compact group right above the list. A tap puts it
 * back on the list with its store, category and product (so its price comes
 * back too), "On the quick list · Milk · Undo". Rows flow into columns as
 * the track widens, like the stores under it.
 */
export function DueAgainCard({ rows }: { rows: readonly DueAgain[] }) {
  const { add } = useAddAgain()
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, SHOWN)
  return (
    <Card padded={false} className="@container overflow-hidden">
      <div className="flex items-baseline gap-2 px-3.5 py-2">
        <h2 className="text-ui font-semibold text-fg">Buy again</h2>
        <span className="count-badge">{rows.length}</span>
      </div>
      {/* Each cell draws its top and left line; -ml-px tucks the first column's left line under the card's edge. */}
      <ul className="-ml-px grid @[40rem]:grid-cols-2 @[72rem]:grid-cols-3">
        {shown.map(r => {
          const words = rhythmWords(r)
          return (
            <li key={r.row.id} className="min-w-0 border-l border-t border-line">
              <button type="button" onClick={() => add(buyAgainInput(r))}
                aria-label={`Add ${r.title} to the quick list — ${words}`}
                title={`Bought on ${r.count} days, last on ${formatDate(r.last)}`}
                className="flex min-h-[44px] w-full items-center gap-2.5 py-1.5 pl-3.5 pr-2.5 text-left transition-colors hover:bg-surface-hover">
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
      {rows.length > SHOWN && (
        <button type="button" onClick={() => setAll(a => !a)} aria-expanded={all}
          className="flex min-h-[36px] w-full items-center border-t border-line px-3.5 text-meta font-semibold text-accent-600 hover:underline [@media(pointer:coarse)]:min-h-[44px]">
          {all ? 'Show fewer' : `Show ${rows.length - SHOWN} more`}
        </button>
      )}
    </Card>
  )
}
