import { BookCheck, CalendarDays, CalendarRange, Clock, FileText, Flame, Sun } from 'lucide-react'
import { StatTile } from '../../../../shared/ui'
import { formatDate, formatDateTime } from '../../../../shared/utils/dateFormat'
import {
  computeStreak, distinctPages, eventsBetween, finishedInYear, localDay, sumDays, weekStart,
} from '../../readingAggregate'
import type { Book, ReadingEvent, ReadingSettings } from '../../types'
import { tileDuration } from './statsFormat'

/** The headline tiles: today against the goal, the streak, time per calendar period, books and pages. */
export function StatsKpis({ events, perDay, books, today, lastSeenDay, lastSeen, settings }: {
  events: readonly ReadingEvent[]; perDay: Map<string, number>; books: readonly Book[]; today: string
  lastSeenDay: string | null; lastSeen: string | null; settings: ReadingSettings
}) {
  const firstDay = events.length ? localDay(new Date(events[0].started_at)) : null
  const streak = computeStreak(perDay, today, lastSeenDay, settings.streak_min_minutes, firstDay)
  const todayMin = Math.floor((perDay.get(today) ?? 0) / 60)
  const goal = settings.daily_minutes_goal
  const wk = weekStart(today), month = `${today.slice(0, 7)}-01`, yearStart = `${today.slice(0, 4)}-01-01`
  const week = tileDuration(sumDays(perDay, wk, today))
  const monthT = tileDuration(sumDays(perDay, month, today))
  const yearT = tileDuration(sumDays(perDay, yearStart, today))
  const finished = finishedInYear(books, Number(today.slice(0, 4))).length
  const pagesMonth = distinctPages(eventsBetween(events, month, today))
  const stale = !lastSeenDay || lastSeenDay < today

  return (
    <div className="@container flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3 @[40rem]:grid-cols-4 @[76rem]:grid-cols-7">
        <StatTile label="Today" icon={<Sun />} value={todayMin} unit={`/ ${goal} min`}
          tone={todayMin >= goal ? 'success' : undefined}
          hint={todayMin >= goal ? 'Goal reached' : `${goal - todayMin} min to the goal`} />
        <StatTile label="Streak" icon={<Flame />} value={streak.current} unit={streak.current === 1 ? 'day' : 'days'}
          tone={streak.current > 0 ? 'success' : undefined}
          hint={streak.atRisk ? `Read today to keep it · longest ${streak.longest}` : `Longest ${streak.longest}`} />
        <StatTile label="This week" icon={<Clock />} value={week.value} unit={week.unit} hint={`Since Mon ${formatDate(wk)}`} />
        <StatTile label="This month" icon={<CalendarDays />} value={monthT.value} unit={monthT.unit} hint={`Since ${formatDate(month)}`} />
        <StatTile label="This year" icon={<CalendarRange />} value={yearT.value} unit={yearT.unit} hint={`Since ${formatDate(yearStart)}`} />
        <StatTile label="Finished" icon={<BookCheck />} value={finished} unit={finished === 1 ? 'book' : 'books'} hint={`In ${today.slice(0, 4)}`} />
        <StatTile label="Pages" icon={<FileText />} value={pagesMonth} unit="pages" hint="This month, each page once" />
      </div>
      <p className="text-meta text-fg-muted">
        {lastSeen
          ? stale
            ? `Not heard from the Kobo since ${formatDateTime(lastSeen)} — later days show as unknown, not as zero.`
            : `Kobo synced ${formatDateTime(lastSeen)}.`
          : 'The Kobo has not synced yet.'}
      </p>
    </div>
  )
}
