import { useMemo, useState } from 'react'
import { History } from 'lucide-react'
import { Button, Card, CardHeader, Truncate } from '../../../../shared/ui'
import { useEntityModal } from '../../../../shared/modals'
import { formatTime, formatWeekdayDate } from '../../../../shared/utils/dateFormat'
import { formatDuration, relativeDay, sessionLog, type Session } from '../../readingAggregate'
import type { Book } from '../../types'
import { BookCover } from '../BookCover'
import { bookTitle } from './statsFormat'
import { NoReadingData } from './statsKit'

const STEP = 30

/** Every reading session, newest first, grouped by day: when, which book, how long, which pages. */
export function ReadingLogCard({ sessions, byId, today, empty }: {
  sessions: readonly Session[]; byId: Map<string, Book>; today: string; empty: boolean
}) {
  const [limit, setLimit] = useState(STEP)
  const groups = useMemo(() => sessionLog(sessions, limit), [sessions, limit])
  const dayLabel = (day: string) => {
    const rel = relativeDay(day, today)
    return rel === 'today' ? 'Today' : rel === 'yesterday' ? 'Yesterday' : formatWeekdayDate(day)
  }
  return (
    <Card>
      <CardHeader title="Reading log" icon={<History />} subtitle={sessions.length ? `${sessions.length} sessions synced` : undefined} />
      {empty ? <NoReadingData /> : (
        <div className="flex flex-col gap-3">
          {groups.map(g => (
            <section key={g.day} aria-label={dayLabel(g.day)}>
              <h4 className="section-label mb-1 tabular-nums">{dayLabel(g.day)}</h4>
              <ul className="flex flex-col">
                {g.sessions.map(s => <LogRow key={`${s.bookId}-${s.start}`} session={s} book={byId.get(s.bookId)} />)}
              </ul>
            </section>
          ))}
          {sessions.length > limit && (
            <Button size="sm" className="self-start" onClick={() => setLimit(l => l + STEP)}>Show more</Button>
          )}
        </div>
      )}
    </Card>
  )
}

function LogRow({ session: s, book }: { session: Session; book: Book | undefined }) {
  const modal = useEntityModal()
  const pages = s.firstPage === s.lastPage ? `p. ${s.firstPage}` : `pp. ${s.firstPage}–${s.lastPage}`
  return (
    <li>
      <button type="button" disabled={!book} onClick={() => book && modal.open({ kind: 'book', id: book.id })}
        className="flex min-h-[44px] w-full items-center gap-2.5 rounded-row px-1 py-1.5 text-left hover:bg-surface-hover">
        {book && <BookCover book={book} size="sm" className="w-7 shrink-0" />}
        <span className="min-w-0 flex-1">
          <Truncate as="span" className="block text-body font-medium text-fg">{bookTitle(book)}</Truncate>
          <span className="block text-meta tabular-nums text-fg-muted">
            {formatTime(s.start * 1000)}–{formatTime(s.end * 1000)} · {pages}
          </span>
        </span>
        <span className="shrink-0 text-meta font-semibold tabular-nums text-fg">{formatDuration(s.seconds)}</span>
      </button>
    </li>
  )
}
