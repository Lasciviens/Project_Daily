import { useMemo } from 'react'
import { HeartPulse } from 'lucide-react'
import { ModalShell, type EntityModalRequest } from '../../../../shared/modals'
import { useChartColors } from '../../../../shared/ui'
import { ErrorBoundary } from '../../../../shared/components/ErrorBoundary'
import { BarLineChart } from '../../../../shared/components/charts/BarLineChart'
import { fmtDateEnGB } from '../../../../shared/utils/enGBDate'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { useHealthProfile } from '../../../training/hooks/useAthleteProfile'
import { ageOn, estimatedMaxHr } from '../../benchmarks/healthBenchmarks'
import type { HealthWorkout } from '../../api/healthApi'
import { fmtDuration } from '../healthFormat'
import { WorkoutRouteMap } from '../WorkoutRouteMap'
import {
  energyKcal, heartRateRecoveryDrop, heartRateSeries, heartRateTimeline, rawHHMM as hhmm, rawQty as qty, type RawWorkout as Raw,
} from '../../workoutRaw'
import { timeInZones, workoutRates } from '../../workoutStats'
import { HeartRateZones } from './HeartRateZones'
import { HevySessionBlock } from './HevySessionBlock'
import { WorkoutStat as Stat } from './WorkoutStat'

// ─────────────────────────────────────────────────────────────────────────────
//  One Apple Health workout (the `health-workout` popup): the rich data Health
//  Auto Export sends inside `raw` — heart-rate curve (avg + min/max band),
//  time in each heart-rate zone, GPS route, pace/speed, cadence, distance,
//  elevation, weather, HR recovery, steps — plus the Hevy session logged at the
//  same time, linked to Training. `raw` is free-form jsonb whose shape HAE
//  doesn't document, so each field is type-checked before it renders and the
//  body sits in an ErrorBoundary.
// ─────────────────────────────────────────────────────────────────────────────

function pace(avgKmh: number | null): string | null {
  if (!avgKmh || avgKmh <= 0) return null
  const t = Math.round((60 / avgKmh) * 60)
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

function Body({ workout, raw, request, onClose }: { workout: HealthWorkout; raw: Raw; request: EntityModalRequest; onClose: () => void }) {
  const c = useChartColors()
  const profileQ = useHealthProfile()
  const age = ageOn(profileQ.data, todayStr())
  const hrMax = estimatedMaxHr(age)
  const active = energyKcal(workout.active_energy_kj, raw.activeEnergyBurned)
  const total = energyKcal(workout.total_energy_kj, raw.totalEnergy)
  const distance = qty(raw.distance)
  const avgSpeed = qty(raw.avgSpeed) ?? qty(raw.speed)
  const maxSpeed = qty(raw.maxSpeed)
  const cadence = qty(raw.stepCadence)
  const elevation = qty(raw.elevationUp)
  const temp = qty(raw.temperature)
  const humidity = qty(raw.humidity)
  const intensity = qty(raw.intensity)
  const steps = Array.isArray(raw.stepCount) ? Math.round(raw.stepCount.reduce((s: number, p: unknown) => s + (qty(p) ?? 0), 0)) : null
  const paceStr = pace(avgSpeed)
  const hrSeries = useMemo(() => heartRateSeries(raw), [raw])
  const hrTimeline = useMemo(() => heartRateTimeline(raw), [raw])
  const zones = useMemo(() => {
    const end = workout.end_time ? Date.parse(workout.end_time) : null
    return timeInZones(hrTimeline, hrMax, { endMs: end })
  }, [hrTimeline, hrMax, workout.end_time])
  const recovery = heartRateRecoveryDrop(raw)
  const { kcalPerMin } = workoutRates({ activeKcal: active, appleSeconds: workout.duration_seconds })

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        <Stat label="Duration" value={fmtDuration(workout.duration_seconds)} />
        {active != null && <Stat label="Active" value={Math.round(active)} sub={kcalPerMin != null ? `kcal · ${kcalPerMin} kcal/min` : 'kcal'} />}
        {total != null && <Stat label="Energy" value={Math.round(total)} sub="kcal incl. resting" />}
        {workout.avg_heart_rate != null && <Stat label="Avg HR" value={Math.round(workout.avg_heart_rate)} sub={workout.max_heart_rate != null ? `max ${Math.round(workout.max_heart_rate)} bpm` : 'bpm'} />}
        {distance != null && <Stat label="Distance" value={distance.toFixed(2)} sub="km" />}
        {paceStr != null && <Stat label="Pace" value={paceStr} sub="min/km" />}
        {avgSpeed != null && <Stat label="Avg speed" value={avgSpeed.toFixed(1)} sub={maxSpeed != null ? `max ${maxSpeed.toFixed(1)} km/h` : 'km/h'} />}
        {cadence != null && <Stat label="Cadence" value={Math.round(cadence)} sub="spm" />}
        {steps != null && steps > 0 && <Stat label="Steps" value={steps.toLocaleString('en-GB')} />}
        {elevation != null && elevation > 0 && <Stat label="Elevation" value={Math.round(elevation)} sub="m up" />}
        {recovery != null && <Stat label="HR recovery" value={recovery} sub="bpm drop" />}
        {intensity != null && <Stat label="Intensity" value={intensity.toFixed(1)} sub="kcal/hr·kg" />}
        {temp != null && <Stat label="Weather" value={`${Math.round(temp)}°`} sub={humidity != null ? `${Math.round(humidity)}% hum` : undefined} />}
      </div>
      <ErrorBoundary label="Hevy session" action="health_workout_hevy">
        <HevySessionBlock workout={workout} request={request} onClose={onClose} />
      </ErrorBoundary>
      {/* Zones only for a workout that recorded heart rate. */}
      {hrTimeline.length > 0 && <HeartRateZones summary={zones} age={age} hrMax={hrMax} isLoading={profileQ.isLoading} />}
      {hrSeries.length > 1 && (
        <section>
          <p className="section-label mb-1 flex items-center gap-1"><HeartPulse className="h-3.5 w-3.5" aria-hidden /> Heart rate</p>
          <BarLineChart data={hrSeries} dataKey="avg" rangeKey="range" color={c.series[3]} unit="bpm" tooltipLabel="Avg HR" height={160} />
        </section>
      )}
      {Array.isArray(raw.route) && <WorkoutRouteMap route={raw.route} />}
    </div>
  )
}

export function HealthWorkoutDetail({ workout, request, onClose }: { workout: HealthWorkout; request: EntityModalRequest; onClose: () => void }) {
  const raw = useMemo<Raw>(() => (workout.raw && typeof workout.raw === 'object' ? workout.raw : {}), [workout.raw])
  const location = typeof raw.location === 'string' ? raw.location : null
  return (
    <ModalShell
      onClose={onClose}
      size="lg"
      title={workout.name}
      subtitle={<>
        {workout.start_time && fmtDateEnGB(new Date(workout.start_time), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
        {' · '}{hhmm(workout.start_time)}–{hhmm(workout.end_time)}
        {location && ` · ${location}`}
      </>}
    >
      <ErrorBoundary label="Workout details" action="health_workout_detail">
        <Body workout={workout} raw={raw} request={request} onClose={onClose} />
      </ErrorBoundary>
    </ModalShell>
  )
}
