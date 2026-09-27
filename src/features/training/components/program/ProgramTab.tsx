import { useMemo } from 'react'
import { Skeleton } from '../../../../shared/ui'
import { useHevyRoutines } from '../../hooks/useHevyRoutines'
import { useHevyExerciseTemplates } from '../../hooks/useHevyExerciseTemplates'
import {
  useAthleteProfile, useAthleteLimitations, useCurrentProgramRoutines, useExerciseTargetOverrides, useMusclePreferences,
} from '../../hooks/useAthleteProfile'
import { useTrainingHistory } from '../../hooks/useTrainingProgress'
import { useTodayStr } from '../../hooks/useTrainingSessions'
import { useScheduleBlocks } from '../../../daily/hooks/useSchedule'
import { lastTrainedByRoutine } from '../../progress-engine'
import { limitedSlugsFromLimitations } from '../../muscleMap'
import { daysBetween } from '../../plan/nextSession'
import { passesPerWeek, plannedWeeklySets, readBalance, readProgramMuscles, type TemplateMuscles } from '../../plan/programBalance'
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
  const { data: routines = [], isLoading: loadingRoutines } = useHevyRoutines()
  const { data: program = [], isLoading: loadingProgram } = useCurrentProgramRoutines()
  const { data: templates = [] } = useHevyExerciseTemplates()
  const { data: profile } = useAthleteProfile()
  const { data: limitations = [] } = useAthleteLimitations(true)
  const { data: prefs = [] } = useMusclePreferences()
  const { data: overrides = [] } = useExerciseTargetOverrides()
  const { data: scheduleBlocks = [] } = useScheduleBlocks()
  const { data: history } = useTrainingHistory()

  const view = useMemo(() => {
    const ids = new Set(program.map(p => p.routine_id))
    const current = routines.filter(r => ids.has(r.id))
    const trainingTemplates = scheduleBlocks.filter(b => b.category === 'training')
    const scheduledDays = new Set(trainingTemplates.flatMap(t => t.days_of_week)).size
    const targetDays = profile?.training_days_per_week ?? null
    const passes = passesPerWeek(targetDays ?? (scheduledDays || null), current.length)
    const templateMuscles = new Map<string, TemplateMuscles>(templates.map(t => [t.id, { primary: t.primary_muscle_group, secondary: t.secondary_muscle_groups ?? [] }]))
    const input = current.map(r => ({
      id: r.id, title: r.title,
      exercises: (r.exercises ?? []).map(ex => ({ exercise_template_id: ex.exercise_template_id, title: ex.title, sets: ex.sets ?? [] })),
    }))
    const planned = plannedWeeklySets(input, templateMuscles, passes)
    const restrictions = limitedSlugsFromLimitations(limitations)
    const preferences = new Map<string, MusclePreference>(prefs.map(p => [p.muscle_slug, p.preference]))
    const muscles = readProgramMuscles(planned, { preferences, restrictions, experience: profile?.experience_level ?? null })
    const balance = readBalance(planned, input.flatMap(r => r.exercises.map(e => e.title)), restrictions)
    return {
      current, trainingTemplates, targetDays, passes, muscles, balance,
      lastTrained: lastTrainedByRoutine(history?.sets ?? []),
      overrides: new Map(overrides.map(o => [o.exercise_template_id, o])),
    }
  }, [program, routines, scheduleBlocks, profile, templates, limitations, prefs, overrides, history])

  if (loadingRoutines || loadingProgram) {
    return <div className="flex max-w-2xl flex-col gap-3"><Skeleton rounded="rounded-card" className="h-28" /><Skeleton rounded="rounded-card" className="h-48" /></div>
  }

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <CurrentProgramCard routines={view.current} lastTrained={view.lastTrained} today={today} />
      <WeeklyScheduleCard templates={view.trainingTemplates} targetDays={view.targetDays} routineCount={view.current.length} passes={view.passes} />
      {view.current.length > 0 && (
        <div className="grid max-w-2xl grid-cols-1 items-start justify-start gap-3 lg:max-w-none lg:grid-cols-[repeat(auto-fill,minmax(24rem,28rem))]">
          {view.current.map(r => (
            <RoutineProgramCard key={r.id} routine={r} overrides={view.overrides} lastDoneText={lastDone(view.lastTrained.get(r.id), today)} />
          ))}
        </div>
      )}
      <PlannedVolumeCard muscles={view.muscles} passes={view.passes} />
      {view.current.length > 0 && <BalanceCard balance={view.balance} />}
    </div>
  )
}
