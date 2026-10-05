import { useMemo, useState } from 'react'
import { BookOpen, Newspaper } from 'lucide-react'
import { Button, Card, CardHeader, Truncate } from '../../../../shared/ui'
import { useEntityModal } from '../../../../shared/modals'
import { formatDuration, windowBooks, type WindowBook } from '../../readingAggregate'
import type { Book, ReadingEvent } from '../../types'
import { BookCover } from '../BookCover'
import { PAGES_NOTE } from './statsFormat'

const FIRST = 8

/** Per book in the chart's window, by time; news issues summed into one row of their own. */
export function WindowBooksCard({ events, byId, days }: { events: readonly ReadingEvent[]; byId: Map<string, Book>; days: number }) {
  const [all, setAll] = useState(false)
  const { books, news } = useMemo(() => windowBooks(events, id => byId.get(id)?.kind === 'news'), [events, byId])
  const shown = all ? books : books.slice(0, FIRST)
  return (
    <Card>
      <CardHeader title="Books in this window" variant="label" icon={<BookOpen />} subtitle={`Last ${days} days · by time`} />
      {books.length === 0 && !news ? (
        <p className="text-meta text-fg-muted">Nothing read in the last {days} days. Pick a longer window on the chart, or read on the Kobo and let it sync.</p>
      ) : (
        <div className="flex flex-col gap-1">
          <ul className="flex flex-col">
            {shown.map(r => <WindowRow key={r.bookId} row={r} book={byId.get(r.bookId)} />)}
          </ul>
          {books.length > FIRST && (
            <Button size="sm" variant="ghost" className="self-start" onClick={() => setAll(v => !v)}>
              {all ? 'Show fewer' : `Show all ${books.length}`}
            </Button>
          )}
          {news && (
            <div className="flex min-h-[44px] items-center gap-2.5 border-t border-line px-1 pt-2">
              <span className="grid w-8 shrink-0 place-items-center text-fg-muted" aria-hidden><Newspaper className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-body font-medium text-fg">News ({news.issues} {news.issues === 1 ? 'issue' : 'issues'})</span>
                <span className="block text-meta tabular-nums text-fg-muted">{news.pages} pages · {news.sessions} {news.sessions === 1 ? 'session' : 'sessions'}</span>
              </span>
              <span className="shrink-0 text-meta font-semibold tabular-nums text-fg">{formatDuration(news.seconds)}</span>
            </div>
          )}
          <p className="mt-1 text-micro text-fg-muted">{PAGES_NOTE}</p>
        </div>
      )}
    </Card>
  )
}

function WindowRow({ row: r, book }: { row: WindowBook; book: Book | undefined }) {
  const modal = useEntityModal()
  const range = r.firstPage === r.lastPage ? `p. ${r.firstPage}` : `pp. ${r.firstPage}–${r.lastPage}`
  return (
    <li>
      <button type="button" disabled={!book} onClick={() => book && modal.open({ kind: 'book', id: book.id })}
        className="flex min-h-[44px] w-full items-center gap-2.5 rounded-row p-1 text-left hover:bg-surface-hover">
        {book && <BookCover book={book} size="sm" className="w-8 shrink-0" />}
        <span className="min-w-0 flex-1">
          <Truncate as="span" className="block text-body font-medium text-fg">{book?.title ?? 'Unknown book'}</Truncate>
          <span className="block text-meta tabular-nums text-fg-muted">
            {range} · {r.pages} pages · {r.sessions} {r.sessions === 1 ? 'session' : 'sessions'}{r.pagesPerHour ? ` · ${r.pagesPerHour} pages/h` : ''}
          </span>
        </span>
        <span className="shrink-0 text-meta font-semibold tabular-nums text-fg">{formatDuration(r.seconds)}</span>
      </button>
    </li>
  )
}
