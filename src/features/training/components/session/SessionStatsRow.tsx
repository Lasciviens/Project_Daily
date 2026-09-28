import type { ReactNode } from 'react'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { formatDurationBetween } from '../../../../shared/utils/formatDuration'
import { formatRpe } from '../../setFormat'
import type { WorkoutSessionStats } from '../../workoutSessionStats'

function Cell({ value, label }: { value: ReactNode; label: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-2 py-2 first:pl-3 last:pr-3">
      <span className="truncate text-ui font-semibold tabular-nums text-fg">{value}</span>
      <span className="flex min-w-0 items-center gap-1 text-micro font-medium text-fg-muted">{label}</span>
    </div>
  )
}

/**
 * What a logged session added up to, in ONE row: duration · working sets ·
 * volume · average heart rate (from the Apple Watch workout recorded at the
 * same time; the average RPE when there is none, else the exercise count).
 */
export function SessionStatsRow({ startTime, endTime, stats, avgHeartRate, heartRateLoading }: {
  startTime: string | null
  endTime: string | null
  stats: WorkoutSessionStats
  avgHeartRate: number | null
  heartRateLoading: boolean
}) {
  const fourth = avgHeartRate != null
    ? <Cell value={<>{Math.round(avgHeartRate)} <span className="text-meta font-normal text-fg-muted">bpm</span></>} label="Avg heart rate" />
    : heartRateLoading
      ? <Cell value={<span className="text-fg-faint">…</span>} label="Avg heart rate" />
      : stats.avgRpe != null
        ? <Cell value={formatRpe(stats.avgRpe)} label="Avg RPE" />
        : <Cell value={stats.exercises} label={stats.exercises === 1 ? 'Exercise' : 'Exercises'} />

  return (
    <div className="grid grid-cols-4 divide-x divide-line rounded-row bg-surface-2">
      <Cell value={formatDurationBetween(startTime, endTime)} label="Duration" />
      <Cell value={stats.workingSets} label="Working sets" />
      <Cell
        value={stats.volumeKg != null ? <>{stats.volumeKg.toLocaleString('en-GB')} <span className="text-meta font-normal text-fg-muted">kg</span></> : '—'}
        label={<>Volume <InfoBubble label="About these numbers">
          <b>Working sets</b> leave warm-ups out. <b>Volume</b> is weight × reps over the working sets of weighted
          exercises — bodyweight-only and assisted moves are left out, the same rule as the weekly volume chart. The heart rate
          comes from the Apple Watch workout recorded during the session.
        </InfoBubble></>}
      />
      {fourth}
    </div>
  )
}
