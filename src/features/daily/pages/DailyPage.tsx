import { useState } from 'react'
import { addDays, format, startOfWeek, endOfWeek } from 'date-fns'

type DailyTab = 'today' | 'tomorrow' | 'week' | 'month'

const TABS: { id: DailyTab; label: string }[] = [
  { id: 'today',    label: 'Today' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'week',     label: 'This Week' },
  { id: 'month',    label: 'This Month' },
]

export function DailyPage() {
  const [tab, setTab] = useState<DailyTab>('today')

  return (
    <div className="max-w-screen-xl mx-auto px-6 py-6">
      {/* Tabs */}
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

      {/* Views */}
      {tab === 'today'    && <TodayView />}
      {tab === 'tomorrow' && <TomorrowView />}
      {tab === 'week'     && <WeekView />}
      {tab === 'month'    && <MonthView />}
    </div>
  )
}

function TodayView() {
  const today = new Date()
  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-ink-900">
          {format(today, 'EEEE, MMMM d')}
        </h1>
        <p className="text-sm text-ink-400 mt-0.5">
          {format(today, 'yyyy')} · Week {format(today, 'w')}
        </p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5">
        <div className="flex flex-col gap-4">
          <PlaceholderCard title="Tasks" hint="Tasks coming in Phase 2" />
          <PlaceholderCard title="Calendar" hint="Google Calendar coming in Phase 6" />
        </div>
        <div className="flex flex-col gap-4">
          <PlaceholderCard title="This Week" hint="Week widget — Phase 2" />
          <PlaceholderCard title={format(today, 'MMMM yyyy')} hint="Month widget — Phase 2" />
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
        <h1 className="text-2xl font-bold text-ink-900">
          {format(tomorrow, 'EEEE, MMMM d')}
        </h1>
        <p className="text-sm text-ink-400 mt-0.5">Tomorrow</p>
      </div>
      <PlaceholderCard title="Tasks" hint="Tasks coming in Phase 2" />
    </div>
  )
}

function WeekView() {
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
      <PlaceholderCard title="Week overview" hint="Weekly grid coming in Phase 2" />
    </div>
  )
}

function MonthView() {
  const now = new Date()
  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-ink-900">
          {format(now, 'MMMM yyyy')}
        </h1>
        <p className="text-sm text-ink-400 mt-0.5">Monthly overview</p>
      </div>
      <PlaceholderCard title="Monthly stats" hint="Stats coming in Phase 2" />
    </div>
  )
}

function PlaceholderCard({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="card p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-400 mb-3">
        {title}
      </p>
      <p className="text-sm text-ink-400 italic">{hint}</p>
    </div>
  )
}
