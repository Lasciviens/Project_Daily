import { useMemo } from 'react'
import { BookOpenText } from 'lucide-react'
import { Card, CardHeader, EmptyState, Truncate } from '../../../../shared/ui'
import { useEntityModal } from '../../../../shared/modals'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { currentlyReading, formatDuration, localDay, relativeDay, type CurrentBook } from '../../readingAggregate'
import type { Book, ReadingEvent } from '../../types'
import { BookCover } from '../BookCover'
import { PAGES_NOTE } from './statsFormat'

/** Books in hand: how far, how long, how fast, and about how long is left. */
export function CurrentlyReadingCard({ books, events, today }: { books: readonly Book[]; events: readonly ReadingEvent[]; today: string }) {
  const rows = useMemo(() => currentlyReading(books, events, today), [books, events, today])
  const byId = useMemo(() => new Map(books.map(b => [b.id, b])), [books])
  return (
    <Card>
      <CardHeader title="Currently reading" icon={<BookOpenText />}
        subtitle={rows.length ? `${rows.length} ${rows.length === 1 ? 'book' : 'books'} in hand` : undefined} />
      {rows.length === 0 ? (
        <EmptyState icon={<BookOpenText />} title="No book in hand"
          description="Open a book on the Kobo, or mark one Reading in the Library, and it shows here with its progress." />
      ) : (
        <div className="@container">
          <ul className="grid grid-cols-1 gap-2 @[46rem]:grid-cols-2">
            {rows.map(r => { const b = byId.get(r.bookId); return b ? <CurrentRow key={r.bookId} row={r} book={b} today={today} /> : null })}
          </ul>
          <p className="mt-3 text-micro text-fg-muted">{PAGES_NOTE} Time left is an estimate from your pace on this book so far.</p>
        </div>
      )}
    </Card>
  )
}

function CurrentRow({ row: r, book: b, today }: { row: CurrentBook; book: Book; today: string }) {
  const modal = useEntityModal()
  const pct = r.progressPct
  const facts = [
    r.seconds > 0 ? `${formatDuration(r.seconds)} read` : null,
    r.sessions ? `${r.sessions} ${r.sessions === 1 ? 'session' : 'sessions'}` : null,
    r.pagesPerHour ? `${r.pagesPerHour} pages/h` : null,
  ].filter(Boolean).join(' · ')
  return (
    <li>
      <button type="button" onClick={() => modal.open({ kind: 'book', id: b.id })}
        className="flex min-h-[44px] w-full gap-3 rounded-row p-2 text-left hover:bg-surface-hover press-feedback">
        <BookCover book={b} className="w-14 shrink-0 self-start" />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <Truncate as="span" className="text-ui text-fg">{b.title}</Truncate>
          {b.author && <Truncate as="span" className="text-meta text-fg-muted">{b.author}</Truncate>}
          <span className="mt-1 flex items-center gap-2">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <span className="block h-full rounded-full bg-accent-500" style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%` }} />
            </span>
            <span className="w-11 text-right text-meta font-semibold tabular-nums text-fg">{pct != null ? `${Math.round(pct)}%` : '—'}</span>
          </span>
          {r.page != null && (
            <span className="text-meta tabular-nums text-fg-muted">Page {r.page}{r.pageTotal ? ` of ${r.pageTotal}` : ''}</span>
          )}
          {facts && <span className="text-meta tabular-nums text-fg-muted">{facts}</span>}
          <span className="text-meta tabular-nums text-fg-muted">
            {r.lastAt ? `Last read ${relativeDay(localDay(new Date(r.lastAt)), today)} · ${formatDate(r.lastAt)}` : 'Not opened yet'}
          </span>
          {r.etaSeconds != null && (
            <span className="text-meta font-medium tabular-nums text-fg">About {formatDuration(r.etaSeconds)} to finish</span>
          )}
        </span>
      </button>
    </li>
  )
}
