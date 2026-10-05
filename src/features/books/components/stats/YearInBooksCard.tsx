import { useMemo } from 'react'
import { BarChart3 } from 'lucide-react'
import { Card, CardHeader, Skeleton } from '../../../../shared/ui'
import { formatDuration, yearMonths } from '../../readingAggregate'
import type { Book, ReadingEvent } from '../../types'

const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']

/** Hours read per month of the picked year, with the books finished that month under each bar. */
export function YearInBooksCard({ events, books, year, loading }: {
  events: readonly ReadingEvent[]; books: readonly Book[]; year: number; loading: boolean
}) {
  const months = useMemo(() => yearMonths(events, books, year), [events, books, year])
  const max = Math.max(...months.map(m => m.seconds), 1)
  const total = months.reduce((t, m) => t + m.seconds, 0)
  const finished = months.reduce((t, m) => t + m.finished, 0)
  return (
    <Card>
      <CardHeader title={`Year in books · ${year}`} variant="label" icon={<BarChart3 />}
        subtitle={`${formatDuration(total)} read · ${finished} finished`} />
      {loading ? <Skeleton className="h-32" /> : total === 0 && finished === 0 ? (
        <p className="text-meta text-fg-muted">Nothing synced for {year}. Reading from the Kobo appears here month by month.</p>
      ) : (
        <div className="grid grid-cols-12 gap-1" role="img" aria-label={`Hours read per month in ${year}`}>
          {months.map(m => (
            <div key={m.month} className="flex min-w-0 flex-col items-center gap-1"
              title={`${String(m.month + 1).padStart(2, '0')}.${year}: ${formatDuration(m.seconds)}, ${m.finished} finished`}>
              <div className="flex h-24 w-full items-end">
                <div className="w-full rounded-t-[3px] bg-accent-500" style={{ height: `${m.seconds ? Math.max((m.seconds / max) * 100, 3) : 0}%` }} />
              </div>
              <span className="text-micro tabular-nums text-fg-faint">{MONTHS[m.month]}</span>
              <span className={`text-micro tabular-nums ${m.finished ? 'font-semibold text-fg' : 'text-fg-faint'}`}>{m.finished || '·'}</span>
            </div>
          ))}
        </div>
      )}
      {(total > 0 || finished > 0) && !loading && <p className="mt-2 text-micro text-fg-muted">Bars: time read. Number under a month: books finished.</p>}
    </Card>
  )
}
