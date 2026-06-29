import { useState } from 'react'
import { useStravaActivities } from '../hooks/useStravaActivities'
import { useStravaStatus } from '../hooks/useTrainingSessions'
import { StravaWidget } from './StravaWidget'
import type { StravaActivity } from '../types.hevy'

type ActivityType = 'all' | 'run' | 'cycling' | 'walk' | 'swim' | 'other'

const TYPE_FILTERS: { key: ActivityType; label: string; icon: string }[] = [
  { key: 'all',     label: 'All',     icon: ''   },
  { key: 'run',     label: 'Run',     icon: '🏃' },
  { key: 'cycling', label: 'Cycling', icon: '🚴' },
  { key: 'walk',    label: 'Walk',    icon: '🚶' },
  { key: 'swim',    label: 'Swim',    icon: '🏊' },
  { key: 'other',   label: 'Other',   icon: '💪' },
]

const TYPE_ICON: Record<string, string> = {
  run:     '🏃',
  cycling: '🚴',
  walk:    '🚶',
  swim:    '🏊',
  yoga:    '🧘',
  other:   '💪',
}

const TYPE_COLOR: Record<string, string> = {
  run:     'bg-green-50 text-green-700 border-green-100',
  cycling: 'bg-blue-50 text-blue-700 border-blue-100',
  walk:    'bg-teal-50 text-teal-700 border-teal-100',
  swim:    'bg-cyan-50 text-cyan-700 border-cyan-100',
  yoga:    'bg-pink-50 text-pink-700 border-pink-100',
  other:   'bg-ink-50 text-ink-600 border-ink-100',
}

function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60)
  const s = secPerKm % 60
  return `${m}:${String(s).padStart(2, '0')}/km`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function ActivityCard({ activity }: { activity: StravaActivity }) {
  const icon  = TYPE_ICON[activity.type]  ?? '💪'
  const color = TYPE_COLOR[activity.type] ?? 'bg-ink-50 text-ink-600 border-ink-100'

  return (
    <div className="flex items-start gap-3 p-3 rounded-xl border border-ink-100 bg-white hover:border-ink-200 hover:shadow-sm transition-shadow duration-150">
      <div className={`w-9 h-9 flex-shrink-0 rounded-lg border flex items-center justify-center text-lg ${color}`}>
        {icon}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium text-ink-800 leading-snug truncate">{activity.title}</p>
          <span className="text-[10px] text-[#FC4C02] font-medium flex-shrink-0">Strava</span>
        </div>

        {activity.start_date && (
          <p className="text-xs text-ink-400 mt-0.5">{formatDate(activity.start_date)}</p>
        )}

        <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-ink-500">
          {activity.duration_seconds != null && (
            <span>⏱ {formatDuration(activity.duration_seconds)}</span>
          )}
          {activity.distance_meters != null && (
            <span>📍 {(activity.distance_meters / 1000).toFixed(1)} km</span>
          )}
          {activity.avg_pace_sec_per_km != null && (
            <span>⚡ {formatPace(activity.avg_pace_sec_per_km)}</span>
          )}
          {activity.avg_heart_rate != null && (
            <span>❤️ {activity.avg_heart_rate} bpm</span>
          )}
          {activity.elevation_gain_m != null && activity.elevation_gain_m > 0 && (
            <span>⛰ {activity.elevation_gain_m} m</span>
          )}
        </div>

        {activity.notes && (
          <p className="mt-1.5 text-xs text-ink-400 italic">{activity.notes}</p>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="max-w-[10rem] flex-1 min-w-[7rem] p-3 rounded-xl border border-ink-100 bg-white">
      <p className="text-lg font-semibold text-ink-800 leading-none">{value}</p>
      <p className="mt-1 text-xs text-ink-400">{label}</p>
    </div>
  )
}

export function StravaTab() {
  const [filterType, setFilterType] = useState<ActivityType>('all')

  const { data: status } = useStravaStatus()
  const { data: activities = [], isLoading } = useStravaActivities({
    limit: 50,
    type: filterType === 'all' ? undefined : filterType,
  })

  const totalDistanceKm = activities.reduce((sum, a) => sum + (a.distance_meters ?? 0), 0) / 1000
  const totalDurationSec = activities.reduce((sum, a) => sum + (a.duration_seconds ?? 0), 0)

  return (
    <div className="space-y-5">
      {/* Strava connection widget */}
      <StravaWidget />

      {/* Stats strip */}
      {activities.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <StatCard label="Activities" value={String(activities.length)} />
          <StatCard label="Distance" value={`${totalDistanceKm.toFixed(1)} km`} />
          <StatCard label="Duration" value={formatDuration(totalDurationSec)} />
        </div>
      )}

      {/* Type filter pills */}
      <div className="flex gap-1.5 flex-wrap">
        {TYPE_FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilterType(f.key)}
            className={`inline-flex items-center min-h-[44px] px-3 rounded-full border text-xs font-medium transition-colors duration-150 ${
              filterType === f.key
                ? 'bg-accent-500 border-accent-500 text-white'
                : 'border-ink-200 text-ink-500 hover:border-accent-400'
            }`}
          >
            {f.icon ? `${f.icon} ` : ''}{f.label}
          </button>
        ))}
      </div>

      {/* Activity list */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-start">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-cream-200 animate-pulse" />
          ))}
        </div>
      ) : activities.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-ink-200 rounded-xl">
          <p className="text-ink-400 text-sm mb-1">No Strava activities yet</p>
          {!status?.connected && (
            <p className="text-ink-300 text-xs">Connect Strava above to sync your activities.</p>
          )}
          {status?.connected && (
            <p className="text-ink-300 text-xs">Use the Sync button above to pull your activities.</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-start">
          {activities.map(a => (
            <ActivityCard key={a.id} activity={a} />
          ))}
        </div>
      )}
    </div>
  )
}
