import { Link } from 'react-router-dom'
import { startOfWeek, isAfter, parseISO } from 'date-fns'
import { useTrainingSessions } from '../../training/hooks/useTrainingSessions'
import type { TrainingSession } from '../../training/types'

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

function formatDuration(sec: number): string {
  const m = Math.round(sec / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}

export function TrainingHomeWidget() {
  const { data: sessions = [], isLoading } = useTrainingSessions()

  const weekStart   = startOfWeek(new Date(), { weekStartsOn: 1 })
  const thisWeek    = sessions.filter(s => {
    const d = sessionDate(s)
    return d && s.completed_at && isAfter(parseISO(d), weekStart)
  })
  const lastSession = [...sessions]
    .filter(s => s.completed_at)
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))[0]

  const weekKm = thisWeek.reduce((sum, s) =>
    sum + (s.distance_meters ? s.distance_meters / 1000 : 0), 0)
  const weekMin = thisWeek.reduce((sum, s) =>
    sum + (s.duration_seconds ? s.duration_seconds / 60 : 0), 0)

  return (
    <div className="bg-white rounded-xl border border-ink-200 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-ink-400 uppercase tracking-wide">Training</h3>
        <Link to="/training" className="text-xs text-accent-600 hover:text-accent-700">Open →</Link>
      </div>

      {isLoading && <div className="text-ink-400 text-sm">Loading…</div>}

      {!isLoading && sessions.length === 0 && (
        <div className="text-ink-400 text-sm">No sessions yet — log a workout or sync Strava.</div>
      )}

      {!isLoading && sessions.length > 0 && (
        <div className="space-y-3">
          {/* This week summary */}
          <div className="flex gap-3">
            <div className="flex-1 text-center bg-ink-50 rounded-lg py-2 px-1">
              <div className="text-lg font-bold text-ink-900">{thisWeek.length}</div>
              <div className="text-[10px] text-ink-400 mt-0.5">this week</div>
            </div>
            {weekKm > 0 && (
              <div className="flex-1 text-center bg-ink-50 rounded-lg py-2 px-1">
                <div className="text-lg font-bold text-ink-900">{weekKm.toFixed(1)}</div>
                <div className="text-[10px] text-ink-400 mt-0.5">km</div>
              </div>
            )}
            {weekMin > 0 && (
              <div className="flex-1 text-center bg-ink-50 rounded-lg py-2 px-1">
                <div className="text-lg font-bold text-ink-900">{Math.round(weekMin)}</div>
                <div className="text-[10px] text-ink-400 mt-0.5">min</div>
              </div>
            )}
          </div>

          {/* Last session */}
          {lastSession && (
            <div className="flex items-center gap-2 pt-1 border-t border-ink-100">
              <span className="text-base">{TYPE_ICON[lastSession.type] ?? '💪'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink-800 truncate">{lastSession.title}</p>
                <p className="text-[10px] text-ink-400">
                  {new Date(sessionDate(lastSession) + 'T00:00:00').toLocaleDateString('en-GB', {
                    weekday: 'short', day: 'numeric', month: 'short',
                  })}
                  {lastSession.duration_seconds ? ` · ${formatDuration(lastSession.duration_seconds)}` : ''}
                </p>
              </div>
              {lastSession.source === 'strava' && (
                <span className="text-[10px] text-[#FC4C02] font-medium flex-shrink-0">Strava</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
