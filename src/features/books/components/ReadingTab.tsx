import { useMemo, useState } from 'react'
import { BookOpen, CalendarDays, Clock, Flame, Target } from 'lucide-react'
import { Button, Card, CardHeader, EmptyState, PageBoard, ProgressRing, SegmentedControl, SkeletonCard, StatTile, Truncate } from '../../../shared/ui'
import { useEntityModal } from '../../../shared/modals'
import { formatDateTime } from '../../../shared/utils/dateFormat'
import { READING_BOARD } from '../booksBoard'
import { useKoboFeedState } from '../hooks/useBooks'
import { useLibrary, useReadingEvents, useReadingSettings, useSaveReadingSettings } from '../hooks/useLibrary'
import {
  addDays, byBook, computeStreak, dayRange, dayState, formatDuration, hourGrid, localDay, secondsByDay, type DayState,
} from '../readingAggregate'
import type { Book, ReadingSettings } from '../types'
import { BookCover } from './BookCover'

/** 6600 s → "1:50" (shown with the unit "h"; short enough for a phone tile). */
const hoursMinutes = (sec: number) => { const m = Math.round(sec / 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` }

const WINDOWS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
] as const
type WindowValue = typeof WINDOWS[number]['value']
/** Fetched once for the streak; the window's figures are a slice of it. */
const HISTORY_DAYS = 120

/** Reading: today against the goal, the streak, and where the time went. */
export function ReadingTab() {
  const [win, setWin] = useState<WindowValue>('30')
  const days = Number(win)
  const events = useReadingEvents(HISTORY_DAYS)
  const settings = useReadingSettings()
  const sync = useKoboFeedState()
  // News issues stay in: their minutes are reading too, shown as news.
  const { data: books = [] } = useLibrary(true, { includeNews: true })
  const s = settings.data ?? { daily_minutes_goal: 20, streak_min_minutes: 1 }

  const today = localDay(new Date())
  const lastSeenDay = sync.data?.last_seen_at ? localDay(new Date(sync.data.last_seen_at)) : null
  const all = useMemo(() => events.data ?? [], [events.data])
  const perDay = useMemo(() => secondsByDay(all), [all])
  const firstDay = useMemo(() => all.length ? localDay(new Date(all[0].started_at)) : null, [all])
  const streak = useMemo(() => computeStreak(perDay, today, lastSeenDay, s.streak_min_minutes, firstDay), [perDay, today, lastSeenDay, s.streak_min_minutes, firstDay])
  const fromDay = addDays(today, -(days - 1))
  const windowEvents = useMemo(() => all.filter(e => localDay(new Date(e.started_at)) >= fromDay), [all, fromDay])
  const byId = useMemo(() => new Map(books.map(b => [b.id, b])), [books])

  if (events.isLoading) return <SkeletonCard />
  const empty = all.length === 0

  return (
    <PageBoard layout={READING_BOARD} stackGap="gap-4" sections={{
      today: (
        <TodayCard
          todaySeconds={perDay.get(today) ?? 0} goal={s.daily_minutes_goal} streak={streak}
          weekSeconds={dayRange(addDays(today, -6), today).reduce((t, d) => t + (perDay.get(d) ?? 0), 0)}
          lastSeen={sync.data?.last_seen_at ?? null} lastSeenDay={lastSeenDay} today={today} />
      ),
      chart: (
        <Card>
          <CardHeader title="Minutes per day" variant="label" icon={<CalendarDays />} wrap
            action={<SegmentedControl size="sm" options={[...WINDOWS]} value={win} onChange={setWin} />} />
          {empty ? <NoData /> : (
            <DayBars days={dayRange(fromDay, today)} perDay={perDay} goal={s.daily_minutes_goal}
              stateOf={d => dayState(d, perDay.get(d) ?? 0, today, lastSeenDay, s.streak_min_minutes)} />
          )}
        </Card>
      ),
      books: <BooksCard rows={byBook(windowEvents)} byId={byId} days={days} />,
      hours: empty ? null : <HoursCard grid={hourGrid(windowEvents)} days={days} />,
      // Seeded from the SAVED goal only (never the placeholder), so one tap cannot overwrite it.
      goal: settings.isError
        ? <Card><CardHeader title="Goal" variant="label" icon={<Target />} /><p className="text-meta text-fg-muted">Could not load your reading goal.</p>
            <Button size="sm" className="mt-2" onClick={() => { void settings.refetch() }}>Try again</Button></Card>
        : settings.isPlaceholderData ? <SkeletonCard /> : <GoalCard key={`${s.daily_minutes_goal}-${s.streak_min_minutes}`} settings={s} />,
    }} />
  )
}

function NoData() {
  return <EmptyState icon={<BookOpen />} title="No reading synced yet"
    description="Reading time comes from KOReader on the Kobo. Install the Lasci's Board plugin and it arrives by itself whenever Wi-Fi comes on." />
}

function TodayCard({ todaySeconds, goal, streak, weekSeconds, lastSeen, lastSeenDay, today }: {
  todaySeconds: number; goal: number; streak: { current: number; longest: number; atRisk: boolean }
  weekSeconds: number; lastSeen: string | null; lastSeenDay: string | null; today: string
}) {
  const minutes = Math.floor(todaySeconds / 60)
  const stale = !lastSeenDay || lastSeenDay < today
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <ProgressRing value={goal > 0 ? minutes / goal : 0} size={88} stroke={8} color="rgb(var(--accent-500))" className="h-[96px] w-[96px]">
          <span className="text-lead font-bold leading-none tabular-nums text-fg">{minutes}</span>
          <span className="mt-0.5 text-micro text-fg-muted">of {goal} min</span>
        </ProgressRing>
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
          <StatTile label="Streak" icon={<Flame />} value={streak.current} unit={streak.current === 1 ? 'day' : 'days'}
            tone={streak.current > 0 ? 'success' : undefined}
            hint={streak.atRisk ? 'Read today to keep it' : `Longest ${streak.longest}`} />
          <StatTile label="This week" icon={<Clock />} hint="Last 7 days"
            value={weekSeconds >= 3600 ? hoursMinutes(weekSeconds) : Math.round(weekSeconds / 60)} unit={weekSeconds >= 3600 ? 'h' : 'min'} />
        </div>
      </div>
      <p className="text-meta text-fg-muted">
        {lastSeen
          ? stale
            ? `Not heard from the Kobo since ${formatDateTime(lastSeen)} — later days show as unknown, not as zero.`
            : `Kobo synced ${formatDateTime(lastSeen)}.`
          : 'The Kobo has not synced yet.'}
      </p>
    </Card>
  )
}

const BAR_TONE: Record<DayState, string> = {
  read: 'bg-accent-500',
  today: 'bg-accent-300',
  short: 'bg-accent-200',
  zero: 'bg-transparent',
  unknown: 'bg-transparent border border-dashed border-line',
}

/** One bar per day; a day the Kobo has not reported is drawn dashed (unknown), never as zero. */
function DayBars({ days, perDay, goal, stateOf }: {
  days: string[]; perDay: Map<string, number>; goal: number; stateOf: (d: string) => DayState
}) {
  const max = Math.max(goal, ...days.map(d => (perDay.get(d) ?? 0) / 60), 1)
  const total = days.reduce((t, d) => t + (perDay.get(d) ?? 0), 0)
  const readDays = days.filter(d => (perDay.get(d) ?? 0) > 0).length
  const label = (d: string) => `${d.slice(8)}.${d.slice(5, 7)}`
  return (
    <div className="flex flex-col gap-2">
      <p className="text-meta text-fg-muted">
        <span className="font-semibold text-fg">{formatDuration(total)}</span> over {readDays} {readDays === 1 ? 'day' : 'days'}
        {readDays > 0 && ` · ${formatDuration(total / readDays)} on a reading day`}
      </p>
      <div className="relative h-36" role="img" aria-label={`Minutes read per day, ${days.length} days`}>
        <div className="absolute inset-x-0 border-t border-dashed border-accent-300" style={{ bottom: `${(goal / max) * 100}%` }} aria-hidden />
        <div className="absolute inset-0 flex items-end gap-px">
          {days.map(d => {
            const min = (perDay.get(d) ?? 0) / 60
            const st = stateOf(d)
            const h = st === 'unknown' ? 100 : Math.max((min / max) * 100, min > 0 ? 3 : 0)
            return (
              <div key={d} className="flex h-full min-w-0 flex-1 items-end" title={`${label(d)}: ${st === 'unknown' ? 'not synced yet' : `${Math.round(min)} min`}`}>
                <div className={`w-full rounded-t-[3px] ${BAR_TONE[st]} ${st === 'unknown' ? 'opacity-60' : ''}`} style={{ height: `${h}%` }} />
              </div>
            )
          })}
        </div>
      </div>
      <div className="flex justify-between text-micro tabular-nums text-fg-faint">
        <span>{label(days[0])}</span>
        <span>Goal {goal} min</span>
        <span>{label(days[days.length - 1])}</span>
      </div>
    </div>
  )
}

function BooksCard({ rows, byId, days }: { rows: ReturnType<typeof byBook>; byId: Map<string, Book>; days: number }) {
  const modal = useEntityModal()
  return (
    <Card>
      <CardHeader title="Books" variant="label" icon={<BookOpen />} subtitle={`Last ${days} days`} />
      {rows.length === 0 ? <p className="text-meta text-fg-muted">Nothing read in this window.</p> : (
        <ul className="flex flex-col gap-1">
          {rows.slice(0, 8).map(r => {
            const b = byId.get(r.bookId)
            return (
              <li key={r.bookId}>
                <button type="button" disabled={!b} onClick={() => b && modal.open({ kind: 'book', id: b.id })}
                  className="flex min-h-[44px] w-full items-center gap-2.5 rounded-control p-1 text-left hover:bg-surface-hover">
                  {b && <BookCover book={b} size="sm" className="w-8 shrink-0" />}
                  <span className="min-w-0 flex-1">
                    <Truncate as="span" className="block text-body font-medium text-fg">{b?.kind === 'news' ? `News · ${b.title}` : b?.title ?? 'Unknown book'}</Truncate>
                    <span className="block text-micro tabular-nums text-fg-muted">
                      {r.pages} pages · {r.sessions} {r.sessions === 1 ? 'session' : 'sessions'}{r.pagesPerHour ? ` · ${r.pagesPerHour} pages/h` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-meta font-semibold tabular-nums text-fg">{formatDuration(r.seconds)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** When you read: weekday × hour, shaded by minutes. */
function HoursCard({ grid, days }: { grid: number[][]; days: number }) {
  const max = Math.max(...grid.flat(), 1)
  const peak = grid.flatMap((row, w) => row.map((v, h) => ({ v, w, h }))).sort((a, b) => b.v - a.v)[0]
  return (
    <Card>
      <CardHeader title="When you read" variant="label" icon={<Clock />} subtitle={`Last ${days} days`} />
      <div className="grid grid-cols-[2.25rem_repeat(24,minmax(0,1fr))] gap-[2px]" role="img"
        aria-label={peak?.v ? `Most reading on ${WEEKDAYS[peak.w]} around ${String(peak.h).padStart(2, '0')}:00` : 'No reading in this window'}>
        {grid.map((row, w) => [
          <span key={`l${w}`} className="text-micro text-fg-faint">{WEEKDAYS[w]}</span>,
          ...row.map((v, h) => (
            <span key={`${w}-${h}`} className="aspect-square rounded-[2px] bg-accent-500"
              style={{ opacity: v ? 0.15 + 0.85 * (v / max) : 0.06 }}
              title={`${WEEKDAYS[w]} ${String(h).padStart(2, '0')}:00 — ${formatDuration(v)}`} />
          )),
        ])}
      </div>
      <div className="mt-1 flex justify-between pl-9 text-micro tabular-nums text-fg-faint"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
      {peak?.v ? <p className="mt-2 text-meta text-fg-muted">Most often on {WEEKDAYS[peak.w]} around {String(peak.h).padStart(2, '0')}:00.</p> : null}
    </Card>
  )
}

function GoalCard({ settings }: { settings: ReadingSettings }) {
  const save = useSaveReadingSettings()
  const [goal, setGoal] = useState(settings.daily_minutes_goal)
  const [min, setMin] = useState(settings.streak_min_minutes)
  const changed = goal !== settings.daily_minutes_goal || min !== settings.streak_min_minutes
  return (
    <Card>
      <CardHeader title="Goal" variant="label" icon={<Target />} />
      <div className="flex flex-col gap-3">
        <Stepper label="Daily goal" unit="min" value={goal} onChange={setGoal} step={5} min={5} max={240} />
        <Stepper label="A day counts for the streak from" unit="min" value={min} onChange={setMin} step={1} min={1} max={60} />
        <p className="text-micro text-fg-muted">Keep the streak threshold low: it is a habit signal, not a target. A day the Kobo has not reported never breaks it.</p>
        <Button variant="primary" size="sm" className="self-start" disabled={!changed} loading={save.isPending}
          onClick={() => save.mutate({ daily_minutes_goal: goal, streak_min_minutes: Math.min(min, goal) })}>Save goal</Button>
      </div>
    </Card>
  )
}

function Stepper({ label, unit, value, onChange, step, min, max }: {
  label: string; unit: string; value: number; onChange: (v: number) => void; step: number; min: number; max: number
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 text-body text-fg">{label}</span>
      <button type="button" className="icon-btn-bordered" aria-label={`Less ${label.toLowerCase()}`} onClick={() => onChange(Math.max(min, value - step))}>−</button>
      <span className="w-16 text-center text-body font-semibold tabular-nums text-fg">{value} {unit}</span>
      <button type="button" className="icon-btn-bordered" aria-label={`More ${label.toLowerCase()}`} onClick={() => onChange(Math.min(max, value + step))}>+</button>
    </div>
  )
}
