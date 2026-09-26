import { useState, useEffect } from 'react'
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
import { Button, Card, CardHeader, PageContainer, PageHeader, SegmentedControl, TonePill, type SegmentedOption } from '../../../shared/ui'
import { useTasksByMonth } from '../../todo/hooks/useTodos'
import { formatLocalDate } from '../../../shared/utils/dateUtils'

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

export function DailyPage() {
  const [mode,     setMode]     = useState<Mode>('day')
  const [viewDate, setViewDate] = useState<Date>(new Date())

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
      {mode === 'week' && <WeekWidget onDayClick={handleDayClick} highlightDate={viewDate} />}
      {mode === 'month' && <MonthSection onDayClick={handleDayClick} selectedDate={viewDate} />}
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

// One unified day view. TWO stacked bands; boxes never change position:
//   ROW 1 — the schedule hero (week strip + Schedule + Tasks in one card). On
//     xl+ a companion rail fills the band beside it instead of stretching the
//     timeline; below xl the hero is full width and the rail is hidden.
//   ROW 2 — the glance board (TodaySummary), explicit column steps.
function DaySection({ date, onDayClick, onOpenTasks }: { date: Date; onDayClick: (d: Date) => void; onOpenTasks?: () => void }) {
  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <div className="xl:grid xl:grid-cols-[minmax(0,60rem)_minmax(0,1fr)] xl:items-stretch xl:gap-5">
        <Card padded={false} className="w-full overflow-hidden">
          <WeekStrip viewDate={date} onDayClick={onDayClick} />
          <div className="divide-y divide-line lg:grid lg:grid-cols-[minmax(0,34rem)_minmax(0,1fr)] lg:divide-x lg:divide-y-0">
            <DayAgenda date={date} bare />
            <DayView date={date} />
          </div>
        </Card>

        <DayQuickRail date={date} onOpenTasks={onOpenTasks} />
      </div>

      <TodaySummary date={date} />
    </div>
  )
}

// Month view — a bigger calendar and, beside it, the picked day's editable
// schedule IN PLACE (picking a day does not navigate away). With no day
// picked, the right pane lists upcoming activities.
function MonthSection({ onDayClick, selectedDate }: { onDayClick: (d: Date) => void; selectedDate: Date }) {
  const [picked, setPicked] = useState<Date | null>(isToday(selectedDate) ? null : selectedDate)

  return (
    <div className="grid grid-cols-1 justify-start gap-4 sm:gap-5 lg:grid-cols-[minmax(0,28rem)_minmax(0,32rem)]">
      <MonthWidget big onDayClick={setPicked} highlightDate={picked ?? undefined} />
      <div className="min-w-0">
        {picked ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="truncate text-lead font-semibold text-fg">{format(picked, 'EEEE d MMMM')}</h2>
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => onDayClick(picked)}>Open day</Button>
                <Button variant="ghost" size="sm" onClick={() => setPicked(null)}>Upcoming</Button>
              </div>
            </div>
            <DayAgenda date={picked} />
          </div>
        ) : (
          <UpcomingActivities onPick={setPicked} />
        )}
      </div>
    </div>
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
                      <span className="truncate">{t.title}</span>
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
