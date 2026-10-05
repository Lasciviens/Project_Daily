import { useMemo, useState } from 'react'
import { Target } from 'lucide-react'
import { Button, Card, CardHeader, PageBoard, SkeletonCard } from '../../../shared/ui'
import { STATS_BOARD } from '../booksBoard'
import { useKoboFeedState } from '../hooks/useBooks'
import { useLibrary, useReadingEvents, useReadingSettings } from '../hooks/useLibrary'
import { addDays, daysBetween, eventsBetween, localDay, secondsByDay, sessions } from '../readingAggregate'
import { CurrentlyReadingCard } from './stats/CurrentlyReadingCard'
import { FinishedBooksCard } from './stats/FinishedBooksCard'
import { GoalCard } from './stats/GoalCard'
import { HoursCard } from './stats/HoursCard'
import { MinutesChartCard } from './stats/MinutesChartCard'
import type { WindowValue } from './stats/statsFormat'
import { ReadingLogCard } from './stats/ReadingLogCard'
import { StatsKpis } from './stats/StatsKpis'
import { WindowBooksCard } from './stats/WindowBooksCard'
import { YearInBooksCard } from './stats/YearInBooksCard'

/** Fetched once: covers the 365-day window and this year; older years load on demand. */
const HISTORY_DAYS = 400

/** Stats: what you read, how much and how far — from KOReader's page events on the Kobo. */
export function StatsTab() {
  const [win, setWin] = useState<WindowValue>('30')
  const today = localDay(new Date())
  const thisYear = Number(today.slice(0, 4))
  const [year, setYear] = useState(thisYear)
  const days = Number(win)

  const events = useReadingEvents(HISTORY_DAYS)
  const yearDays = daysBetween(`${year}-01-01`, today) + 1
  const olderYear = useReadingEvents(yearDays, yearDays > HISTORY_DAYS)
  const settings = useReadingSettings()
  const sync = useKoboFeedState()
  // News issues stay in: their minutes are reading too, shown as one news row.
  const { data: books = [] } = useLibrary(true, { includeNews: true })
  const s = settings.data ?? { daily_minutes_goal: 20, streak_min_minutes: 1 }

  const lastSeenDay = sync.data?.last_seen_at ? localDay(new Date(sync.data.last_seen_at)) : null
  const all = useMemo(() => events.data ?? [], [events.data])
  const perDay = useMemo(() => secondsByDay(all), [all])
  const allSessions = useMemo(() => sessions(all), [all])
  const fromDay = addDays(today, -(days - 1))
  const windowEvents = useMemo(() => eventsBetween(all, fromDay, today), [all, fromDay, today])
  const yearEvents = yearDays > HISTORY_DAYS ? olderYear.data ?? [] : all
  const byId = useMemo(() => new Map(books.map(b => [b.id, b])), [books])

  if (events.isLoading) return <SkeletonCard />
  const empty = all.length === 0

  return (
    <PageBoard layout={STATS_BOARD} stackGap="gap-4" sections={{
      kpis: <StatsKpis events={all} perDay={perDay} books={books} today={today} lastSeenDay={lastSeenDay}
        lastSeen={sync.data?.last_seen_at ?? null} settings={s} />,
      current: <CurrentlyReadingCard books={books} events={all} today={today} />,
      chart: <MinutesChartCard win={win} onWin={setWin} perDay={perDay} today={today} lastSeenDay={lastSeenDay}
        settings={s} empty={empty} />,
      log: <ReadingLogCard sessions={allSessions} byId={byId} today={today} empty={empty} />,
      window: <WindowBooksCard events={windowEvents} byId={byId} days={days} />,
      year: <YearInBooksCard events={yearEvents} books={books} year={year} loading={yearDays > HISTORY_DAYS && olderYear.isLoading} />,
      finished: <FinishedBooksCard books={books} year={year} onYear={setYear} thisYear={thisYear} />,
      hours: empty ? null : <HoursCard events={windowEvents} days={days} />,
      // Seeded from the SAVED goal only (never the placeholder), so one tap cannot overwrite it.
      goal: settings.isError
        ? <Card><CardHeader title="Goal" variant="label" icon={<Target />} /><p className="text-meta text-fg-muted">Could not load your reading goal.</p>
            <Button size="sm" className="mt-2" onClick={() => { void settings.refetch() }}>Try again</Button></Card>
        : settings.isPlaceholderData ? <SkeletonCard /> : <GoalCard key={`${s.daily_minutes_goal}-${s.streak_min_minutes}`} settings={s} />,
    }} />
  )
}

