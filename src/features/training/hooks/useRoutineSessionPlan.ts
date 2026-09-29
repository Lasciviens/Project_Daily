import { useMemo } from 'react'
import { useProgressDataContext } from '../progress/progressDataContext'
import { buildCanonicalSessions, type CanonicalExerciseSession, type ProgressMetricKind } from '../progress-engine'
import { metricKindForExerciseType } from '../progressAggregate'
import { buildSessionPlan, type PlanRow } from '../plan/sessionPlan'
import { useTrainingHistory } from './useTrainingProgress'
import type { ProgressData } from './useProgressData'
import type { TrainingHistory } from '../api/hevyApi'
import type { HevyRoutine } from '../types.hevy'

/** A routine lined up with the progress engine: per exercise the program's
 *  prescription, the engine's set-by-set target and last session. An exercise
 *  outside the engine's scope (a routine that isn't in the current program)
 *  still shows its last session. The ONE place Next and the session popup
 *  build their exercise rows. */
export function routinePlanRows(routine: HevyRoutine, progress: ProgressData, history: TrainingHistory): PlanRow[] {
  const decisionById = new Map(progress.decisions.map(d => [d.exerciseTemplateId, d]))
  const metricKindById = new Map<string, ProgressMetricKind>(history.templates.map(t => [t.id, metricKindForExerciseType(t.type)]))
  const sessionsById = new Map<string, readonly CanonicalExerciseSession[]>(progress.sessionsByTemplateId)
  for (const ex of routine.exercises ?? []) {
    if (!sessionsById.has(ex.exercise_template_id)) sessionsById.set(ex.exercise_template_id, buildCanonicalSessions(history.sets, ex.exercise_template_id))
  }
  return buildSessionPlan(routine.exercises ?? [], { decisionById, sessionsById, metricKindById })
}

/** `routinePlanRows` for the progress data in context (TrainingProgressProvider).
 *  While the engine or the history is still loading, rows carry the routine's
 *  own plan and `targetsLoading` is true. */
export function useRoutineSessionPlan(routine: HevyRoutine | null): { rows: PlanRow[]; targetsLoading: boolean } {
  const progress = useProgressDataContext()
  const { data: history, isLoading: loadingHistory } = useTrainingHistory()
  const targetsLoading = progress.isLoading || loadingHistory
  const rows = useMemo<PlanRow[]>(() => {
    if (!routine) return []
    if (targetsLoading || !history) {
      return buildSessionPlan(routine.exercises ?? [], { decisionById: new Map(), sessionsById: new Map(), metricKindById: new Map() })
    }
    return routinePlanRows(routine, progress, history)
  }, [routine, progress, history, targetsLoading])
  return { rows, targetsLoading }
}
