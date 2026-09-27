import { HeartPulse } from 'lucide-react'
import { ModalShell } from '../../../shared/modals'
import { Skeleton, useChartColors } from '../../../shared/ui'
import { ErrorBoundary } from '../../../shared/components/ErrorBoundary'
import { BarLineChart } from '../../../shared/components/charts/BarLineChart'
import { useHealthWorkout } from '../hooks/useHealthExport'
import type { HealthWorkoutSummary } from '../api/healthApi'
import { fmtDateEnGB } from '../../../shared/utils/enGBDate'
import { fmtDuration } from './healthFormat'
import { WorkoutRouteMap } from './WorkoutRouteMap'
import { energyKcal, heartRateRecoveryDrop, heartRateSeries, rawHHMM as hhmm, rawQty as qty, type RawWorkout as Raw } from '../workoutRaw'

// ─────────────────────────────────────────────────────────────────────────────
//  HealthWorkoutDetail — the rich per-workout data Health Auto Export sends
//  inside `raw`: a per-interval heart-rate curve (avg + min/max band), GPS
//  route, pace/speed, cadence, distance, elevation, weather, HR recovery, step
//  count. The summary row renders at once; `raw` is fetched only when this
//  opens (the list no longer downloads it for every row, H-07). Everything in
//  `raw` is free-form jsonb whose shape HAE doesn't document, so each field is
//  type-checked before it renders and the body sits in an ErrorBoundary (H-23).
// ─────────────────────────────────────────────────────────────────────────────

// The raw-field readers (qty, timestamps, HR curve, recovery, energy units)
// live in ../workoutRaw so the Training session detail reads them the same way.

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex min-w-[5rem] flex-col gap-0.5 rounded-row bg-surface-2 px-3 py-2">
      <span className="section-label">{label}</span>
      <span className="text-lead font-bold leading-none tabular-nums text-fg">{value}</span>
      {sub && <span className="text-micro font-normal text-fg-muted">{sub}</span>}
    </div>
  )
}

function RawDetails({ summary, raw }: { summary: HealthWorkoutSummary; raw: Raw }) {
  const c = useChartColors()
  const active = energyKcal(summary.active_energy_kj, raw.activeEnergyBurned)
  const total = energyKcal(summary.total_energy_kj, raw.totalEnergy)
  const distance = qty(raw.distance)
  const avgSpeed = qty(raw.avgSpeed) ?? qty(raw.speed)
  const maxSpeed = qty(raw.maxSpeed)
  const cadence = qty(raw.stepCadence)
  const elevation = qty(raw.elevationUp)
  const temp = qty(raw.temperature)
  const humidity = qty(raw.humidity)
  const intensity = qty(raw.intensity)
  const steps = Array.isArray(raw.stepCount) ? Math.round(raw.stepCount.reduce((s: number, p: unknown) => s + (qty(p) ?? 0), 0)) : null
  const pace = avgSpeed && avgSpeed > 0 ? 60 / avgSpeed : null // min/km
  const paceStr = pace != null ? (() => { const t = Math.round(pace * 60); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` })() : null

  const hrSeries = heartRateSeries(raw)
  const recovery = heartRateRecoveryDrop(raw)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Stat label="Duration" value={fmtDuration(summary.duration_seconds)} />
        {total != null && <Stat label="Energy" value={`${Math.round(total)}`} sub="kcal total" />}
        {active != null && <Stat label="Active" value={`${Math.round(active)}`} sub="kcal" />}
        {summary.avg_heart_rate != null && <Stat label="Avg HR" value={`${Math.round(summary.avg_heart_rate)}`} sub={summary.max_heart_rate != null ? `max ${Math.round(summary.max_heart_rate)}` : 'bpm'} />}
        {distance != null && <Stat label="Distance" value={distance.toFixed(2)} sub="km" />}
        {paceStr != null && <Stat label="Pace" value={paceStr} sub="min/km" />}
        {avgSpeed != null && <Stat label="Avg speed" value={avgSpeed.toFixed(1)} sub={maxSpeed != null ? `max ${maxSpeed.toFixed(1)} km/h` : 'km/h'} />}
        {cadence != null && <Stat label="Cadence" value={`${Math.round(cadence)}`} sub="spm" />}
        {steps != null && steps > 0 && <Stat label="Steps" value={steps.toLocaleString('en-GB')} />}
        {elevation != null && elevation > 0 && <Stat label="Elevation" value={`${Math.round(elevation)}`} sub="m up" />}
        {recovery != null && <Stat label="HR recovery" value={`${recovery}`} sub="bpm drop" />}
        {intensity != null && <Stat label="Intensity" value={intensity.toFixed(1)} sub="kcal/hr·kg" />}
        {temp != null && <Stat label="Weather" value={`${Math.round(temp)}°`} sub={humidity != null ? `${Math.round(humidity)}% hum` : undefined} />}
      </div>
      {hrSeries.length > 1 && (
        <div>
          <p className="section-label mb-1 flex items-center gap-1"><HeartPulse className="h-3.5 w-3.5" aria-hidden /> Heart rate</p>
          <BarLineChart data={hrSeries} dataKey="avg" rangeKey="range" color={c.series[3]} unit="bpm" tooltipLabel="Avg HR" height={160} />
        </div>
      )}
      {Array.isArray(raw.route) && <WorkoutRouteMap route={raw.route} />}
    </div>
  )
}

export function HealthWorkoutDetail({ summary, onClose }: { summary: HealthWorkoutSummary; onClose: () => void }) {
  const { data: full, isLoading, isError } = useHealthWorkout(summary.id)
  const raw: Raw = full?.raw && typeof full.raw === 'object' ? full.raw : {}
  const location = typeof raw.location === 'string' ? raw.location : null
  return (
    <ModalShell
      onClose={onClose}
      size="md"
      title={summary.name}
      subtitle={<>
        {summary.start_time && fmtDateEnGB(new Date(summary.start_time), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
        {' · '}{hhmm(summary.start_time)}–{hhmm(summary.end_time)}
        {location && ` · ${location}`}
      </>}
    >
      <ErrorBoundary label="Workout details" action="health_workout_detail">
        {isLoading ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} rounded="rounded-row" className="h-14 w-24" />)}</div>
            <Skeleton rounded="rounded-row" className="h-40" />
          </div>
        ) : (
          <>
            {isError && <p className="mb-2 text-meta text-fg-muted">The detailed data couldn't be loaded; showing the summary only.</p>}
            <RawDetails summary={summary} raw={raw} />
          </>
        )}
      </ErrorBoundary>
    </ModalShell>
  )
}
