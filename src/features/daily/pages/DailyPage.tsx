import { useState } from 'react'
import { addDays, format, startOfWeek, endOfWeek } from 'date-fns'
import { DayView } from '../components/DayView'
import { WeekWidget } from '../components/WeekWidget'
import { MonthWidget } from '../components/MonthWidget'

type DailyTab = 'today' | 'tomorrow' | 'week' | 'month'

const TABS: { id: DailyTab; label: string }[] = [
  { id: 'today',    label: 'Today'      },
  { id: 'tomorrow', label: 'Tomorrow'   },
  { id: 'week',     label: 'This Week'  },
  { id: 'month',    label: 'This Month' },
]

export function DailyPage() {
  const [tab, setTab] = useState<DailyTab>('today')

  return (
    <div className="max-w-screen-xl mx-auto px-6 py-6">
      {/* Tab bar */}
      <div className="flex gap-1 mb-6 bg-white border border-ink-200 p-1 rounded-xl w-fit">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors duration-150 ${
              tab === t.id
                ? 'bg-amber-500 text-white'
                : 'text-ink-500 hover:text-ink-900 hover:bg-ink-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'today'    && <TodayView />}
      {tab === 'tomorrow' && <TomorrowView />}
      {tab === 'week'     && <WeekTabView />}
      {tab === 'month'    && <MonthTabView />}
    </div>
  )
}

function TodayView() {
  const today = new Date()
  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-ink-900">{format(today, 'EEEE, MMMM d')}</h1>
        <p className="text-sm text-ink-400 mt-0.5">
          {format(today, 'yyyy')} · Week {format(today, 'w')}
        </p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5">
        <div className="flex flex-col gap-4">
          <DayView date={today} />
          <div className="card p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-400 mb-2">
              Calendar
            </p>
            <p className="text-sm text-ink-400 italic">Google Calendar integration — Phase 6</p>
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <WeekWidget />
          <MonthWidget />
        </div>
      </div>
    </div>
  )
}

function TomorrowView() {
  const tomorrow = addDays(new Date(), 1)
  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-ink-900">{format(tomorrow, 'EEEE, MMMM d')}</h1>
        <p className="text-sm text-ink-400 mt-0.5">Tomorrow</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5">
        <DayView date={tomorrow} />
        <WeekWidget />
      </div>
    </div>
  )
}

function WeekTabView() {
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
      <WeekWidget />
    </div>
  )
}

function MonthTabView() {
  const now = new Date()
  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-ink-900">{format(now, 'MMMM yyyy')}</h1>
        <p className="text-sm text-ink-400 mt-0.5">Monthly overview</p>
      </div>
      <div className="max-w-sm">
        <MonthWidget />
      </div>
    </div>
  )
}
