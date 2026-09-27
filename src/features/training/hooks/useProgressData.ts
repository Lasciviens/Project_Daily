import { useMemo } from 'react'
import { daysAgoStr, todayStr } from '../../../shared/utils/dateUtils'
import { useTrainingHistory, useBodyweightHistory, TRAINING_HISTORY_DAYS } from './useTrainingProgress'
import { useAthleteProfile, useCurrentProgramRoutines, useExerciseTargetOverrides } from './useAthleteProfile'
import { useHevyRoutines } from './useHevyRoutines'
import { useHealthMetricSeries } from '../../health/hooks/useHealthExport'
import { computeProgressModel, emptyProgressData, type ProgressData } from '../progressModel'
import type { BodyweightAnchor } from '../progressAggregate'
import type { HevyRoutine } from '../types.hevy'
import type { CurrentProgramRoutine, ExerciseTargetOverride } from '../types.athlete'
import type { HealthMetric } from '../../health/api/healthApi'

export type { ProgressData, SummaryCards } from '../progressModel'

// Module-level empties: a fresh `= []` default per render made the memo
// below recompute on every render while a query was loading or failed.
const NO_BODYWEIGHT: BodyweightAnchor[] = []
const NO_PROGRAM: CurrentProgramRoutine[] = []
const NO_OVERRIDES: ExerciseTargetOverride[] = []
const NO_ROUTINES: HevyRoutine[] = []
const NO_SLEEP: HealthMetric[] = []

/** Assembles everything the progress engine needs from the app's data
 *  hooks and runs it ONCE (progressModel.computeProgressModel — the same
 *  function the AI coaches call). Call it once per page
 *  (ProgressDataProvider) and read the result through context. */
export function useProgressData(): ProgressData {
  const { data: history, isLoading: loadingHistory } = useTrainingHistory()
  const { data: bodyweight = NO_BODYWEIGHT } = useBodyweightHistory()
  const { data: profile } = useAthleteProfile()
  const { data: currentProgram = NO_PROGRAM, isLoading: loadingProgram } = useCurrentProgramRoutines()
  const { data: targetOverrides = NO_OVERRIDES } = useExerciseTargetOverrides()
  const { data: routines = NO_ROUTINES, isLoading: loadingRoutines } = useHevyRoutines()

  const today = todayStr()
  const fromStr = daysAgoStr(TRAINING_HISTORY_DAYS)
  const { data: sleepPoints = NO_SLEEP } = useHealthMetricSeries('sleep_analysis', fromStr, today)

  const isLoading = loadingHistory || loadingProgram || loadingRoutines
  const targetDays = profile?.training_days_per_week ?? null

  return useMemo(() => {
    if (isLoading || !history) return emptyProgressData(today)
    return computeProgressModel({ history, currentProgram, routines, targetOverrides, sleepPoints, bodyweight, targetDays, today })
  }, [isLoading, history, currentProgram, routines, targetOverrides, sleepPoints, targetDays, bodyweight, today])
}
