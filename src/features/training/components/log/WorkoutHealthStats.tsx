import { useMemo } from 'react'
import { HeartPulse, Watch } from 'lucide-react'
import { Skeleton, useChartColors } from '../../../../shared/ui'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { BarLineChart } from '../../../../shared/components/charts/BarLineChart'
import { formatLocalDate, localDayOf } from '../../../../shared/utils/dateUtils'
import { formatDurationSeconds } from '../../../../shared/utils/formatDuration'
import { useHealthWorkout, useHealthWorkoutSummaries } from '../../../health/hooks/useHealthExport'
import { energyKcal, heartRateRecoveryDrop, heartRateSeries, type RawWorkout } from '../../../health/workoutRaw'
import { matchHealthWorkout } from '../../workoutHealthMatch'
import { SessionStat } from './SessionStat'

const round = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null)

/** The Apple Watch side of a Hevy session: the Apple Health workout that
 *  overlaps it (workoutHealthMatch) — heart rate, energy, watch time and the
 *  heart-rate curve. The summary row paints first; the curve needs the raw
 *  payload, fetched only for the matched workout. */
export function WorkoutHealthStats({ startTime, endTime }: { startTime: string; endTime: string }) {
  const c = useChartColors()
  // A watch workout started a little before a session that began just after
  // midnight sits on the previous local day — look 30 minutes back so it is
  // still fetched (the query filters by start_time).
  const startMs = new Date(startTime).getTime()
  const fromDay = (Number.isFinite(startMs) ? formatLocalDate(new Date(startMs - 30 * 60_000)) : null) ?? ''
  const toDay = localDayOf(endTime) ?? fromDay
  const summaries = useHealthWorkoutSummaries(fromDay, toDay < fromDay ? fromDay : toDay)
  // keepPreviousData would show another day's workouts for a moment.
  const loading = summaries.isLoading || summaries.isPlaceholderData
  const match = useMemo(
    () => (loading ? null : matchHealthWorkout({ start_time: startTime, end_time: endTime }, summaries.data ?? [])),
    [loading, startTime, endTime, summaries.data],
  )
  const full = useHealthWorkout(match?.id ?? null)
  const raw = useMemo<RawWorkout>(() => (full.data?.raw && typeof full.data.raw === 'object' ? full.data.raw : {}), [full.data])
  const hr = useMemo(() => heartRateSeries(raw), [raw])
  const recovery = heartRateRecoveryDrop(raw)

  const heading = (
    <p className="section-label mb-1.5 flex items-center gap-1">
      <Watch aria-hidden className="h-3.5 w-3.5" /> Apple Watch
      <InfoBubble label="About the Apple Watch numbers">
        From the Apple Health workout recorded at the same time as this session (Hevy saves its workouts to Apple Health;
        Health Auto Export sends them here). It counts when the two overlap for most of their length.
        <span className="mt-1.5 block">
          <b>Active</b> energy is what the workout burned on top of your resting burn; <b>total</b> adds the resting burn
          over the same time. Calories and heart rate are the watch&apos;s estimates.
        </span>
      </InfoBubble>
    </p>
  )

  if (loading) {
    return (
      <section>
        {heading}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} rounded="rounded-row" className="h-[62px]" />)}
        </div>
      </section>
    )
  }
  if (summaries.isError) {
    return <section>{heading}<p className="text-meta text-fg-muted">Apple Health data couldn&apos;t be loaded.</p></section>
  }
  if (!match) {
    return <section>{heading}<p className="text-meta text-fg-muted">No Apple Watch workout was recorded during this session.</p></section>
  }

  const avg = round(match.avg_heart_rate)
  const max = round(match.max_heart_rate)
  const active = round(energyKcal(match.active_energy_kj, raw.activeEnergyBurned))
  const total = round(energyKcal(match.total_energy_kj, raw.totalEnergy))

  return (
    <section>
      {heading}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SessionStat label="Avg heart rate" value={avg ?? '—'} unit={avg != null ? 'bpm' : undefined} sub={max != null ? `max ${max} bpm` : undefined} />
        <SessionStat label="Active energy" value={active ?? '—'} unit={active != null ? 'kcal' : undefined} sub="above resting" />
        <SessionStat label="Total energy" value={total ?? '—'} unit={total != null ? 'kcal' : undefined} sub="incl. resting burn" />
        <SessionStat label="Watch time" value={match.duration_seconds != null ? formatDurationSeconds(match.duration_seconds) : '—'} sub={match.name} />
      </div>
      {hr.length > 1 && (
        <div className="mt-3">
          <p className="section-label mb-1 flex items-center gap-1"><HeartPulse aria-hidden className="h-3.5 w-3.5" /> Heart rate</p>
          <BarLineChart data={hr} dataKey="avg" rangeKey="range" color={c.series[3]} unit="bpm" tooltipLabel="Avg HR" height={150} />
          {recovery != null && recovery > 0 && (
            <p className="mt-1 text-meta text-fg-muted">Dropped {recovery} bpm in the minutes after the workout ended.</p>
          )}
        </div>
      )}
      {full.isLoading && <Skeleton rounded="rounded-row" className="mt-3 h-[150px]" />}
    </section>
  )
}
