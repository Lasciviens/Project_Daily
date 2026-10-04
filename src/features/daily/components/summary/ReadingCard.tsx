import { Link } from 'react-router-dom'
import { BookOpen, Flame } from 'lucide-react'
import { Cell, CellHeader, CellLink } from './cellKit'
import { ProgressRing, Truncate } from '../../../../shared/ui'
import { useEntityModal } from '../../../../shared/modals'
import { useKoboFeedState } from '../../../books/hooks/useBooks'
import { useLibrary, useReadingEvents, useReadingSettings } from '../../../books/hooks/useLibrary'
import { computeStreak, localDay, secondsByDay, sortForLibrary } from '../../../books/readingAggregate'
import { BookCover } from '../../../books/components/BookCover'

// Reading on the glance board: minutes on the viewed day against the goal, the
// streak, and the book in hand. A day the Kobo has not reported yet says so
// instead of showing a zero (docs/kobo/PLAN.md §5).
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
  const first = events.data?.[0] ? localDay(new Date(events.data[0].started_at)) : null
  const streak = computeStreak(perDay, today, lastSeenDay, settings?.streak_min_minutes ?? 1, first)
  const current = sortForLibrary(books.filter(b => b.read_status === 'reading'), 'recent')[0]
  const unknown = minutes === 0 && date !== today && (!lastSeenDay || date >= lastSeenDay)

  return (
    <Cell>
      <CellHeader icon={<BookOpen />} title="Reading" action={<CellLink to="/books?tab=reading">Books</CellLink>} />
      {books.length === 0 && !events.data?.length ? (
        <Link to="/books" className="flex min-h-[44px] items-center text-body text-fg-muted hover:text-accent-600">
          No books synced yet — set up the Kobo
        </Link>
      ) : (
        <div className="flex items-center gap-3">
          <ProgressRing value={goal > 0 ? minutes / goal : 0} size={56} stroke={6} color="rgb(var(--accent-500))" className="h-[60px] w-[60px] shrink-0">
            <span className="text-body font-bold leading-none tabular-nums text-fg">{unknown ? '?' : minutes}</span>
            <span className="text-micro text-fg-muted">min</span>
          </ProgressRing>
          <div className="min-w-0 flex-1">
            <p className="text-meta text-fg-muted">
              {unknown ? 'Not synced yet for this day' : `${minutes} of ${goal} min`}
            </p>
            {streak.current > 0 && (
              <p className="flex items-center gap-1 text-meta font-semibold text-fg">
                <Flame className="h-3.5 w-3.5 text-accent-600" aria-hidden />{streak.current}-day streak{streak.atRisk ? ' · read today to keep it' : ''}
              </p>
            )}
            {current && (
              <button type="button" onClick={() => modal.open({ kind: 'book', id: current.id })}
                className="mt-1 flex min-h-[44px] w-full items-center gap-2 text-left">
                <BookCover book={current} size="sm" className="w-7 shrink-0" />
                <span className="min-w-0">
                  <Truncate as="span" className="block text-meta font-semibold text-fg">{current.title}</Truncate>
                  <span className="block text-micro tabular-nums text-fg-muted">{Math.round(current.progress_pct ?? 0)}%</span>
                </span>
              </button>
            )}
          </div>
        </div>
      )}
    </Cell>
  )
}
