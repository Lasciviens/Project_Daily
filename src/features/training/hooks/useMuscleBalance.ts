import { useMemo } from 'react'
import { useHevyRoutines } from './useHevyRoutines'
import { useHevyExerciseTemplates } from './useHevyExerciseTemplates'
import { useAthleteProfile, useCurrentProgramRoutines } from './useAthleteProfile'
import { useMuscleVolume } from './useMuscleVolume'
import { useScheduleBlocks } from '../../daily/hooks/useSchedule'
import { todayStr } from '../../../shared/utils/dateUtils'
import type { ScheduleBlock } from '../../daily/types'
import type { HevyRoutine } from '../types.hevy'
import { buildPlannedProgram, type PlannedProgram as PlannedProgramData } from '../plan/programBalance'
import type { MuscleBalance } from '../plan/muscleBalance'
import { aggregateVolume, buildTplById, computeBalance, presetWindowIso, type Tpl, type VolumeRow } from '../components/muscles/muscleVolumeModel'

// The planned week of the current program and the done volume of a window,
// each computed ONCE here so the Program tab and the Muscles body map read
// the same numbers (and the same muscleBalance.ts verdict) for both.

export interface PlannedProgram extends PlannedProgramData<HevyRoutine> {
  trainingTemplates: ScheduleBlock[]
  targetDays: number | null
  isLoading: boolean
}

/** The current program's planned weekly sets per muscle (Program tab). */
export function usePlannedProgram(): PlannedProgram {
  const { data: routines = [], isLoading: loadingRoutines } = useHevyRoutines()
  const { data: program = [], isLoading: loadingProgram } = useCurrentProgramRoutines()
  // Templates too: without them every planned set is unattributed and the
  // cards briefly read "no planned sets" / "no sets".
  const { data: templates = [], isLoading: loadingTemplates } = useHevyExerciseTemplates()
  const { data: profile } = useAthleteProfile()
  const { data: scheduleBlocks = [] } = useScheduleBlocks()
  const isLoading = loadingRoutines || loadingProgram || loadingTemplates

  return useMemo(() => {
    const trainingTemplates = scheduleBlocks.filter(b => b.category === 'training')
    const targetDays = profile?.training_days_per_week ?? null
    const plan = buildPlannedProgram({
      routines, programRoutineIds: program.map(p => p.routine_id), templates,
      trainingDaysPerWeek: targetDays,
      scheduledTrainingDays: new Set(trainingTemplates.flatMap(t => t.days_of_week)).size,
    })
    return { ...plan, trainingTemplates, targetDays, isLoading }
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
  const { data: templates = [], isLoading: loadingTemplates } = useHevyExerciseTemplates()
  return useMemo(() => {
    const tplById = buildTplById(templates)
    const agg = aggregateVolume(rows, tplById)
    return {
      windowDays, rows, tplById,
      balance: computeBalance({ perSlug: agg.perSlug, weeks: windowDays / 7 }),
      workoutCount: agg.workoutCount, isLoading: isLoading || loadingTemplates,
    }
  }, [rows, templates, windowDays, isLoading, loadingTemplates])
}
