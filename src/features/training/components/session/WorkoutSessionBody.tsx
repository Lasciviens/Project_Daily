import { useMemo } from 'react'
import { ErrorBoundary } from '../../../../shared/components/ErrorBoundary'
import { summarizeWorkout } from '../../workoutSessionStats'
import { useSessionAppleWorkout } from '../../hooks/useSessionAppleWorkout'
import type { HevyWorkout } from '../../types.hevy'
import { SessionStatsRow } from './SessionStatsRow'
import { SessionExerciseRows } from './SessionExerciseRows'
import { SessionHealthSection } from './SessionHealthSection'

function Exercises({ workout, stats }: { workout: HevyWorkout; stats: ReturnType<typeof summarizeWorkout> }) {
  const exercises = workout.exercises ?? []
  if (exercises.length === 0) return <p className="text-body text-fg-muted">No exercises were logged.</p>
  return (
    <section>
      <p className="section-label mb-1">Exercises · {exercises.length}</p>
      <ErrorBoundary label="Exercises" action="training_session_exercises">
        <SessionExerciseRows exercises={exercises} topSets={stats.topSets} />
      </ErrorBoundary>
    </section>
  )
}

/** A session with a start and an end: the Apple Watch match feeds the stats
 *  row's heart rate and the collapsed "Heart rate & energy" section. */
function TimedBody({ workout, start, end }: { workout: HevyWorkout; start: string; end: string }) {
  const stats = useMemo(() => summarizeWorkout(workout.exercises ?? []), [workout.exercises])
  const apple = useSessionAppleWorkout(start, end)
  return (
    <>
      <SessionStatsRow startTime={start} endTime={end} stats={stats} avgHeartRate={apple.match?.avg_heart_rate ?? null} heartRateLoading={apple.isLoading} />
      <Exercises workout={workout} stats={stats} />
      <ErrorBoundary label="Apple Watch" action="training_session_watch">
        <SessionHealthSection match={apple.match} isLoading={apple.isLoading} isError={apple.isError} />
      </ErrorBoundary>
    </>
  )
}

function UntimedBody({ workout }: { workout: HevyWorkout }) {
  const stats = useMemo(() => summarizeWorkout(workout.exercises ?? []), [workout.exercises])
  return (
    <>
      <SessionStatsRow startTime={null} endTime={null} stats={stats} avgHeartRate={null} heartRateLoading={false} />
      <Exercises workout={workout} stats={stats} />
    </>
  )
}

/** What a logged workout added up to, its exercises (collapsed) and the Apple
 *  Watch numbers (collapsed). */
export function WorkoutSessionBody({ workout }: { workout: HevyWorkout }) {
  return workout.start_time && workout.end_time
    ? <TimedBody workout={workout} start={workout.start_time} end={workout.end_time} />
    : <UntimedBody workout={workout} />
}
