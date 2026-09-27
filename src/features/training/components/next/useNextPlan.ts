import { useMemo } from 'react'
import { shiftDateStr } from '../../../../shared/utils/dateUtils'
import { useTrainingBlocks } from '../../../daily/hooks/useSchedule'
import { useNextTrainingSession, useTodayStr, NEXT_SESSION_LOOKAHEAD_DAYS } from '../../hooks/useTrainingSessions'
import { useHevyRoutines } from '../../hooks/useHevyRoutines'
import { useCurrentProgramRoutines } from '../../hooks/useAthleteProfile'
import { useTrainingHistory } from '../../hooks/useTrainingProgress'
import { useProgressDataContext } from '../../progress/progressDataContext'
import { buildCanonicalSessions, lastTrainedByRoutine, type CanonicalExerciseSession, type ProgressMetricKind } from '../../progress-engine'
import { metricKindForExerciseType } from '../../progressAggregate'
import { resolveNextRoutine, buildTrainingAlerts, type NextRoutinePick, type PlannedRef, type TrainingAlert } from '../../plan/nextSession'
import { buildSessionPlan, type PlanRow } from '../../plan/sessionPlan'
import type { HevyRoutine } from '../../types.hevy'
import type { NextTrainingSession } from '../../trainingPlanModel'

export interface NextPlan {
  isLoading: boolean
  needsCurrentProgram: boolean
  pick: NextRoutinePick | null
  routine: HevyRoutine | null
  session: NextTrainingSession | null
  rows: PlanRow[]
  alerts: TrainingAlert[]
  today: string
}

/** Everything the Next tab renders: which routine is next (the planned
 *  session, else the least recently trained current-program routine), each
 *  exercise's engine target lined up with the routine, and the alerts. The
 *  engine result comes from the page's ONE progress-data run (context). */
export function useNextPlan(): NextPlan {
  const progress = useProgressDataContext()
  const today = useTodayStr()
  const { data: session, isLoading: loadingSession } = useNextTrainingSession()
  // Same range/key as useNextTrainingSession — no extra request; needed for
  // the block's source (the routine it was planned from).
  const { data: blocks } = useTrainingBlocks(today, shiftDateStr(today, NEXT_SESSION_LOOKAHEAD_DAYS))
  const { data: routines, isLoading: loadingRoutines } = useHevyRoutines()
  const { data: program, isLoading: loadingProgram } = useCurrentProgramRoutines()
  const { data: history, isLoading: loadingHistory } = useTrainingHistory()

  const isLoading = progress.isLoading || loadingSession || loadingRoutines || loadingProgram || loadingHistory

  return useMemo<NextPlan>(() => {
    const empty: NextPlan = { isLoading, needsCurrentProgram: progress.needsCurrentProgram, pick: null, routine: null, session: session ?? null, rows: [], alerts: [], today }
    if (isLoading || !routines || !history) return empty

    const block = session?.kind === 'block' ? blocks?.find(b => b.id === session.id) : undefined
    const planned: PlannedRef | null = session
      ? { title: session.title, date: session.date, startTime: session.startTime, sourceId: block?.source_type === 'training_session' ? block.source_id ?? null : null }
      : null
    const pick = resolveNextRoutine({
      planned, routines, programRoutineIds: (program ?? []).map(p => p.routine_id), lastTrained: lastTrainedByRoutine(history.sets),
    })
    const routine = pick?.routineId ? routines.find(r => r.id === pick.routineId) ?? null : null

    const decisionById = new Map(progress.decisions.map(d => [d.exerciseTemplateId, d]))
    const metricKindById = new Map<string, ProgressMetricKind>(history.templates.map(t => [t.id, metricKindForExerciseType(t.type)]))
    const sessionsById = new Map<string, readonly CanonicalExerciseSession[]>(progress.sessionsByTemplateId)
    for (const ex of routine?.exercises ?? []) {
      // An exercise outside the engine's scope (a planned routine that isn't
      // in the current program) still shows its last session.
      if (!sessionsById.has(ex.exercise_template_id)) sessionsById.set(ex.exercise_template_id, buildCanonicalSessions(history.sets, ex.exercise_template_id))
    }
    const rows = routine ? buildSessionPlan(routine.exercises ?? [], { decisionById, sessionsById, metricKindById }) : []
    const alerts = buildTrainingAlerts(
      progress.decisions,
      id => progress.titleById.get(id) ?? 'Exercise',
      progress.program ? { workload: progress.program.workload, corroboratingSignal: progress.program.corroboratingSignal, affectedCount: progress.program.affectedExerciseIds.length } : null,
    )
    return { ...empty, pick, routine, rows, alerts }
  }, [isLoading, progress, session, blocks, routines, program, history, today])
}
