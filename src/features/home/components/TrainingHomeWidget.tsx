import { useState } from 'react'
import { Dumbbell, ChevronRight, Flame } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals'
import { Skeleton, EmptyState, Truncate, AnimatedNumber } from '../../../shared/ui'
import { formatDurationSeconds } from '../../../shared/utils/formatDuration'
import { useTrainingWeekStreak, useWeekTrainingStats } from '../hooks/useWeekTrainingStats'
import { useNextTrainingSession, useTodayStr } from '../../training/hooks/useTrainingSessions'
import { shiftDateStr } from '../../../shared/utils/dateUtils'
import { useWidgetState } from '../hooks/useWidgetState'
import { WidgetShell } from './WidgetShell'
import { GlanceCarousel, type GlanceScreen } from './GlanceCarousel'
import { useAthleteProfile } from '../../training/hooks/useAthleteProfile'
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

/** One short line under the streak (it must fit beside the flame on a phone). */
function streakLine(weeks: number, thisWeek: number): string {
  if (weeks === 0) return 'Train to start one'
  return thisWeek > 0 ? 'Keep it burning' : `Train to hit ${weeks + 1}`
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
  const { data: profile } = useAthleteProfile()
  const today = useTodayStr()
  const popup = useTilePopup()
  const [open, setOpen] = useState(false)
  const target = profile?.training_days_per_week ?? null
  const w = stats.lastWorkout
  const workoutSeconds = w?.start_time && w.end_time ? (new Date(w.end_time).getTime() - new Date(w.start_time).getTime()) / 1000 : null

  const screens: GlanceScreen[] = [
    {
      // The first screen is the streak alone — big and motivating (owner).
      key: 'streak',
      name: 'Streak',
      body: (
        <div className="flex min-w-0 items-center gap-2.5">
          <Flame aria-hidden className={streak.weeks > 0 ? 'h-10 w-10 shrink-0 fill-warn/25 text-warn' : 'h-10 w-10 shrink-0 text-fg-faint'} strokeWidth={2.25} />
          <div className="min-w-0">
            <p className="flex items-baseline gap-1 leading-none">
              <span className="text-kpi font-bold tabular-nums text-fg"><AnimatedNumber value={streak.weeks} />{streak.capped ? '+' : ''}</span>
              <span className="text-meta font-semibold text-fg-2">{streak.weeks === 1 ? 'week' : 'weeks'}</span>
            </p>
            <Truncate className="mt-1 text-meta text-fg-muted">
              {streakLine(streak.weeks, stats.sessions)}
            </Truncate>
          </div>
        </div>
      ),
    },
    {
      key: 'next',
      name: 'Next session',
      body: (
        <div className="min-w-0 space-y-1">
          <Truncate className="text-ui font-semibold text-fg">{next ? next.title : stats.hasData ? 'No session planned' : 'Nothing synced yet'}</Truncate>
          {next && <Truncate className="text-meta tabular-nums text-fg-muted">{nextWhen(next.date, next.startTime, today)}</Truncate>}
        </div>
      ),
    },
    {
      key: 'week',
      name: 'This week',
      value: <span className="flex items-baseline gap-1"><AnimatedNumber value={stats.sessions} />{target ? <span className="text-meta font-medium text-fg-muted">of {target} sessions</span> : <span className="text-meta font-medium text-fg-muted">sessions</span>}</span>,
      hint: stats.minutes > 0 ? `${stats.minutes} min${stats.km > 0 ? ` · ${stats.km.toFixed(1)} km` : ''}` : 'Nothing logged yet this week',
    },
  ]
  if (w) {
    screens.push({
      key: 'last',
      name: 'Last workout',
      body: (
        <div className="min-w-0 space-y-1">
          <Truncate className="text-ui font-semibold text-fg">{w.title}</Truncate>
          <Truncate className="text-meta tabular-nums text-fg-muted">
            {stats.lastWorkoutAt ? dayLabel(stats.lastWorkoutAt) : ''}{workoutSeconds ? ` · ${formatDurationSeconds(workoutSeconds)}` : ''}
          </Truncate>
        </div>
      ),
    })
  }

  return (
    <>
      <GlanceCarousel
        id="training"
        label="Training"
        icon={<Dumbbell />}
        {...(popup ? { onClick: () => setOpen(true) } : { to: '/training' })}
        loading={stats.isLoading}
        screens={screens}
      />
      {popup && (
        <TileDetail open={open} onClose={() => setOpen(false)} title="Training" to="/training" openLabel="Open Training">
          <TrainingSummary />
        </TileDetail>
      )}
    </>
  )
}
