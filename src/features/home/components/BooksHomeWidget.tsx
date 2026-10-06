import { useState } from 'react'
import { BookOpen, Flame } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals'
import { EmptyState, Skeleton, Truncate, cx } from '../../../shared/ui'
import { useKoboFeedState } from '../../books/hooks/useBooks'
import { useLibrary, useReadingEvents, useReadingSettings } from '../../books/hooks/useLibrary'
import { computeStreak, localDay, secondsByDay, sortForLibrary, upNext } from '../../books/readingAggregate'
import { BookCover } from '../../books/components/BookCover'
import type { Book } from '../../books/types'
import { useWidgetState } from '../hooks/useWidgetState'
import { useTilePopup } from '../hooks/useTilePopup'
import { WidgetShell } from './WidgetShell'
import { GlanceCarousel, type GlanceScreen } from './GlanceCarousel'
import { TileDetail } from './TileDetail'

/**
 * Reading at a glance — the same numbers as Daily's Reading cell: today's
 * minutes against the goal, the streak (a day the Kobo hasn't reported yet is
 * unknown, never a zero), the book in hand and what is up next.
 */
function useReadingGlance(enabled: boolean) {
  const events = useReadingEvents(120, enabled)
  const { data: settings } = useReadingSettings()
  const { data: sync } = useKoboFeedState(enabled)
  const library = useLibrary(enabled)
  const books = library.data ?? []
  const today = localDay(new Date())
  const perDay = secondsByDay(events.data ?? [])
  const minutes = Math.floor((perDay.get(today) ?? 0) / 60)
  const goal = settings?.daily_minutes_goal ?? 20
  const lastSeenDay = sync?.last_seen_at ? localDay(new Date(sync.last_seen_at)) : null
  const first = events.data?.[0] ? localDay(new Date(events.data[0].started_at)) : null
  const streak = computeStreak(perDay, today, lastSeenDay, settings?.streak_min_minutes ?? 1, first)
  const reading = sortForLibrary(books.filter(b => b.kind !== 'news' && b.read_status === 'reading'), 'recent')
  const queue = upNext(books)
  return { isLoading: library.isLoading, books, minutes, goal, streak, reading, queue }
}

const pct = (b: Book) => Math.round(b.progress_pct ?? 0)

function ProgressBar({ value, label, className }: { value: number; label: string; className?: string }) {
  const v = Math.max(0, Math.min(1, value))
  return (
    <span role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} className={cx('block h-1.5 overflow-hidden rounded-full bg-surface-2', className)}>
      <span className="block h-full rounded-full bg-accent-500" style={{ width: `${v * 100}%` }} />
    </span>
  )
}

export function BooksHomeWidget() {
  const ws = useWidgetState('books', { mobileCollapsed: true })
  return (
    <WidgetShell title="Books" icon={<BookOpen />} ws={ws} to="/books">
      <BooksSummary enabled={!ws.collapsed} />
    </WidgetShell>
  )
}

/** The widget's body — also what the glance tile opens on a wide Home. */
function BooksSummary({ enabled }: { enabled: boolean }) {
  const r = useReadingGlance(enabled)
  const modal = useEntityModal()
  if (r.isLoading) return <div className="space-y-2">{[0, 1].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
  if (r.books.length === 0) return <EmptyState title="No books yet" description="Set up the Kobo or add a book in Books." className="py-4" />
  return (
    <div className="space-y-3">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta tabular-nums text-fg-2">
        <span><span className="font-semibold text-fg">{r.minutes}</span> of {r.goal} min today</span>
        {r.streak.current > 0 && <span className="inline-flex items-center gap-1"><Flame aria-hidden className="h-3.5 w-3.5 text-warn" />{r.streak.current}-day streak</span>}
      </p>
      {r.reading.slice(0, 3).map(b => (
        <button key={b.id} type="button" onClick={() => modal.open({ kind: 'book', id: b.id })} className="row row-interactive -mx-3 w-[calc(100%+1.5rem)] gap-3 text-left">
          <BookCover book={b} size="sm" className="w-8 shrink-0" />
          <span className="min-w-0 flex-1">
            <Truncate className="text-body font-medium text-fg">{b.title}</Truncate>
            <span className="mt-1 flex items-center gap-2">
              <ProgressBar value={pct(b) / 100} className="flex-1" label={`${b.title}: ${pct(b)}% read`} />
              <span className="text-micro tabular-nums text-fg-muted">{pct(b)}%</span>
            </span>
          </span>
        </button>
      ))}
      {r.queue[0] && (
        <p className="border-t border-line pt-2 text-meta text-fg-muted">
          Up next: <button type="button" className="font-semibold text-accent-600 underline-offset-2 hover:underline" onClick={() => modal.open({ kind: 'book', id: r.queue[0].id })}>{r.queue[0].title}</button>
        </p>
      )}
    </div>
  )
}

/** Glance tile with swipeable screens: the book in hand · today · up next. */
export function BooksTile() {
  const r = useReadingGlance(true)
  const popup = useTilePopup()
  const [open, setOpen] = useState(false)
  const current = r.reading[0]
  const screens: GlanceScreen[] = [
    {
      key: 'reading',
      name: 'Reading',
      body: (
        <div className="min-w-0 space-y-1">
          <Truncate className="text-ui font-semibold text-fg">{current ? current.title : 'Nothing in progress'}</Truncate>
          {current
            ? <span className="flex items-center gap-2"><ProgressBar value={pct(current) / 100} className="flex-1" label={`${pct(current)}% read`} /><span className="text-micro tabular-nums text-fg-muted">{pct(current)}%</span></span>
            : <Truncate className="text-meta text-fg-muted">Pick one in Books</Truncate>}
        </div>
      ),
    },
    {
      key: 'today',
      name: 'Today',
      value: <span className="flex items-baseline gap-1">{r.minutes}<span className="text-meta font-medium text-fg-muted">of {r.goal} min</span></span>,
      hint: r.streak.current > 0
        ? <span className="inline-flex items-center gap-1"><Flame aria-hidden className="h-3.5 w-3.5 text-warn" />{r.streak.current}-day streak{r.streak.atRisk ? ' · read today to keep it' : ''}</span>
        : 'No streak yet',
    },
  ]
  if (r.queue[0]) {
    screens.push({
      key: 'next',
      name: 'Up next',
      body: (
        <div className="min-w-0 space-y-1">
          <Truncate className="text-ui font-semibold text-fg">{r.queue[0].title}</Truncate>
          <Truncate className="text-meta text-fg-muted">{r.queue[0].author ?? `${r.queue.length} in your queue`}</Truncate>
        </div>
      ),
    })
  }
  return (
    <>
      <GlanceCarousel
        id="books"
        label="Books"
        icon={<BookOpen />}
        {...(popup ? { onClick: () => setOpen(true) } : { to: '/books' })}
        loading={r.isLoading}
        screens={screens}
      />
      {popup && (
        <TileDetail open={open} onClose={() => setOpen(false)} title="Books" to="/books" openLabel="Open Books">
          <BooksSummary enabled />
        </TileDetail>
      )}
    </>
  )
}
