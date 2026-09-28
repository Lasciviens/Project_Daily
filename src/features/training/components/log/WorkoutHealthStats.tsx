import { useMemo, type ReactNode } from 'react'
import { ChevronRight, HeartPulse } from 'lucide-react'
import { Button, Skeleton, useChartColors } from '../../../../shared/ui'
import { useEntityModal, useModalStore } from '../../../../shared/modals'
import { BarLineChart } from '../../../../shared/components/charts/BarLineChart'
import { formatDurationSeconds } from '../../../../shared/utils/formatDuration'
import { useHealthWorkout } from '../../../health/hooks/useHealthExport'
import { energyKcal, heartRateRecoveryDrop, heartRateSeries, type RawWorkout } from '../../../health/workoutRaw'
import type { HealthWorkoutSummary } from '../../../health/api/healthApi'
import { SessionStat } from './SessionStat'

/** Opens the Apple workout's own Health popup — or, when this session was
 *  opened FROM that popup (it sits right below in the stack), goes back to
 *  it, so Health ↔ Training links never pile up. */
function OpenAppleWorkout({ id }: { id: string }) {
  const modal = useEntityModal()
  const back = useModalStore(s => {
    const below = s.stack[s.stack.length - 2]?.request
    return below?.kind === 'health-workout' && below.id === id
  })
  return (
    <Button size="sm" variant="ghost" className="-ml-2 gap-0.5"
      onClick={() => (back ? modal.close() : modal.open({ kind: 'health-workout', id }))}>
      {back ? 'Back to the Apple workout' : 'Open Apple workout'}
      <ChevronRight aria-hidden className="h-4 w-4" />
    </Button>
  )
}

const round = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null)

/** The Apple Watch side of a Hevy session, inside the session popup's
 *  collapsed "Heart rate & energy" section: the matched Apple Health workout
 *  (useSessionAppleWorkout) — peak heart rate, energy, watch time and the
 *  heart-rate curve. Mounted only when opened, so the raw payload (for the
 *  curve) is fetched only then. The average heart rate sits in the stats row
 *  above, so it isn't repeated here. */
export function WorkoutHealthStats({ match, explainer }: { match: HealthWorkoutSummary; explainer?: ReactNode }) {
  const c = useChartColors()
  const full = useHealthWorkout(match.id)
  const raw = useMemo<RawWorkout>(() => (full.data?.raw && typeof full.data.raw === 'object' ? full.data.raw : {}), [full.data])
  const hr = useMemo(() => heartRateSeries(raw), [raw])
  const recovery = heartRateRecoveryDrop(raw)

  const max = round(match.max_heart_rate)
  const active = round(energyKcal(match.active_energy_kj, raw.activeEnergyBurned))
  const total = round(energyKcal(match.total_energy_kj, raw.totalEnergy))

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <SessionStat label="Max heart rate" value={max ?? '—'} unit={max != null ? 'bpm' : undefined} />
        <SessionStat label="Active energy" value={active ?? '—'} unit={active != null ? 'kcal' : undefined} sub="above resting" />
        <SessionStat label="Total energy" value={total ?? '—'} unit={total != null ? 'kcal' : undefined} sub="incl. resting burn" />
        <SessionStat label="Watch time" value={match.duration_seconds != null ? formatDurationSeconds(match.duration_seconds) : '—'} sub={match.name} />
      </div>
      {hr.length > 1 && (
        <div>
          <p className="section-label mb-1 flex items-center gap-1"><HeartPulse aria-hidden className="h-3.5 w-3.5" /> Heart rate</p>
          <BarLineChart data={hr} dataKey="avg" rangeKey="range" color={c.series[3]} unit="bpm" tooltipLabel="Avg HR" height={140} />
          {recovery != null && recovery > 0 && (
            <p className="mt-1 text-meta text-fg-muted">Dropped {recovery} bpm in the minutes after the workout ended.</p>
          )}
        </div>
      )}
      {full.isLoading && <Skeleton rounded="rounded-row" className="h-[140px]" />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <OpenAppleWorkout id={match.id} />
        {explainer}
      </div>
    </div>
  )
}
