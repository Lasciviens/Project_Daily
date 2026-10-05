import { useState } from 'react'
import { Dumbbell, ChevronRight } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals'
import { Skeleton, EmptyState, Truncate, AnimatedNumber } from '../../../shared/ui'
import { formatDurationSeconds } from '../../../shared/utils/formatDuration'
import { useTrainingWeekStreak, useWeekTrainingStats } from '../hooks/useWeekTrainingStats'
import { useNextTrainingSession, useTodayStr } from '../../training/hooks/useTrainingSessions'
import { shiftDateStr } from '../../../shared/utils/dateUtils'
import { useWidgetState } from '../hooks/useWidgetState'
import { WidgetShell } from './WidgetShell'
import { GlanceTile } from './GlanceTile'
import { TileDetail } from './TileDetail'
import { useTilePopup } from '../hooks/useTilePopup'
import { formatWeekdayDate } from '../../../shared/utils/dateFormat'

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-control bg-surface-2 px-1 py-2 text-center">
      <div className="text-lead font-bold tabular-nums text-fg">{value}</div>
      <div className="mt-0.5 text-micro text-fg-muted">{label}</div>
    </div>
  )
}

const dayLabel = (iso: string) => formatWeekdayDate(iso)

/** This week's sessions (Hevy + Strava) and the last workout, which opens its detail. */
export function TrainingHomeWidget() {
  const ws = useWidgetState('training', { mobileCollapsed: true })
  return (
    <WidgetShell title="Training" icon={<Dumbbell />} ws={ws} to="/training">
      <TrainingSummary />
    </WidgetShell>
  )
}

/** The widget's body — also what the glance tile opens on a wide Home. */
function TrainingSummary() {
  const stats = useWeekTrainingStats()
  const modal = useEntityModal()
  const w = stats.lastWorkout
  const workoutSeconds = w?.start_time && w.end_time ? (new Date(w.end_time).getTime() - new Date(w.start_time).getTime()) / 1000 : null

  return (
    <>
      {stats.isLoading ? (
        <div className="flex gap-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-14 flex-1" />)}</div>
      ) : !stats.hasData ? (
        <EmptyState title="No training yet" description="Sync Hevy or connect Strava in Settings → Subscriptions." className="py-4" />
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
              onClick={() => modal.open({ kind: 'training-session', workoutId: w.id })}
              className="row row-interactive -mx-3 w-[calc(100%+1.5rem)] border-t border-line text-left"
            >
              <span className="min-w-0 flex-1">
                <Truncate className="text-body font-medium text-fg">{w.title}</Truncate>
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
    </>
  )
}

/** "Today 16:00" / "Tomorrow" / "Wed 08.10.2026 18:00". */
function nextWhen(date: string, time: string | null, today: string): string {
  const day = date === today ? 'Today' : date === shiftDateStr(today, 1) ? 'Tomorrow' : formatWeekdayDate(date)
  return time ? `${day} ${time}` : day
}

export function TrainingTile() {
  const stats = useWeekTrainingStats()
  const streak = useTrainingWeekStreak()
  const { data: next } = useNextTrainingSession()
  const today = useTodayStr()
  const popup = useTilePopup()
  const [open, setOpen] = useState(false)
  return (
    <>
      <GlanceTile
        label="Training"
        icon={<Dumbbell />}
        {...(popup ? { onClick: () => setOpen(true) } : { to: '/training' })}
        loading={stats.isLoading}
        value={<><AnimatedNumber value={stats.sessions} /><span className="ml-1 text-meta font-medium text-fg-muted">this week{streak.weeks > 1 ? ` · ${streak.weeks}${streak.capped ? '+' : ''} wk streak` : ''}</span></>}
        hint={next
          ? <span className="font-medium text-fg">Next: {next.title} · {nextWhen(next.date, next.startTime, today)}</span>
          : stats.hasData ? 'No session planned' : 'Nothing synced yet'}
      />
      {popup && (
        <TileDetail open={open} onClose={() => setOpen(false)} title="Training" to="/training" openLabel="Open Training">
          <TrainingSummary />
        </TileDetail>
      )}
    </>
  )
}
