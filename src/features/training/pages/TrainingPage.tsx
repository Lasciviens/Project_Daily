import { useState } from 'react'
import { startOfWeek, addWeeks, subWeeks, format } from 'date-fns'
import { useTrainingSessions } from '../hooks/useTrainingSessions'
import { TrainingWeekView } from '../components/TrainingWeekView'
import { SessionCard } from '../components/SessionCard'
import { LogWorkoutModal } from '../components/LogWorkoutModal'
import { StravaWidget } from '../components/StravaWidget'
import { TrainingStats } from '../components/TrainingStats'
import type { TrainingSession } from '../types'

const TYPE_ICON: Record<string, string> = {
  strength: '🏋️',
  run:      '🏃',
  cycling:  '🚴',
  walk:     '🚶',
  yoga:     '🧘',
  swim:     '🏊',
  other:    '💪',
}

export function TrainingPage() {
  const [weekStart, setWeekStart]   = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [logDate,   setLogDate]     = useState<string | null>(null)
  const [showLog,   setShowLog]     = useState(false)
  const [filterType, setFilterType] = useState<string>('all')

  const { data: sessions = [], isLoading } = useTrainingSessions()

  function sessionDate(s: TrainingSession): string {
    return s.planned_date ?? s.completed_at?.slice(0, 10) ?? ''
  }

  const sorted = [...sessions].sort((a, b) =>
    sessionDate(b).localeCompare(sessionDate(a))
  )

  const filtered = filterType === 'all'
    ? sorted
    : sorted.filter(s => s.type === filterType)

  const planned = sessions.filter(s => s.planned_date && !s.completed_at)
  const done    = sessions.filter(s => s.completed_at)

  const types = [...new Set(sessions.map(s => s.type))]

  function handleDayClick(ds: string) {
    setLogDate(ds)
    setShowLog(true)
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-ink-900">Training</h1>
          <p className="text-xs text-ink-400 mt-0.5">
            {done.length} completed · {planned.length} planned
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StravaWidget />
          <button
            onClick={() => { setLogDate(null); setShowLog(true) }}
            className="btn-primary text-sm py-1.5 px-4"
          >
            + Log workout
          </button>
        </div>
      </div>

      {/* Week view */}
      <TrainingWeekView
        sessions={sessions}
        weekStart={weekStart}
        onDayClick={handleDayClick}
        onPrevWeek={() => setWeekStart(w => subWeeks(w, 1))}
        onNextWeek={() => setWeekStart(w => addWeeks(w, 1))}
      />

      {/* Stats (collapsed by default) */}
      <TrainingStats sessions={sessions} />

      {/* Session list with type filter */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">Sessions</p>
          <div className="flex gap-1 ml-auto flex-wrap">
            <button
              onClick={() => setFilterType('all')}
              className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors duration-150 ${
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
                className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors duration-150 ${
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

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-cream-200 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-ink-400 text-sm mb-1">No sessions yet</p>
            <p className="text-ink-300 text-xs">
              Log a workout or connect Strava to sync your activities.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(s => (
              <SessionCard key={s.id} session={s} />
            ))}
          </div>
        )}
      </div>

      {showLog && (
        <LogWorkoutModal
          defaultDate={logDate ?? format(new Date(), 'yyyy-MM-dd')}
          onClose={() => setShowLog(false)}
        />
      )}
    </div>
  )
}
