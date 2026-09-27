import { useMemo } from 'react'
import { useHevyRoutines } from './useHevyRoutines'
import { useHevyExerciseTemplates } from './useHevyExerciseTemplates'
import { useAthleteProfile, useCurrentProgramRoutines } from './useAthleteProfile'
import { useMuscleVolume } from './useMuscleVolume'
import { useScheduleBlocks } from '../../daily/hooks/useSchedule'
import { todayStr } from '../../../shared/utils/dateUtils'
import {
  passesPerWeek, plannedBalanceByRoutine, plannedWeeklySets, type ProgramRoutineInput, type TemplateMuscles,
} from '../plan/programBalance'
import {
  balanceTotals, compareBalance, doneBalanceSources, readMuscleBalance,
  type BalanceComparison, type BalancePair, type BalanceVolumeRow, type MuscleBalance, type PlannedRoutineBalance,
} from '../plan/muscleBalance'
import { aggregateVolume, buildTplById, computeBalance, presetWindowIso, type Tpl, type VolumeRow } from '../components/muscles/muscleVolumeModel'

// The planned week of the current program and the done volume of a window,
// each computed ONCE here so the Program tab and the Muscles body map read
// the same numbers (and the same muscleBalance.ts verdict) for both.

export interface PlannedProgram {
  current: ReturnType<typeof useHevyRoutines>['data'] & object
  input: ProgramRoutineInput[]
  trainingTemplates: ReturnType<typeof useScheduleBlocks>['data'] & object
  targetDays: number | null
  passes: number
  templateMuscles: Map<string, TemplateMuscles>
  planned: ReturnType<typeof plannedWeeklySets>
  byRoutine: PlannedRoutineBalance[]
  balance: MuscleBalance
  isLoading: boolean
}

/** The current program's planned weekly sets per muscle (Program tab). */
export function usePlannedProgram(): PlannedProgram {
  const { data: routines = [], isLoading: loadingRoutines } = useHevyRoutines()
  const { data: program = [], isLoading: loadingProgram } = useCurrentProgramRoutines()
  const { data: templates = [] } = useHevyExerciseTemplates()
  const { data: profile } = useAthleteProfile()
  const { data: scheduleBlocks = [] } = useScheduleBlocks()
  const isLoading = loadingRoutines || loadingProgram

  return useMemo(() => {
    const ids = new Set(program.map(p => p.routine_id))
    const current = routines.filter(r => ids.has(r.id))
    const trainingTemplates = scheduleBlocks.filter(b => b.category === 'training')
    const scheduledDays = new Set(trainingTemplates.flatMap(t => t.days_of_week)).size
    const targetDays = profile?.training_days_per_week ?? null
    const passes = passesPerWeek(targetDays ?? (scheduledDays || null), current.length)
    const templateMuscles = new Map<string, TemplateMuscles>(templates.map(t => [t.id, { primary: t.primary_muscle_group, secondary: t.secondary_muscle_groups ?? [] }]))
    const input: ProgramRoutineInput[] = current.map(r => ({
      id: r.id, title: r.title,
      exercises: (r.exercises ?? []).map(ex => ({ exercise_template_id: ex.exercise_template_id, title: ex.title, sets: ex.sets ?? [] })),
    }))
    const planned = plannedWeeklySets(input, templateMuscles, passes)
    const bySlug = new Map(planned.map(p => [p.slug, p.weeklySets]))
    return {
      current, input, trainingTemplates, targetDays, passes, templateMuscles, planned,
      byRoutine: plannedBalanceByRoutine(input, templateMuscles),
      balance: readMuscleBalance(balanceTotals(s => bySlug.get(s) ?? 0)),
      isLoading,
    }
  }, [program, routines, scheduleBlocks, profile, templates, isLoading])
}

export interface DoneVolume {
  windowDays: number
  rows: VolumeRow[]
  tplById: Map<string, Tpl>
  balance: MuscleBalance
  workoutCount: number
  isLoading: boolean
}

/** Done volume over the Muscles tab's preset window (same query, same
 *  aggregation — so "done in the last 30 days" is one number everywhere). */
export function useDoneVolume(windowDays: number): DoneVolume {
  const { fromIso, toIso } = presetWindowIso(todayStr(), windowDays)
  const { data: rows = [], isLoading } = useMuscleVolume(fromIso, toIso)
  const { data: templates = [] } = useHevyExerciseTemplates()
  return useMemo(() => {
    const tplById = buildTplById(templates)
    const agg = aggregateVolume(rows as VolumeRow[], tplById)
    return {
      windowDays, rows: rows as VolumeRow[], tplById,
      balance: computeBalance({ perSlug: agg.perSlug, weeks: windowDays / 7 }),
      workoutCount: agg.workoutCount, isLoading,
    }
  }, [rows, templates, windowDays, isLoading])
}

/** Planned vs done for both ratios, with the one-line "why" where they
 *  differ. Null when there is no current program to compare against. */
export function balanceComparison(
  plan: Pick<PlannedProgram, 'current' | 'balance' | 'byRoutine' | 'passes'>,
  done: { rows: readonly BalanceVolumeRow[]; tplById: ReadonlyMap<string, Tpl>; balance: MuscleBalance; windowDays: number },
): Record<BalancePair, BalanceComparison> | null {
  if (plan.current.length === 0) return null
  return compareBalance({
    planned: plan.balance,
    done: done.balance,
    sources: doneBalanceSources(done.rows, done.tplById, plan.byRoutine),
    passesPerWeek: plan.passes,
    windowDays: done.windowDays,
  })
}
