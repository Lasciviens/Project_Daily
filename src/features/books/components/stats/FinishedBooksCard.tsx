import { useMemo } from 'react'
import { BookCheck } from 'lucide-react'
import { Card, CardHeader, Truncate } from '../../../../shared/ui'
import { useEntityModal } from '../../../../shared/modals'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { daysTaken, finishedInYear, finishedYears, formatDuration } from '../../readingAggregate'
import type { Book } from '../../types'
import { BookCover } from '../BookCover'

/** Books finished in the picked year: cover, finish date, days taken, total time. */
export function FinishedBooksCard({ books, year, onYear, thisYear }: {
  books: readonly Book[]; year: number; onYear: (y: number) => void; thisYear: number
}) {
  const modal = useEntityModal()
  const years = useMemo(() => finishedYears(books, thisYear), [books, thisYear])
  const done = useMemo(() => finishedInYear(books, year), [books, year])
  return (
    <Card>
      <CardHeader title="Finished books" variant="label" icon={<BookCheck />}
        subtitle={`${done.length} in ${year}`}
        action={years.length > 1 ? (
          <select aria-label="Year" className="select min-h-[44px] w-auto" value={year} onChange={e => onYear(Number(e.target.value))}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        ) : undefined} />
      {done.length === 0 ? (
        <p className="text-meta text-fg-muted">
          No book finished in {year} yet. A book counts when its status is Finished — set it in the book popup, or finish it on the Kobo.
        </p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-3">
          {done.map(b => {
            const took = daysTaken(b.started_at, b.finished_at)
            return (
              <li key={b.id}>
                <button type="button" onClick={() => modal.open({ kind: 'book', id: b.id })}
                  className="flex min-h-[44px] w-full flex-col gap-1 rounded-row p-1 text-left hover:bg-surface-hover">
                  <BookCover book={b} className="w-full" />
                  <Truncate as="span" lines={2} className="text-meta font-medium text-fg">{b.title}</Truncate>
                  <span className="text-micro tabular-nums text-fg-muted">{formatDate(b.finished_at)}</span>
                  {(took != null || b.read_seconds) ? (
                    <span className="text-micro tabular-nums text-fg-muted">
                      {[took != null ? `${took} ${took === 1 ? 'day' : 'days'}` : null, b.read_seconds ? formatDuration(b.read_seconds) : null].filter(Boolean).join(' · ')}
                    </span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
