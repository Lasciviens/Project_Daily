import { useMemo } from 'react'
import { Dumbbell } from 'lucide-react'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { ErrorBoundary } from '../../../../shared/components/ErrorBoundary'
import { SkeletonText } from '../../../../shared/ui'
import { daysBetween } from '../../plan/nextSession'
import { lastTrainedByRoutine } from '../../progress-engine'
import { useRoutineSessionPlan } from '../../hooks/useRoutineSessionPlan'
import { useTrainingHistory } from '../../hooks/useTrainingProgress'
import { TrainingProgressProvider } from '../next/TrainingProgressProvider'
import { SourceNote } from '../program/SourceNote'
import type { HevyRoutine } from '../../types.hevy'
import { PlannedExerciseRows } from './PlannedExerciseRows'

function lastDoneText(last: string | null, today: string): string {
  if (!last) return 'Not trained in the last 6 months'
  const d = daysBetween(last, today)
  return d === 0 ? 'Last done today' : d === 1 ? 'Last done yesterday' : `Last done ${d} days ago`
}

function RoutineExercises({ routine, todayStr }: { routine: HevyRoutine; todayStr: string }) {
  const { rows, targetsLoading } = useRoutineSessionPlan(routine)
  const { data: history } = useTrainingHistory()
  const last = useMemo(() => (history ? lastTrainedByRoutine(history.sets).get(routine.id) ?? null : undefined), [history, routine.id])

  return (
    <section>
      <div className="mb-1 flex items-center gap-1.5">
        <p className="section-label">Exercises · {rows.length}</p>
        <InfoBubble label="About the targets">
          <b>The same targets as Training → Next.</b> The progress engine compares your last comparable sessions of each exercise
          with its rep target and uses double progression: add reps at the same load until every set reaches the top of the range,
          then add load. Tap an exercise for last time and the routine&apos;s own plan.
          <span className="mt-1.5 block"><SourceNote ids={['acsm2009', 'plotkin2022']} /></span>
        </InfoBubble>
        {last !== undefined && <span className="ml-auto text-meta text-fg-muted">{lastDoneText(last, todayStr)}</span>}
      </div>
      {rows.length > 0
        ? <PlannedExerciseRows rows={rows} targetsLoading={targetsLoading} />
        : <p className="text-body text-fg-muted">This routine has no exercises yet.</p>}
    </section>
  )
}

/** A planned session's exercises with the progress engine's targets. The
 *  engine runs once here (its own provider — the popup opens outside the
 *  Training page) and only for a plan linked to a routine. */
export function PlannedSessionBody({ routine, routinesLoading, todayStr }: { routine: HevyRoutine | null; routinesLoading: boolean; todayStr: string }) {
  if (routinesLoading) return <SkeletonText lines={4} />
  if (!routine) {
    return (
      <p className="flex items-start gap-2 text-body text-fg-muted">
        <Dumbbell aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
        This session isn&apos;t linked to a Hevy routine, so there&apos;s no exercise list. Plan it from a routine (Training → Library → Routines) to see targets here.
      </p>
    )
  }
  return (
    <ErrorBoundary label="Planned exercises" action="training_session_plan">
      <TrainingProgressProvider>
        <RoutineExercises routine={routine} todayStr={todayStr} />
      </TrainingProgressProvider>
    </ErrorBoundary>
  )
}
