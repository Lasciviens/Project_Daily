import { useMemo } from 'react'
import { PageBoard, Skeleton } from '../../../../shared/ui'
import { PROGRAM_BOARD } from '../../trainingBoards'
import {
  useAthleteProfile, useAthleteLimitations, useExerciseTargetOverrides, useMusclePreferences,
} from '../../hooks/useAthleteProfile'
import { useTrainingHistory } from '../../hooks/useTrainingProgress'
import { useTodayStr } from '../../hooks/useTrainingSessions'
import { useDoneVolume, usePlannedProgram } from '../../hooks/useMuscleBalance'
import { comparePlannedDone } from '../../plan/muscleBalance'
import { lastTrainedByRoutine } from '../../progress-engine'
import { limitedSlugsFromLimitations } from '../../muscleMap'
import { daysBetween } from '../../plan/nextSession'
import { readBalance, readProgramMuscles } from '../../plan/programBalance'
import type { MusclePreference } from '../../types.athlete'
import { CurrentProgramCard } from './CurrentProgramCard'
import { WeeklyScheduleCard } from './WeeklyScheduleCard'
import { RoutineProgramCard } from './RoutineProgramCard'
import { PlannedVolumeCard } from './PlannedVolumeCard'
import { BalanceCard } from './BalanceCard'

function lastDone(last: string | undefined, today: string): string {
  if (!last) return 'not in 6 months'
  const d = daysBetween(last, today)
  return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`
}

/** Program: the routines you run, when, what each prescribes, and what that
 *  adds up to per muscle per week — read against the research, with your
 *  limitations and muscle preferences applied. */
export function ProgramTab() {
  const today = useTodayStr()
  const plan = usePlannedProgram()
  const { data: profile } = useAthleteProfile()
  const { data: limitations = [] } = useAthleteLimitations(true)
  const { data: prefs = [] } = useMusclePreferences()
  const { data: overrides = [] } = useExerciseTargetOverrides()
  const { data: history } = useTrainingHistory()
  // Done in the last 30 days — the Muscles body map's default window and query.
  const done = useDoneVolume(30)

  const view = useMemo(() => {
    const { current, trainingTemplates, targetDays, passes, input, planned } = plan
    const restrictions = limitedSlugsFromLimitations(limitations)
    const preferences = new Map<string, MusclePreference>(prefs.map(p => [p.muscle_slug, p.preference]))
    const muscles = readProgramMuscles(planned, { preferences, restrictions, experience: profile?.experience_level ?? null })
    const balance = readBalance(planned, input.flatMap(r => r.exercises.map(e => e.title)), restrictions)
    return {
      current, trainingTemplates, targetDays, passes, muscles, balance,
      lastTrained: lastTrainedByRoutine(history?.sets ?? []),
      overrides: new Map(overrides.map(o => [o.exercise_template_id, o])),
    }
  }, [plan, profile, limitations, prefs, overrides, history])
  // Not before the done volume is in: an empty window reads "— · no sets".
  const comparison = useMemo(() => (done.isLoading ? null : comparePlannedDone(plan, done)), [plan, done])

  if (plan.isLoading) {
    return <div className="flex max-w-2xl flex-col gap-3"><Skeleton rounded="rounded-card" className="h-28" /><Skeleton rounded="rounded-card" className="h-48" /></div>
  }

  // Placed by PageBoard (trainingBoards.ts → PROGRAM_BOARD): the plan in
  // columns across the top, each routine's prescription as a row of cards below.
  return (
    <PageBoard layout={PROGRAM_BOARD} stackGap="gap-3 sm:gap-4" sections={{
      current: <CurrentProgramCard routines={view.current} lastTrained={view.lastTrained} today={today} />,
      schedule: <WeeklyScheduleCard templates={view.trainingTemplates} targetDays={view.targetDays} routineCount={view.current.length} passes={view.passes} />,
      routines: view.current.length > 0 && (
        // Columns by the routines' OWN width: two on a wide tablet (the phone
        // stack), one stacked column in the 42rem main track of a wide page.
        <div className="@container">
          <div className="grid max-w-2xl grid-cols-1 items-start gap-3 @[50rem]:max-w-none @[50rem]:grid-cols-[repeat(auto-fill,minmax(24rem,1fr))]">
            {view.current.map(r => (
              <RoutineProgramCard key={r.id} routine={r} overrides={view.overrides} lastDoneText={lastDone(view.lastTrained.get(r.id), today)} />
            ))}
          </div>
        </div>
      ),
      planned: <PlannedVolumeCard muscles={view.muscles} passes={view.passes} />,
      balance: view.current.length > 0 && <BalanceCard balance={view.balance} comparison={comparison} doneWindowDays={done.windowDays} />,
    }} />
  )
}
