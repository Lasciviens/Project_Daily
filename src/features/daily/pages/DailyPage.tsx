import { useState, useEffect } from 'react'
import { addDays, format, startOfWeek, endOfWeek, isToday, isTomorrow, differenceInCalendarDays } from 'date-fns'
import { DayView } from '../components/DayView'
import { DayTimeline } from '../components/DayTimeline'
import { WeekWidget } from '../components/WeekWidget'
import { MonthWidget } from '../components/MonthWidget'
import { UpcomingReleasesBanner } from '../components/UpcomingReleasesBanner'

type DailyTab = 'yesterday' | 'today' | 'tomorrow' | 'week' | 'month'

const TABS: { id: DailyTab; label: string }[] = [
  { id: 'yesterday', label: 'Yesterday'  },
  { id: 'today',     label: 'Today'      },
  { id: 'tomorrow',  label: 'Tomorrow'   },
  { id: 'week',      label: 'This Week'  },
  { id: 'month',     label: 'This Month' },
]

export function DailyPage() {
  const [tab,      setTab]      = useState<DailyTab>('today')
  const [viewDate, setViewDate] = useState<Date>(new Date())

  function handleDayClick(date: Date) {
    setViewDate(date)
    if (isToday(date))         setTab('today')
    else if (isTomorrow(date)) setTab('tomorrow')
    else                       setTab('today')
  }

  function handleTabChange(t: DailyTab) {
    setTab(t)
    if (t === 'yesterday') setViewDate(addDays(new Date(), -1))
    if (t === 'today')     setViewDate(new Date())
    if (t === 'tomorrow')  setViewDate(addDays(new Date(), 1))
  }

  const isCustomDate = !isToday(viewDate) && tab === 'today' && !isTomorrow(viewDate)
  const diff = differenceInCalendarDays(viewDate, new Date())

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      {/* Tab bar: scrollable on mobile so 5 tabs never overflow the viewport */}
      <div className="flex gap-1 mb-6 bg-white border border-ink-200 p-1 rounded-xl overflow-x-auto scrollbar-none w-full sm:w-fit">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => handleTabChange(t.id)}
            className={`px-3 sm:px-4 min-h-[44px] flex-shrink-0 text-sm font-medium rounded-lg transition-colors duration-150 whitespace-nowrap ${
              tab === t.id
                ? 'bg-accent-500 text-white'
                : 'text-ink-500 hover:text-ink-900 hover:bg-ink-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'yesterday' && <YesterdayView date={viewDate} onDayClick={handleDayClick} />}
      {tab === 'today' && (
        <TodayView
          date={viewDate}
          isCustom={isCustomDate}
          dayDiff={diff}
          onDayClick={handleDayClick}
          onBackToToday={() => { setViewDate(new Date()); setTab('today') }}
          onPrevDay={() => setViewDate(d => addDays(d, -1))}
          onNextDay={() => setViewDate(d => addDays(d,  1))}
        />
      )}
      {tab === 'tomorrow' && <TomorrowView date={viewDate} onDayClick={handleDayClick} />}
      {tab === 'week'     && <WeekTabView  onDayClick={handleDayClick} selectedDate={viewDate} />}
      {tab === 'month'    && <MonthTabView onDayClick={handleDayClick} selectedDate={viewDate} />}
    </div>
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

// The 3-column Day/Timeline/right-rail grid — was duplicated identically
// across Yesterday/Today/Tomorrow views (Today's right rail additionally
// stacks MonthWidget below WeekWidget, passed in via rightRail).
function DayLayout({ date, rightRail }: { date: Date; rightRail: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr_300px] xl:grid-cols-[340px_1fr_320px] gap-5">
      <div className="lg:pl-1"><DayView date={date} /></div>
      <DayTimeline date={date} />
      <div className="flex flex-col gap-4">{rightRail}</div>
    </div>
  )
}

function YesterdayView({ date, onDayClick }: { date: Date; onDayClick: (d: Date) => void }) {
  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-ink-900">{format(date, 'EEEE, MMMM d')}</h1>
        <p className="text-sm text-ink-400 mt-0.5">Yesterday</p>
      </div>
      <DayLayout date={date} rightRail={<WeekWidget onDayClick={onDayClick} highlightDate={date} />} />
    </div>
  )
}


function TodayView({
  date, isCustom, dayDiff, onDayClick, onBackToToday, onPrevDay, onNextDay,
}: {
  date: Date; isCustom: boolean; dayDiff: number
  onDayClick: (d: Date) => void; onBackToToday: () => void
  onPrevDay: () => void; onNextDay: () => void
}) {
  const { greeting, timeStr } = useGreeting()

  return (
    <div>
      <div className="flex items-start justify-between gap-2 mb-5">
        <div className="flex items-center gap-2 min-w-0">
          {/* Day navigation */}
          <div className="flex items-center gap-0.5 flex-shrink-0 mt-1">
            <button
              onClick={onPrevDay}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700 hover:bg-ink-100 rounded-lg transition-colors duration-150"
            >
              ‹
            </button>
            <button
              onClick={onNextDay}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700 hover:bg-ink-100 rounded-lg transition-colors duration-150"
            >
              ›
            </button>
          </div>
          <div className="min-w-0">
            {isToday(date) && !isCustom && (
              <p className="text-xs text-accent-600 font-medium mb-0.5">
                {greeting} · {timeStr}
              </p>
            )}
            <h1 className="text-xl sm:text-2xl font-bold text-ink-900 leading-tight">{format(date, 'EEEE, MMMM d')}</h1>
            <p className="text-sm text-ink-400 mt-0.5">
              {isCustom
                ? dayDiff > 0
                  ? `${dayDiff} day${dayDiff !== 1 ? 's' : ''} from today`
                  : `${Math.abs(dayDiff)} day${Math.abs(dayDiff) !== 1 ? 's' : ''} ago`
                : `${format(date, 'yyyy')} · Week ${format(date, 'w')}`}
            </p>
          </div>
        </div>
        {isCustom && (
          <button
            onClick={onBackToToday}
            className="min-h-[44px] px-2 flex items-center text-xs text-accent-600 hover:text-accent-700 font-medium transition-colors duration-150 flex-shrink-0"
          >
            ← Today
          </button>
        )}
      </div>

      <UpcomingReleasesBanner />

      {/* Left: Tasks (indented, narrower) · Middle: Schedule · Right: date
          widgets — structurally independent column, kept in sync with the
          viewed date via highlightDate (see WeekWidget/MonthWidget). */}
      <DayLayout
        date={date}
        rightRail={<>
          <WeekWidget onDayClick={onDayClick} highlightDate={date} />
          <MonthWidget onDayClick={onDayClick} highlightDate={date} />
        </>}
      />
    </div>
  )
}

function TomorrowView({ date, onDayClick }: { date: Date; onDayClick: (d: Date) => void }) {
  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-ink-900">{format(date, 'EEEE, MMMM d')}</h1>
        <p className="text-sm text-ink-400 mt-0.5">Tomorrow</p>
      </div>
      <DayLayout date={date} rightRail={<WeekWidget onDayClick={onDayClick} highlightDate={date} />} />
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
        <p className="text-sm text-ink-400 mt-0.5">{format(start, 'MMM d')} – {format(end, 'MMM d, yyyy')}</p>
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
      <MonthWidget onDayClick={onDayClick} highlightDate={selectedDate} />
    </div>
  )
}
