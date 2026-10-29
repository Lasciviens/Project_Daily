import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, Flame, Timer } from 'lucide-react'
import { Cell, CellHeader, CellLink, StatBox, StatNote, StatValue } from './cellKit'
import { Truncate } from '../../../../shared/ui'
import { useEntityModal } from '../../../../shared/modals'
import { useKoboFeedState } from '../../../books/hooks/useBooks'
import { useLibrary, useReadingEvents, useReadingSettings, useReadingStreak } from '../../../books/hooks/useLibrary'
import { currentlyReading, localDay, secondsByDay, sortForLibrary } from '../../../books/readingAggregate'
import { BookCover } from '../../../books/components/BookCover'
import { formatDateTime } from '../../../../shared/utils/dateFormat'

// Reading on the glance board, in the board's boxes: minutes on the viewed day
// against the goal, the streak, and the book in hand with the last time it was
// read (owner, 26.10.2026: "show the last time read") — Home's Books tile's
// rule (currentlyReading: page events or the Kobo's own last open), up to the
// viewed day. A day the Kobo has not reported reads "Not synced yet"
// (docs/kobo/REFERENCE.md §5).
export function ReadingCard({ date }: { date: string }) {
  const events = useReadingEvents(120)
  const { data: settings } = useReadingSettings()
  const { data: sync } = useKoboFeedState()
  const { data: books = [] } = useLibrary()
  const modal = useEntityModal()
  const goal = settings?.daily_minutes_goal ?? 20
  const perDay = secondsByDay(events.data ?? [])
  const minutes = Math.floor((perDay.get(date) ?? 0) / 60)
  const today = localDay(new Date())
  const lastSeenDay = sync?.last_seen_at ? localDay(new Date(sync.last_seen_at)) : null
  const streak = useReadingStreak(120, lastSeenDay, settings?.streak_min_minutes ?? 1)
  const current = sortForLibrary(books.filter(b => b.kind !== 'news' && b.read_status === 'reading'), 'recent')[0]
  const unknown = minutes === 0 && date !== today && (!lastSeenDay || date >= lastSeenDay)
  const lastRead = useMemo(() => {
    if (!current) return null
    const upTo = (events.data ?? []).filter(e => localDay(new Date(e.started_at)) <= date)
    const at = currentlyReading(books, upTo, date).find(c => c.bookId === current.id)?.lastAt ?? null
    if (at == null || localDay(new Date(at)) <= date) return at
    // The Kobo's own last open is after the viewed day: that day's last page event instead.
    const own = upTo.filter(e => e.book_id === current.id).map(e => Date.parse(e.started_at))
    return own.length ? Math.max(...own) : null
  }, [books, events.data, current, date])

  return (
    <Cell>
      <CellHeader icon={<BookOpen />} title="Reading" action={<CellLink to="/books?tab=stats">Books</CellLink>} />
      {books.length === 0 && !events.data?.length ? (
        <Link to="/books" className="flex min-h-[44px] items-center text-body text-fg-muted hover:text-accent-600">
          No books synced yet — set up the Kobo
        </Link>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <StatBox icon={<Timer aria-hidden />} label={date === today ? 'Today' : 'That day'}>
              <StatValue tone={!unknown && goal > 0 && minutes >= goal ? 'success' : undefined}>{unknown ? '?' : `${minutes} min`}</StatValue>
              <StatNote>{unknown ? 'Not synced yet' : `of ${goal} min`}</StatNote>
            </StatBox>
            <StatBox icon={<Flame aria-hidden />} label="Streak">
              <StatValue tone={streak.current > 0 ? 'star' : undefined}>{streak.current}</StatValue>
              <StatNote tone={streak.atRisk ? 'warn' : undefined}>{streak.atRisk ? 'read today to keep it' : streak.current === 1 ? 'day in a row' : 'days in a row'}</StatNote>
            </StatBox>
          </div>
          {current && (
            <button type="button" onClick={() => modal.open({ kind: 'book', id: current.id })}
              className="row row-interactive -mx-2 w-[calc(100%+1rem)] gap-2.5 px-2 py-1 text-left">
              <BookCover book={current} size="sm" className="w-8 shrink-0" />
              <span className="min-w-0 flex-1">
                <Truncate as="span" className="block text-body font-semibold text-fg">{current.title}</Truncate>
                <span className="block text-meta tabular-nums text-fg-muted">
                  {Math.round(current.progress_pct ?? 0)}%{lastRead != null ? ` · last read ${formatDateTime(new Date(lastRead))}` : ''}
                </span>
              </span>
            </button>
          )}
        </>
      )}
    </Cell>
  )
}
