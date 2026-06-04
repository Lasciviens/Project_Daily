import { useState } from 'react'
import { addDays, format, startOfWeek, endOfWeek, isToday, isTomorrow, differenceInCalendarDays } from 'date-fns'
import { DayView } from '../components/DayView'
import { WeekWidget } from '../components/WeekWidget'
import { MonthWidget } from '../components/MonthWidget'
import { UpcomingReleasesBanner } from '../components/UpcomingReleasesBanner'
import { CalendarEventsCard } from '../../calendar/components/CalendarEventsCard'

type DailyTab = 'today' | 'tomorrow' | 'week' | 'month'

const TABS: { id: DailyTab; label: string }[] = [
  { id: 'today',    label: 'Today'      },
  { id: 'tomorrow', label: 'Tomorrow'   },
  { id: 'week',     label: 'This Week'  },
  { id: 'month',    label: 'This Month' },
]

export function DailyPage() {
  const [tab,      setTab]      = useState<DailyTab>('today')
  const [viewDate, setViewDate] = useState<Date>(new Date())

  function handleDayClick(date: Date) {
    setViewDate(date)
    if (isToday(date))     setTab('today')
    else if (isTomorrow(date)) setTab('tomorrow')
    else setTab('today')
  }

  function handleTabChange(t: DailyTab) {
    setTab(t)
    if (t === 'today')    setViewDate(new Date())
    if (t === 'tomorrow') setViewDate(addDays(new Date(), 1))
  }

  const isCustomDate = !isToday(viewDate) && tab === 'today' && !isTomorrow(viewDate)
  const diff = differenceInCalendarDays(viewDate, new Date())

  return (
    <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-6">
      {/* Tab bar */}
      <div className="flex gap-1 mb-6 bg-white border border-ink-200 p-1 rounded-xl w-fit">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => handleTabChange(t.id)}
            className={`px-3 sm:px-4 py-1.5 text-sm font-medium rounded-lg transition-colors duration-150 ${
              tab === t.id
                ? 'bg-accent-500 text-white'
                : 'text-ink-500 hover:text-ink-900 hover:bg-ink-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'today' && (
        <TodayView
          date={viewDate}
          isCustom={isCustomDate}
          dayDiff={diff}
          onDayClick={handleDayClick}
          onBackToToday={() => { setViewDate(new Date()); setTab('today') }}
        />
      )}
      {tab === 'tomorrow' && (
        <TomorrowView date={viewDate} onDayClick={handleDayClick} />
      )}
      {tab === 'week'  && <WeekTabView  onDayClick={handleDayClick} selectedDate={viewDate} />}
      {tab === 'month' && <MonthTabView onDayClick={handleDayClick} selectedDate={viewDate} />}
    </div>
  )
}

function TodayView({
  date, isCustom, dayDiff, onDayClick, onBackToToday,
}: {
  date: Date
  isCustom: boolean
  dayDiff: number
  onDayClick: (d: Date) => void
  onBackToToday: () => void
}) {
  const dateStr = format(date, 'yyyy-MM-dd')

  return (
    <div>
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">{format(date, 'EEEE, MMMM d')}</h1>
          <p className="text-sm text-ink-400 mt-0.5">
            {isCustom
              ? dayDiff > 0
                ? `${dayDiff} day${dayDiff !== 1 ? 's' : ''} from today`
                : `${Math.abs(dayDiff)} day${Math.abs(dayDiff) !== 1 ? 's' : ''} ago`
              : `${format(date, 'yyyy')} · Week ${format(date, 'w')}`
            }
          </p>
        </div>
        {isCustom && (
          <button
            onClick={onBackToToday}
            className="text-xs text-accent-600 hover:text-accent-700 font-medium transition-colors duration-150 mt-1"
          >
            ← Back to today
          </button>
        )}
      </div>

      <UpcomingReleasesBanner />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] xl:grid-cols-[1fr_340px] gap-5">
        <div className="flex flex-col gap-4">
          <DayView date={date} />
          <CalendarEventsCard dateStr={dateStr} />
        </div>
        <div className="flex flex-col gap-4">
          <WeekWidget onDayClick={onDayClick} highlightDate={date} />
          <MonthWidget onDayClick={onDayClick} highlightDate={date} />
        </div>
      </div>
    </div>
  )
}

function TomorrowView({ date, onDayClick }: { date: Date; onDayClick: (d: Date) => void }) {
  const dateStr = format(date, 'yyyy-MM-dd')
  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-ink-900">{format(date, 'EEEE, MMMM d')}</h1>
        <p className="text-sm text-ink-400 mt-0.5">Tomorrow</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] xl:grid-cols-[1fr_340px] gap-5">
        <div className="flex flex-col gap-4">
          <DayView date={date} />
          <CalendarEventsCard dateStr={dateStr} />
        </div>
        <WeekWidget onDayClick={onDayClick} highlightDate={date} />
      </div>
    </div>
  )
}

function WeekTabView({ onDayClick, selectedDate }: { onDayClick: (d: Date) => void; selectedDate: Date }) {
  const now   = new Date()
  const start = startOfWeek(now, { weekStartsOn: 1 })
  const end   = endOfWeek(now,   { weekStartsOn: 1 })
  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-ink-900">This Week</h1>
        <p className="text-sm text-ink-400 mt-0.5">
          {format(start, 'MMM d')} – {format(end, 'MMM d, yyyy')}
        </p>
      </div>
      <WeekWidget onDayClick={onDayClick} highlightDate={selectedDate} />
    </div>
  )
}

function MonthTabView({ onDayClick, selectedDate }: { onDayClick: (d: Date) => void; selectedDate: Date }) {
  const now = new Date()
  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-ink-900">{format(now, 'MMMM yyyy')}</h1>
        <p className="text-sm text-ink-400 mt-0.5">Monthly overview</p>
      </div>
      <div className="max-w-sm">
        <MonthWidget onDayClick={onDayClick} highlightDate={selectedDate} />
      </div>
    </div>
  )
}
