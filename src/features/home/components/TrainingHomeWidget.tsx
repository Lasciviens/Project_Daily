import { Dumbbell, ChevronRight } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals'
import { Skeleton, EmptyState } from '../../../shared/ui'
import { formatDurationSeconds } from '../../../shared/utils/formatDuration'
import { useWeekTrainingStats } from '../hooks/useWeekTrainingStats'
import { useWidgetState } from '../hooks/useWidgetState'
import { WidgetShell } from './WidgetShell'
import { GlanceTile } from './GlanceTile'

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-control bg-surface-2 px-1 py-2 text-center">
      <div className="text-lead font-bold tabular-nums text-fg">{value}</div>
      <div className="mt-0.5 text-micro text-fg-muted">{label}</div>
    </div>
  )
}

const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

/** This week's sessions (Hevy + Strava) and the last workout, which opens its detail. */
export function TrainingHomeWidget() {
  const ws = useWidgetState('training', { mobileCollapsed: true })
  const stats = useWeekTrainingStats()
  const modal = useEntityModal()
  const w = stats.lastWorkout
  const workoutSeconds = w?.start_time && w.end_time ? (new Date(w.end_time).getTime() - new Date(w.start_time).getTime()) / 1000 : null

  return (
    <WidgetShell title="Training" icon={<Dumbbell />} ws={ws} to="/training">
      {stats.isLoading ? (
        <div className="flex gap-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-14 flex-1" />)}</div>
      ) : !stats.hasData ? (
        <EmptyState title="No training yet" description="Sync Hevy or connect Strava in Developer → Connections." className="py-4" />
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Stat value={stats.sessions} label="this week" />
            {stats.minutes > 0 && <Stat value={stats.minutes} label="min" />}
            {stats.km > 0 && <Stat value={stats.km.toFixed(1)} label="km (Strava)" />}
          </div>
          {w && (
            <button
              type="button"
              onClick={() => modal.open({ kind: 'hevy-workout', id: w.id })}
              className="row row-interactive -mx-3 w-[calc(100%+1.5rem)] border-t border-line text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium text-fg">{w.title}</span>
                <span className="block text-meta tabular-nums text-fg-muted">
                  Last workout · {stats.lastWorkoutAt ? dayLabel(stats.lastWorkoutAt) : ''}
                  {workoutSeconds ? ` · ${formatDurationSeconds(workoutSeconds)}` : ''}
                </span>
              </span>
              <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-fg-faint" />
            </button>
          )}
        </div>
      )}
    </WidgetShell>
  )
}

export function TrainingTile() {
  const stats = useWeekTrainingStats()
  return (
    <GlanceTile
      label="Training"
      icon={<Dumbbell />}
      to="/training"
      loading={stats.isLoading}
      value={<>{stats.sessions}<span className="ml-1 text-meta font-medium text-fg-muted">this week</span></>}
      hint={stats.lastWorkout ? stats.lastWorkout.title : stats.hasData ? undefined : 'Nothing synced yet'}
    />
  )
}
