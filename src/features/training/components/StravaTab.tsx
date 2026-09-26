import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStravaActivities } from '../hooks/useStravaActivities'
import { useStravaStatus } from '../hooks/useTrainingSessions'
import { formatDurationSeconds as formatDuration } from '../../../shared/utils/formatDuration'
import type { StravaActivity } from '../types.hevy'
import { Activity, Gauge, Heart, MapPin, Mountain, Timer } from 'lucide-react'
import { Card, EmptyState, Skeleton, StatTile } from '../../../shared/ui'
import { STRAVA_ORANGE, STRAVA_TYPE_LABEL } from '../stravaMeta'
import { StravaTypeIcon } from './StravaIcons'
import { fmtDateEnGB } from '../../../shared/utils/enGBDate'

type ActivityType = 'all' | 'run' | 'cycling' | 'walk' | 'swim' | 'other'

const TYPE_FILTERS: ActivityType[] = ['all', 'run', 'cycling', 'walk', 'swim', 'other']

function formatPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60)
  const s = secPerKm % 60
  return `${m}:${String(s).padStart(2, '0')}/km`
}

function formatDate(iso: string): string {
  return fmtDateEnGB(new Date(iso), { day: 'numeric', month: 'short', year: 'numeric' })
}

function ActivityCard({ activity }: { activity: StravaActivity }) {
  const stats: { icon: typeof Timer; label: string; text: string }[] = []
  if (activity.duration_seconds != null) stats.push({ icon: Timer, label: 'Duration', text: formatDuration(activity.duration_seconds) })
  if (activity.distance_meters != null) stats.push({ icon: MapPin, label: 'Distance', text: `${(activity.distance_meters / 1000).toFixed(1)} km` })
  if (activity.avg_pace_sec_per_km != null) stats.push({ icon: Gauge, label: 'Pace', text: formatPace(activity.avg_pace_sec_per_km) })
  if (activity.avg_heart_rate != null) stats.push({ icon: Heart, label: 'Average heart rate', text: `${activity.avg_heart_rate} bpm` })
  if (activity.elevation_gain_m != null && activity.elevation_gain_m > 0) stats.push({ icon: Mountain, label: 'Elevation gain', text: `${activity.elevation_gain_m} m` })

  return (
    <Card padded={false} className="flex items-start gap-3 p-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-surface-2 text-fg-2">
        <StravaTypeIcon type={activity.type} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-body font-semibold leading-snug text-fg">{activity.title}</p>
          <span className="shrink-0 text-micro font-semibold" style={{ color: STRAVA_ORANGE }}>Strava</span>
        </div>
        {activity.start_date && <p className="mt-0.5 text-meta tabular-nums text-fg-muted">{formatDate(activity.start_date)}</p>}

        {stats.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-meta tabular-nums text-fg-2">
            {stats.map(({ icon: Icon, label, text }) => (
              <span key={label} className="inline-flex items-center gap-1" title={label}>
                <Icon className="h-3.5 w-3.5 text-fg-faint" aria-label={label} />{text}
              </span>
            ))}
          </div>
        )}

        {activity.notes && <p className="mt-1.5 text-meta italic text-fg-muted">{activity.notes}</p>}
      </div>
    </Card>
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
    <div className="space-y-4">
      {/* Stats strip */}
      {activities.length > 0 && (
        <div className="grid max-w-xl grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
          <StatTile label="Activities" value={activities.length} />
          <StatTile label="Distance" value={totalDistanceKm.toFixed(1)} unit="km" />
          <StatTile label="Duration" value={formatDuration(totalDurationSec)} />
        </div>
      )}

      {/* Type filter pills */}
      <div role="tablist" aria-label="Activity type" className="scroll-x -mx-1 flex gap-1 px-1">
        {TYPE_FILTERS.map(t => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={filterType === t}
            onClick={() => setFilterType(t)}
            className="pill-tab shrink-0 gap-1.5"
          >
            {t !== 'all' && <StravaTypeIcon type={t} className="h-3.5 w-3.5" />}
            {t === 'all' ? 'All' : STRAVA_TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      {/* Activity list */}
      {isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(19rem,24rem))] items-start justify-start gap-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} rounded="rounded-card" className="h-20" />)}
        </div>
      ) : activities.length === 0 ? (
        <EmptyState
          bordered
          icon={<Activity />}
          title="No Strava activities yet"
          description={status?.connected ? 'Sync from Developer → Connections.' : 'Connect Strava in Developer → Connections.'}
          action={<Link to="/developer?tab=connections" className="text-meta font-semibold text-accent-600">Open Connections</Link>}
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(19rem,24rem))] items-start justify-start gap-2">
          {activities.map(a => (
            <ActivityCard key={a.id} activity={a} />
          ))}
        </div>
      )}
    </div>
  )
}
