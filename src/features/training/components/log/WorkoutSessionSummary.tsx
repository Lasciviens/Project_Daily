import { useMemo } from 'react'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { formatDurationBetween } from '../../../../shared/utils/formatDuration'
import { formatRpe, formatSet, rpeSuffix } from '../../setFormat'
import { summarizeWorkout } from '../../workoutSessionStats'
import type { HevyWorkout } from '../../types.hevy'
import { SessionStat } from './SessionStat'
import { WorkoutHealthStats } from './WorkoutHealthStats'

/** The top of a logged session's detail: what the workout added up to
 *  (duration, working sets, volume, RPE when rated), the Apple Watch numbers
 *  recorded during it, and each exercise's top set. The full set-by-set log
 *  follows below it in HevyWorkoutDetail. */
export function WorkoutSessionSummary({ workout }: { workout: HevyWorkout }) {
  const stats = useMemo(() => summarizeWorkout(workout.exercises ?? []), [workout.exercises])
  const exercisesLabel = `${stats.exercises} ${stats.exercises === 1 ? 'exercise' : 'exercises'}`

  return (
    <div className="mb-5 flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SessionStat label="Duration" value={formatDurationBetween(workout.start_time, workout.end_time)} />
        <SessionStat
          label="Working sets"
          value={stats.workingSets}
          sub={stats.warmupSets > 0 ? `${exercisesLabel} · +${stats.warmupSets} warm-up` : exercisesLabel}
        />
        <SessionStat
          label={<>Volume <InfoBubble label="About volume">Weight × reps added up over the working sets of weighted exercises. Warm-ups, bodyweight-only and assisted moves are left out — the same rule as the weekly volume chart.</InfoBubble></>}
          value={stats.volumeKg != null ? stats.volumeKg.toLocaleString('en-GB') : '—'}
          unit={stats.volumeKg != null ? 'kg' : undefined}
        />
        {stats.avgRpe != null ? (
          <SessionStat
            label="Avg RPE"
            value={formatRpe(stats.avgRpe)}
            sub={`${stats.ratedSets} of ${stats.workingSets} sets rated`}
          />
        ) : (
          <SessionStat label="Exercises" value={stats.exercises} />
        )}
      </div>

      {workout.start_time && workout.end_time && <WorkoutHealthStats startTime={workout.start_time} endTime={workout.end_time} />}

      {stats.topSets.length > 0 && (
        <section>
          <p className="section-label mb-1 flex items-center gap-1">
            Top set per exercise
            <InfoBubble label="About top sets">
              Each exercise&apos;s best working set: the heaviest (then the most reps). Bodyweight moves count the most reps,
              timed ones the longest, assisted ones the least assistance. Warm-ups don&apos;t count.
            </InfoBubble>
          </p>
          <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
            {stats.topSets.map(t => (
              <li key={t.exerciseId} className="flex min-h-[32px] items-baseline justify-between gap-3 border-t border-line py-1.5 text-meta">
                <span className="min-w-0 truncate text-fg-2">{t.title}</span>
                <span className="shrink-0 font-medium tabular-nums text-fg">{formatSet(t.set, t.type)}{rpeSuffix(t.set.rpe)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
