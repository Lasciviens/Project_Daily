import { useState } from 'react'
import { startOfWeek, addWeeks, subWeeks, format, isToday } from 'date-fns'
import { useTrainingSessions } from '../hooks/useTrainingSessions'
import { TrainingWeekView } from '../components/TrainingWeekView'
import { SessionCard } from '../components/SessionCard'
import { LogWorkoutModal } from '../components/LogWorkoutModal'
import { StravaWidget } from '../components/StravaWidget'
import { TrainingStats } from '../components/TrainingStats'
import { ProgramsTab } from '../components/ProgramsTab'
import type { TrainingSession } from '../types'

type Tab = 'sessions' | 'programs'

const TYPE_ICON: Record<string, string> = {
  strength: '🏋️',
  run:      '🏃',
  cycling:  '🚴',
  walk:     '🚶',
  yoga:     '🧘',
  swim:     '🏊',
  other:    '💪',
}

function sessionDate(s: TrainingSession): string {
  return s.planned_date ?? s.completed_at?.slice(0, 10) ?? ''
}

function formatDayHeading(ds: string): string {
  const d = new Date(ds + 'T00:00:00')
  if (isToday(d)) return 'Today'
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
}

export function TrainingPage() {
  const [tab,         setTab]         = useState<Tab>('sessions')
  const [weekStart,   setWeekStart]   = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [showLog,     setShowLog]     = useState(false)
  const [filterType,  setFilterType]  = useState<string>('all')

  const { data: sessions = [], isLoading } = useTrainingSessions()

  const sorted = [...sessions].sort((a, b) =>
    sessionDate(b).localeCompare(sessionDate(a))
  )

  // Filter by day first, then by type
  const dayFiltered = selectedDay
    ? sorted.filter(s => sessionDate(s) === selectedDay)
    : sorted
  const displayed = filterType === 'all'
    ? dayFiltered
    : dayFiltered.filter(s => s.type === filterType)

  const types   = [...new Set(sessions.map(s => s.type))]
  const planned = sessions.filter(s => s.planned_date && !s.completed_at)
  const done    = sessions.filter(s => s.completed_at)

  function handleDayClick(ds: string) {
    setSelectedDay(prev => prev === ds ? null : ds)
  }

  function goToToday() {
    setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))
    setSelectedDay(format(new Date(), 'yyyy-MM-dd'))
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink-900">Training</h1>
          <p className="text-xs text-ink-400 mt-0.5">
            {done.length} completed · {planned.length} planned
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <StravaWidget />
          {tab === 'sessions' && (
            <button onClick={() => setShowLog(true)} className="btn-primary text-sm py-1.5 px-4">
              + Log workout
            </button>
          )}
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 mb-5 border-b border-ink-100">
        {(['sessions', 'programs'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors duration-150 border-b-2 -mb-px min-h-[44px] ${
              tab === t
                ? 'border-accent-500 text-accent-600'
                : 'border-transparent text-ink-400 hover:text-ink-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Programs tab */}
      {tab === 'programs' && <ProgramsTab />}

      {/* Sessions tab */}
      {tab === 'sessions' && (
        <>
          {/* Week calendar */}
          <TrainingWeekView
            sessions={sessions}
            weekStart={weekStart}
            selectedDay={selectedDay}
            onDayClick={handleDayClick}
            onPrevWeek={() => setWeekStart(w => subWeeks(w, 1))}
            onNextWeek={() => setWeekStart(w => addWeeks(w, 1))}
            onToday={goToToday}
          />

          {/* Stats */}
          <TrainingStats sessions={sessions} />

          {/* Sessions header + filters */}
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                {selectedDay ? formatDayHeading(selectedDay) : 'All sessions'}
              </p>
              {selectedDay && (
                <button
                  onClick={() => setSelectedDay(null)}
                  className="text-[10px] text-ink-400 hover:text-ink-600 px-2 py-0.5 rounded bg-ink-100"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Quick-add for selected day */}
              {selectedDay && (
                <button
                  onClick={() => setShowLog(true)}
                  title={`Add session for ${formatDayHeading(selectedDay)}`}
                  className="w-9 h-9 flex items-center justify-center rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-colors duration-150 text-lg font-light leading-none min-h-[44px] min-w-[44px]"
                >
                  +
                </button>
              )}
              {/* Type filter pills */}
              <div className="flex gap-1 flex-wrap">
                <button
                  onClick={() => setFilterType('all')}
                  className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors duration-150 min-h-[44px] min-w-[44px] ${
                    filterType === 'all'
                      ? 'bg-accent-500 border-accent-500 text-white'
                      : 'border-ink-200 text-ink-500 hover:border-accent-400'
                  }`}
                >
                  All
                </button>
                {types.map(t => (
                  <button
                    key={t}
                    onClick={() => setFilterType(t)}
                    className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors duration-150 min-h-[44px] min-w-[44px] ${
                      filterType === t
                        ? 'bg-accent-500 border-accent-500 text-white'
                        : 'border-ink-200 text-ink-500 hover:border-accent-400'
                    }`}
                  >
                    {TYPE_ICON[t]} {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Session list */}
          {!selectedDay ? (
            <div className="text-center py-10 border border-dashed border-ink-200 rounded-xl">
              <p className="text-ink-400 text-sm">Select a day to see sessions</p>
            </div>
          ) : isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-16 rounded-xl bg-cream-200 animate-pulse" />
              ))}
            </div>
          ) : displayed.length === 0 ? (
            <div className="text-center py-10 border border-dashed border-ink-200 rounded-xl">
              <p className="text-ink-400 text-sm mb-1">No sessions on {formatDayHeading(selectedDay)}</p>
              <p className="text-ink-300 text-xs">Tap + to log one.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {displayed.map(s => (
                <SessionCard key={s.id} session={s} />
              ))}
            </div>
          )}
        </>
      )}

      {showLog && (
        <LogWorkoutModal
          defaultDate={selectedDay ?? format(new Date(), 'yyyy-MM-dd')}
          onClose={() => setShowLog(false)}
        />
      )}
    </div>
  )
}
