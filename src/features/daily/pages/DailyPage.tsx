import { useState, useEffect, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { addDays, format, startOfMonth, endOfMonth, isToday, isYesterday, isTomorrow, isSameDay, differenceInCalendarDays } from 'date-fns'
import { DayView } from '../components/DayView'
import { DayAgenda } from '../components/DayAgenda'
import { WeekStrip } from '../components/WeekStrip'
import { DayQuickRail } from '../components/DayQuickRail'
import { WeekWidget } from '../components/WeekWidget'
import { MonthWidget } from '../components/MonthWidget'
import { TodaySummary } from '../components/TodaySummary'
import { TasksPanel } from '../components/TasksPanel'
import { CalendarDays } from 'lucide-react'
import { DateNav } from '../../../shared/components/DateNav'
import { Button, Card, CardHeader, PageBoard, PageContainer, PageHeader, SegmentedControl, TonePill, type SegmentedOption, Truncate, useBoardStep } from '../../../shared/ui'
import { useTasksByMonth } from '../../todo/hooks/useTodos'
import { formatLocalDate } from '../../../shared/utils/dateUtils'
import { DAY_BOARD, MONTH_BOARD, WEEK_BOARD, type DaySection, type PickerSection } from '../dailyBoards'

// ─────────────────────────────────────────────────────────────────────────────
//  DailyPage — one header: ‹ date › + context on the left, the period switcher
//  on the right (wraps under on phones). Yesterday/Today/Tomorrow are one
//  DaySection whose highlight is DERIVED from the viewed date; phones drop the
//  Yesterday/Tomorrow cells (reachable via ‹ ›) so the switcher fits.
// ─────────────────────────────────────────────────────────────────────────────

type Mode = 'day' | 'week' | 'month' | 'tasks'
type Period = 'yesterday' | 'today' | 'tomorrow' | 'week' | 'month' | 'tasks' | 'other'

const DESKTOP_PERIODS: SegmentedOption<Period>[] = [
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'today',     label: 'Today' },
  { value: 'tomorrow',  label: 'Tomorrow' },
  { value: 'week',      label: 'Week' },
  { value: 'month',     label: 'Month' },
  { value: 'tasks',     label: 'Tasks' },
]
const PHONE_PERIODS = DESKTOP_PERIODS.filter(o => o.value !== 'yesterday' && o.value !== 'tomorrow')

/** `?date=yyyy-MM-dd` (Home's week strip links here) → that local day, else null. */
function dateFromParam(raw: string | null): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const d = new Date(raw + 'T00:00:00')
  return Number.isNaN(d.getTime()) || formatLocalDate(d) !== raw ? null : d
}

export function DailyPage() {
  const [searchParams] = useSearchParams()
  const dateParam = searchParams.get('date')
  const [mode,     setMode]     = useState<Mode>('day')
  const [viewDate, setViewDate] = useState<Date>(() => dateFromParam(dateParam) ?? new Date())
  // A new ?date= while Daily is already open (render-time adjustment).
  const [seenParam, setSeenParam] = useState(dateParam)
  if (seenParam !== dateParam) {
    setSeenParam(dateParam)
    const d = dateFromParam(dateParam)
    if (d) { setViewDate(d); setMode('day') }
  }

  function handleDayClick(date: Date) {
    setViewDate(date)
    setMode('day')
  }

  const period: Period =
    mode !== 'day' ? mode
      : isYesterday(viewDate) ? 'yesterday'
      : isToday(viewDate)     ? 'today'
      : isTomorrow(viewDate)  ? 'tomorrow'
      : 'other'

  function pickPeriod(p: Period) {
    if (p === 'week' || p === 'month' || p === 'tasks') { setMode(p); return }
    const offset = p === 'yesterday' ? -1 : p === 'tomorrow' ? 1 : 0
    setViewDate(addDays(new Date(), offset))
    setMode('day')
  }

  const diff = differenceInCalendarDays(viewDate, new Date())
  const { greeting, timeStr } = useGreeting()

  const context = mode !== 'day' ? null
    : isToday(viewDate) ? `${greeting} · ${timeStr}`
    : period === 'yesterday' ? 'Yesterday'
    : period === 'tomorrow'  ? 'Tomorrow'
    : diff > 0 ? `In ${diff} day${diff !== 1 ? 's' : ''}`
    : `${Math.abs(diff)} day${Math.abs(diff) !== 1 ? 's' : ''} ago`

  return (
    <PageContainer>
      <PageHeader
        showTitle
        className="!mb-4"
        title={
          <DateNav
            size="md"
            label={format(viewDate, 'EEE d MMM')}
            labelClassName="min-w-[120px] text-head font-bold tracking-tight text-fg sm:text-page"
            onPrev={() => { setViewDate(d => addDays(d, -1)); setMode('day') }}
            onNext={() => { setViewDate(d => addDays(d,  1)); setMode('day') }}
            onToday={() => { setViewDate(new Date()); setMode('day') }}
            isToday={mode === 'day' && isToday(viewDate)}
          />
        }
        subtitle={context ? <span className="pl-1 tabular-nums">{context}</span> : undefined}
        actions={
          <>
            <div className="w-full sm:hidden">
              <SegmentedControl fullWidth options={PHONE_PERIODS} value={period} onChange={pickPeriod} />
            </div>
            <div className="hidden max-w-full overflow-x-auto scrollbar-none sm:block">
              <SegmentedControl options={DESKTOP_PERIODS} value={period} onChange={pickPeriod} />
            </div>
          </>
        }
      />

      {mode === 'day' && <DaySection date={viewDate} onDayClick={handleDayClick} onOpenTasks={() => setMode('tasks')} />}
      {mode === 'week' && <PickerSection kind="week" onDayClick={handleDayClick} selectedDate={viewDate} />}
      {mode === 'month' && <PickerSection kind="month" onDayClick={handleDayClick} selectedDate={viewDate} />}
      {mode === 'tasks' && <TasksPanel />}
    </PageContainer>
  )
}

function useGreeting() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  const h = now.getHours()
  const greeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  return { greeting, timeStr: format(now, 'HH:mm') }
}

// One unified day view: the schedule hero (week strip + Schedule + Tasks in
// one card), the quick rail and the glance board (TodaySummary), placed per
// width by Daily's PageBoard (dailyBoards.ts → DAY_BOARD). Boxes never change
// position with the day's content.
function DaySection({ date, onDayClick, onOpenTasks }: { date: Date; onDayClick: (d: Date) => void; onOpenTasks?: () => void }) {
  const sections: Record<DaySection, ReactNode> = {
    hero: <DayHero date={date} onDayClick={onDayClick} />,
    rail: <DayQuickRail date={date} onOpenTasks={onOpenTasks} />,
    glance: <TodaySummary date={date} />,
  }
  return <PageBoard sections={sections} layout={DAY_BOARD} stackGap="gap-5 sm:gap-6" />
}

// Schedule and Tasks side by side once the card itself is 48rem wide (the
// Tasks pane keeps at least 20rem); stacked below that.
function DayHero({ date, onDayClick }: { date: Date; onDayClick: (d: Date) => void }) {
  return (
    <Card padded={false} className="@container w-full overflow-hidden">
      <WeekStrip viewDate={date} onDayClick={onDayClick} />
      <div className="divide-y divide-line @[48rem]:grid @[48rem]:grid-cols-[minmax(0,34rem)_minmax(20rem,1fr)] @[48rem]:divide-x @[48rem]:divide-y-0">
        <DayAgenda date={date} bare />
        <DayView date={date} />
      </div>
    </Card>
  )
}

// Week and Month — a picker plus the picked day's editable schedule IN PLACE
// (picking a day does not navigate away; "Open day" does). With no day
// picked, the pane lists upcoming activities; on a wide page both show at
// once and the picked day defaults to today (month) or the viewed day (week).
// On a narrow page the week strip keeps its old job: a tap opens the day.
function PickerSection({ kind, onDayClick, selectedDate }: { kind: 'week' | 'month'; onDayClick: (d: Date) => void; selectedDate: Date }) {
  const [picked, setPicked] = useState<Date | null>(kind === 'month' && !isToday(selectedDate) ? selectedDate : null)
  const focus = picked ?? (kind === 'week' ? selectedDate : new Date())

  const picker = kind === 'week'
    ? <WeekPicker highlightDate={picked ?? selectedDate} onPick={setPicked} onOpenDay={onDayClick} />
    : <MonthWidget big onDayClick={setPicked} highlightDate={picked ?? undefined} />
  const pickedOrUpcoming = picked
    ? <PickedDay date={picked} onOpenDay={() => onDayClick(picked)} onShowUpcoming={() => setPicked(null)} />
    : <UpcomingActivities onPick={setPicked} />

  const sections: Record<PickerSection, ReactNode> = {
    // Month on a narrow page: calendar and pane side by side once the page is 56rem wide.
    pair: (
      <div className="grid grid-cols-1 justify-start gap-4 sm:gap-5 @[56rem]/page:grid-cols-[minmax(0,28rem)_minmax(0,32rem)]">
        {picker}
        <div className="min-w-0">{pickedOrUpcoming}</div>
      </div>
    ),
    picker,
    pickedOrUpcoming,
    picked: <PickedDay date={focus} onOpenDay={() => onDayClick(focus)} />,
    dayTasks: <Card padded={false} className="overflow-hidden"><DayView date={focus} /></Card>,
    upcoming: <UpcomingActivities onPick={setPicked} />,
  }
  return <PageBoard sections={sections} layout={kind === 'week' ? WEEK_BOARD : MONTH_BOARD} />
}

function WeekPicker({ highlightDate, onPick, onOpenDay }: { highlightDate: Date; onPick: (d: Date) => void; onOpenDay: (d: Date) => void }) {
  const inPlace = useBoardStep() >= 2
  return <WeekWidget className={inPlace ? '' : undefined} highlightDate={highlightDate} onDayClick={inPlace ? onPick : onOpenDay} />
}

// The picked day's schedule in one card (its top lines up with the cards beside it).
function PickedDay({ date, onOpenDay, onShowUpcoming }: { date: Date; onOpenDay: () => void; onShowUpcoming?: () => void }) {
  return (
    <Card padded={false} className="min-w-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-line py-1.5 pl-4 pr-2 sm:pl-5">
        <Truncate as="h2" className="min-w-0 flex-1 text-lead font-semibold text-fg">{format(date, 'EEEE d MMMM')}</Truncate>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onOpenDay}>Open day</Button>
          {onShowUpcoming && <Button variant="ghost" size="sm" onClick={onShowUpcoming}>Upcoming</Button>}
        </div>
      </div>
      <DayAgenda date={date} bare />
    </Card>
  )
}

// Upcoming dated tasks (today onward) grouped by day. Tapping a day selects
// it in the calendar (in place, no navigation).
function UpcomingActivities({ onPick }: { onPick: (d: Date) => void }) {
  const today = new Date()
  const { data: tasks = [] } = useTasksByMonth(startOfMonth(today), endOfMonth(addDays(today, 45)))
  const todayStr = formatLocalDate(today)

  const upcoming = tasks
    .filter(t => t.due_date && t.due_date >= todayStr && t.status !== 'done' && t.status !== 'cancelled')
    .sort((a, b) => (a.due_date! < b.due_date! ? -1 : a.due_date! > b.due_date! ? 1 : (a.due_time ?? '') < (b.due_time ?? '') ? -1 : 1))

  const byDay = new Map<string, typeof upcoming>()
  for (const t of upcoming) {
    const arr = byDay.get(t.due_date!) ?? []
    arr.push(t)
    byDay.set(t.due_date!, arr)
  }

  return (
    <Card>
      <CardHeader variant="label" icon={<CalendarDays />} title="Upcoming" />
      {byDay.size === 0 ? (
        <p className="py-2 text-body text-fg-muted">Nothing scheduled ahead. Tap a day in the calendar to plan it.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {[...byDay.entries()].slice(0, 14).map(([dateStr, items]) => {
            const d = new Date(dateStr + 'T00:00:00')
            return (
              <div key={dateStr}>
                <button
                  type="button"
                  onClick={() => onPick(d)}
                  className="flex min-h-[44px] items-center gap-2 text-body font-semibold text-fg-2 hover:text-accent-600"
                >
                  {format(d, 'EEE d MMM')}
                  {isSameDay(d, today) && <TonePill tone="accent">Today</TonePill>}
                </button>
                <ul className="flex flex-col gap-1 border-l-2 border-line pl-1">
                  {items.map(t => (
                    <li key={t.id} className="flex items-center gap-2 py-0.5 pl-2 text-body text-fg-2">
                      {/* The time column is always reserved so the list keeps one left edge. */}
                      <span className="w-10 shrink-0 text-meta tabular-nums text-fg-muted">{t.due_time?.slice(0, 5) ?? ''}</span>
                      <Truncate>{t.title}</Truncate>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
