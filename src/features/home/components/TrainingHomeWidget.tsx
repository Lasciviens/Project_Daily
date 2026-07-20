import { useState } from 'react'
import { Link } from 'react-router-dom'
import { startOfWeek, isAfter, parseISO } from 'date-fns'
import { useHevyWorkouts } from '../../training/hooks/useHevyWorkouts'
import { useStravaActivities } from '../../training/hooks/useStravaActivities'
import { formatDurationSeconds as formatDuration } from '../../../shared/utils/formatDuration'
import { haptic } from '../../../shared/utils/haptics'

export function TrainingHomeWidget() {
  const { data: workouts = [], isLoading: loadingWorkouts } = useHevyWorkouts({ limit: 50 })
  const { data: stravaActivities = [], isLoading: loadingStrava } = useStravaActivities({ limit: 20 })
  const isLoading = loadingWorkouts || loadingStrava
  // Reference widget — collapsed by default on a phone (desktop always shows).
  const [collapsed, setCollapsed] = useState(true)

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })

  const weekWorkouts = workouts.filter(w =>
    w.hevy_created_at && isAfter(parseISO(w.hevy_created_at), weekStart)
  )
  const weekStrava = stravaActivities.filter(s =>
    s.start_date && isAfter(parseISO(s.start_date), weekStart)
  )

  const weekMin = weekWorkouts.reduce((sum, w) => {
    if (!w.start_time || !w.end_time) return sum
    return sum + (new Date(w.end_time).getTime() - new Date(w.start_time).getTime()) / 60000
  }, 0)

  const weekKm = weekStrava.reduce((sum, s) =>
    sum + (s.distance_meters ? s.distance_meters / 1000 : 0), 0)

  const lastWorkout = workouts[0]

  const hasData = workouts.length > 0 || stravaActivities.length > 0

  return (
    <div className="bg-cream-50 rounded-xl border border-ink-200 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center min-w-0">
          <button
            type="button"
            onClick={() => { haptic('light'); setCollapsed(c => !c) }}
            aria-label={collapsed ? 'Expand' : 'Collapse'}
            className="sm:hidden text-ink-400 hover:text-ink-700 -ml-2 min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0"
          >
            {collapsed ? '▶' : '▼'}
          </button>
          <h3 className="text-xs font-semibold text-ink-400 uppercase tracking-wide truncate">Training</h3>
        </div>
        <Link to="/training" className="text-xs text-accent-600 hover:text-accent-700">Open →</Link>
      </div>

      <div className={collapsed ? 'hidden sm:block' : undefined}>
      {isLoading && (
        <div className="flex gap-3">
          <div className="h-14 flex-1 rounded-lg bg-cream-200 animate-pulse" />
          <div className="h-14 flex-1 rounded-lg bg-cream-200 animate-pulse" />
        </div>
      )}

      {!isLoading && !hasData && (
        <div className="text-ink-400 text-sm">No data — sync Hevy or connect Strava.</div>
      )}

      {!isLoading && hasData && (
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1 text-center bg-ink-50 rounded-lg py-2 px-1">
              <div className="text-lg font-bold text-ink-900">{weekWorkouts.length + weekStrava.length}</div>
              <div className="text-[10px] text-ink-400 mt-0.5">this week</div>
            </div>
            {weekMin > 0 && (
              <div className="flex-1 text-center bg-ink-50 rounded-lg py-2 px-1">
                <div className="text-lg font-bold text-ink-900">{Math.round(weekMin)}</div>
                <div className="text-[10px] text-ink-400 mt-0.5">min</div>
              </div>
            )}
            {weekKm > 0 && (
              <div className="flex-1 text-center bg-ink-50 rounded-lg py-2 px-1">
                <div className="text-lg font-bold text-ink-900">{weekKm.toFixed(1)}</div>
                <div className="text-[10px] text-ink-400 mt-0.5">km Strava</div>
              </div>
            )}
          </div>

          {lastWorkout && (
            <div className="flex items-center gap-2 pt-1 border-t border-ink-100">
              <span className="text-base">🏋️</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink-800 truncate">{lastWorkout.title}</p>
                <p className="text-[10px] text-ink-400">
                  {new Date(lastWorkout.hevy_created_at).toLocaleDateString('en-GB', {
                    weekday: 'short', day: 'numeric', month: 'short',
                  })}
                  {lastWorkout.start_time && lastWorkout.end_time
                    ? ` · ${formatDuration((new Date(lastWorkout.end_time).getTime() - new Date(lastWorkout.start_time).getTime()) / 1000)}`
                    : ''}
                </p>
              </div>
              <span className="text-[10px] text-accent-600 font-medium flex-shrink-0">Hevy</span>
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  )
}
