import { useMemo } from 'react'
import { Dumbbell } from 'lucide-react'
import { Button, Skeleton } from '../../../../shared/ui'
import { useEntityModal, type EntityModalRequest } from '../../../../shared/modals'
import { formatRpe, formatSet, rpeSuffix } from '../../../training/setFormat'
import { summarizeWorkout } from '../../../training/workoutSessionStats'
import type { HealthWorkoutSummary } from '../../api/healthApi'
import { isTrainingSessionRequest, trainingSessionRequest, useLinkIsBack, useMatchedHevyWorkout } from '../../hooks/useWorkoutLinks'
import { workoutRates } from '../../workoutStats'
import { fmtDuration } from '../healthFormat'
import { WorkoutStat } from './WorkoutStat'

// The Hevy session logged at the same time as this Apple workout: what was
// lifted (sets, volume, RPE, top sets), the per-minute rates, and a link into
// Training's session popup.

const TOP_SETS = 6
const STRENGTH = /strength|functional|core|cross|hiit/i

export function HevySessionBlock({ workout, request, onClose }: {
  workout: HealthWorkoutSummary
  request: EntityModalRequest
  onClose: () => void
}) {
  const modal = useEntityModal()
  const { match, detail, isLoading, isError } = useMatchedHevyWorkout(workout)
  const exercises = detail.data?.exercises
  const stats = useMemo(() => (exercises ? summarizeWorkout(exercises) : null), [exercises])
  const back = useLinkIsBack(request, r => !!match && isTrainingSessionRequest(r, match.id))

  const heading = (
    <p className="section-label mb-1.5 flex items-center gap-1">
      <Dumbbell aria-hidden className="h-3.5 w-3.5" /> Hevy session
    </p>
  )
  if (isLoading) {
    return (
      <section>
        {heading}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} rounded="rounded-row" className="h-[58px]" />)}
        </div>
      </section>
    )
  }
  if (!match) {
    // A walk or a run has no Hevy side, so only a strength-type workout says so.
    if (!STRENGTH.test(workout.name) && !isError) return null
    return (
      <section>
        {heading}
        <p className="text-meta text-fg-muted">{isError ? 'Hevy sessions couldn’t be loaded.' : 'No Hevy session matches this workout.'}</p>
      </section>
    )
  }

  const hevySeconds = match.start_time && match.end_time ? (Date.parse(match.end_time) - Date.parse(match.start_time)) / 1000 : null
  const rates = workoutRates({ workingSets: stats?.workingSets, volumeKg: stats?.volumeKg, hevySeconds })
  const open = () => { if (back) onClose(); else modal.open(trainingSessionRequest(match.id)) }

  return (
    <section className="flex flex-col gap-2">
      {heading}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-body font-semibold text-fg">
          {match.title}
          {/* The same formatter as the Apple duration above ("1h 05m"). */}
          <span className="font-normal text-fg-muted"> · {fmtDuration(hevySeconds)}</span>
        </p>
        <Button size="sm" onClick={open}>{back ? 'Back to the Training session' : 'Open in Training'}</Button>
      </div>
      {stats ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <WorkoutStat label="Working sets" value={stats.workingSets} sub={`${stats.exercises} exercise${stats.exercises === 1 ? '' : 's'}`} />
            <WorkoutStat label="Volume" value={stats.volumeKg != null ? stats.volumeKg.toLocaleString('en-GB') : '—'}
              sub={rates.kgPerMin != null ? `kg · ${rates.kgPerMin.toLocaleString('en-GB')} kg/min` : 'kg'} />
            <WorkoutStat label="Set pace" value={rates.minPerSet != null ? rates.minPerSet.toLocaleString('en-GB') : '—'}
              sub="min per set" />
            <WorkoutStat label="Avg RPE" value={stats.avgRpe != null ? formatRpe(stats.avgRpe) : '—'}
              sub={stats.avgRpe != null ? `${stats.ratedSets} of ${stats.workingSets} rated` : 'not rated'} />
          </div>
          {stats.topSets.length > 0 && (
            <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
              {stats.topSets.slice(0, TOP_SETS).map(t => (
                <li key={t.exerciseId} className="flex min-h-[32px] items-baseline justify-between gap-3 border-t border-line py-1.5 text-meta">
                  <span className="min-w-0 truncate text-fg-2">{t.title}</span>
                  <span className="shrink-0 font-medium tabular-nums text-fg">{formatSet(t.set, t.type)}{rpeSuffix(t.set.rpe)}</span>
                </li>
              ))}
            </ul>
          )}
          {stats.topSets.length > TOP_SETS && (
            <p className="text-meta text-fg-muted">+{stats.topSets.length - TOP_SETS} more exercises in Training.</p>
          )}
        </>
      ) : (
        <p className="text-meta text-fg-muted">{detail.isError ? 'The sets couldn’t be loaded.' : 'No sets were logged.'}</p>
      )}
    </section>
  )
}
