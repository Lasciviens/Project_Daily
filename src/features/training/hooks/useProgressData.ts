import { useMemo } from 'react'
import { daysAgoStr, todayStr } from '../../../shared/utils/dateUtils'
import { useTrainingHistory, useBodyweightHistory, TRAINING_HISTORY_DAYS } from './useTrainingProgress'
import { useAthleteProfile, useCurrentProgramRoutines, useExerciseTargetOverrides } from './useAthleteProfile'
import { useHevyRoutines } from './useHevyRoutines'
import { useHealthMetricSeries } from '../../health/hooks/useHealthExport'
import { computeSleepSummary } from '../../health/healthAggregate'
import { computeWeeklySleepTrend } from '../../health/recoveryAggregate'
import {
  metricKindForExerciseType, sessionsThisWeek, sessionsFromSets, lastCompleteWeek, bodyweightChange,
  type BodyweightAnchor, type BodyweightChange,
} from '../progressAggregate'
import {
  buildCanonicalSessions, evaluateExerciseProgress, resolveExpectation, inferEquipmentClass, routineTargetFromSets,
  computeProgramDecision, sleepCorroboratingSignal, filterToCurrentProgram, suggestCurrentProgramRoutineIds,
  isImproving, isAnalyzable, DEFAULT_POLICY,
  type ExerciseProgressResult, type RoutineTargetLookup, type UserOverrideLookup, type CanonicalExerciseSession,
  type ProgressMetricKind, type ProgramDecision,
} from '../progress-engine'
import type { HevyRoutine } from '../types.hevy'
import type { CurrentProgramRoutine, ExerciseTargetOverride } from '../types.athlete'
import type { HealthMetric } from '../../health/api/healthApi'

export interface SummaryCards {
  /** Sessions this calendar week so far (Monday → today, local), current
   *  program only — 0 on a Monday with nothing logged, never last week. */
  adherence: { completedThisWeek: number; target: number | null }
  exerciseProgress: { improving: number; analyzable: number }
  bodyweight: BodyweightChange
  dataConfidence: { reliable: number; total: number }
}

export interface ProgressData {
  isLoading: boolean
  /** True when current_program_routines is empty — the decision engine
   *  refuses to run at all in this state (it used to treat every logged
   *  exercise, current program or not, as current) and asks the user to
   *  pick their program instead. */
  needsCurrentProgram: boolean
  /** Routines actually TRAINED in the last 28 days (from workouts, not from
   *  when a routine was last edited), most recent first — a starting
   *  suggestion the athlete still confirms. */
  suggestedRoutines: HevyRoutine[]
  decisions: ExerciseProgressResult[]
  program: ProgramDecision | null
  summary: SummaryCards | null
  titleById: Map<string, string>
  /** Full comparable session history per exercise — "Show all sessions" and
   *  the progress chart render straight from this. */
  sessionsByTemplateId: Map<string, CanonicalExerciseSession[]>
  metricKindByTemplateId: Map<string, ProgressMetricKind>
  muscleGroupByTemplateId: Map<string, string | null>
  /** Every CURRENT-program routine title an exercise appears in. */
  routineTitlesByTemplateId: Map<string, string[]>
  /** Today (local) as the data was computed — consumers use it for "last 14
   *  days" style windows so they agree with the engine. */
  today: string
}

// Module-level empties: a fresh `= []` default per render made the memo
// below recompute on every render while a query was loading or failed.
const NO_BODYWEIGHT: BodyweightAnchor[] = []
const NO_PROGRAM: CurrentProgramRoutine[] = []
const NO_OVERRIDES: ExerciseTargetOverride[] = []
const NO_ROUTINES: HevyRoutine[] = []
const NO_SLEEP: HealthMetric[] = []

function emptyData(today: string, over: Partial<ProgressData> = {}): ProgressData {
  return {
    isLoading: true, needsCurrentProgram: false, suggestedRoutines: [], decisions: [], program: null,
    summary: null, titleById: new Map(), sessionsByTemplateId: new Map(), metricKindByTemplateId: new Map(),
    muscleGroupByTemplateId: new Map(), routineTitlesByTemplateId: new Map(), today, ...over,
  }
}

/** Assembles everything the progress engine needs from the app's data
 *  hooks, runs it ONCE, and returns render-ready results. Call it once per
 *  page (ProgressDataProvider) and read the result through context — every
 *  extra call re-ran the whole engine for every exercise. The math itself
 *  lives in the pure modules (progress-engine/, progressAggregate.ts). */
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
    if (isLoading || !history) return emptyData(today)

    const currentProgramIds = new Set(currentProgram.map(c => c.routine_id))

    // The critical gate: no explicit current program -> no decisions at all.
    if (currentProgramIds.size === 0) {
      const suggestedIds = suggestCurrentProgramRoutineIds(routines.map(r => r.id), history.sets, today)
      const byId = new Map(routines.map(r => [r.id, r]))
      return emptyData(today, {
        isLoading: false, needsCurrentProgram: true,
        suggestedRoutines: suggestedIds.map(id => byId.get(id) as HevyRoutine),
      })
    }

    const filteredSets = filterToCurrentProgram(history.sets, currentProgramIds)
    const activeRoutines = routines.filter(r => currentProgramIds.has(r.id))

    const routineTarget: RoutineTargetLookup = (templateId) => {
      for (const r of activeRoutines) {
        for (const ex of r.exercises ?? []) {
          if (ex.exercise_template_id !== templateId) continue
          const target = routineTargetFromSets(ex.sets ?? [])
          if (target) return target
        }
      }
      return null
    }
    const userOverride: UserOverrideLookup = (templateId) => {
      const o = targetOverrides.find(t => t.exercise_template_id === templateId)
      return o ? { repMin: o.rep_range_start, repMax: o.rep_range_end } : null
    }

    // Scoped to the CURRENT routine structure's own exercise list — an
    // exercise swapped out of a routine keeps its old routine_id on logged
    // sets, and used to stay in the table ("6 of 44" instead of "9 of 13").
    const currentExerciseIds = new Set<string>()
    const routineTitlesByTemplateId = new Map<string, string[]>()
    for (const r of activeRoutines) {
      for (const ex of r.exercises ?? []) {
        currentExerciseIds.add(ex.exercise_template_id)
        const bucket = routineTitlesByTemplateId.get(ex.exercise_template_id) ?? []
        if (!bucket.includes(r.title)) bucket.push(r.title)
        routineTitlesByTemplateId.set(ex.exercise_template_id, bucket)
      }
    }
    const templateIds = [...new Set(filteredSets.map(s => s.exercise_template_id))].filter(id => currentExerciseIds.has(id))
    const titleById = new Map(history.templates.map(t => [t.id, t.title]))
    const typeById = new Map(history.templates.map(t => [t.id, t.type]))
    const muscleGroupByTemplateId = new Map(history.templates.map(t => [t.id, t.primary_muscle_group]))

    const sessionsByTemplateId = new Map<string, CanonicalExerciseSession[]>()
    const metricKindByTemplateId = new Map<string, ProgressMetricKind>()
    const decisions: ExerciseProgressResult[] = templateIds.map(templateId => {
      const metricKind = metricKindForExerciseType(typeById.get(templateId) ?? 'weight_reps')
      const sessions = buildCanonicalSessions(filteredSets, templateId)
      sessionsByTemplateId.set(templateId, sessions)
      metricKindByTemplateId.set(templateId, metricKind)
      const fallbackTargetSets = sessions[sessions.length - 1]?.comparableWorkingSets.length || 3
      const expectation = resolveExpectation(templateId, metricKind, fallbackTargetSets, routineTarget, userOverride)
      const equipmentClass = inferEquipmentClass(titleById.get(templateId) ?? '')
      return evaluateExerciseProgress({ exerciseTemplateId: templateId, metricKind, sessions, expectation, equipmentClass }, DEFAULT_POLICY)
    }).sort((a, b) => b.comparableSessions - a.comparableSessions || a.exerciseTemplateId.localeCompare(b.exerciseTemplateId))

    const signal = sleepCorroboratingSignal(computeWeeklySleepTrend(computeSleepSummary(sleepPoints)), lastCompleteWeek(today))
    const program = computeProgramDecision(decisions, signal)

    const analyzable = decisions.filter(isAnalyzable)
    const summary: SummaryCards = {
      adherence: { completedThisWeek: sessionsThisWeek(sessionsFromSets(filteredSets), today), target: targetDays },
      exerciseProgress: { improving: analyzable.filter(isImproving).length, analyzable: analyzable.length },
      bodyweight: bodyweightChange(bodyweight, today),
      dataConfidence: { reliable: program.reliableCount, total: decisions.length },
    }

    return {
      isLoading: false, needsCurrentProgram: false, suggestedRoutines: [], decisions, program, summary, titleById,
      sessionsByTemplateId, metricKindByTemplateId, muscleGroupByTemplateId, routineTitlesByTemplateId, today,
    }
  }, [isLoading, history, currentProgram, routines, targetOverrides, sleepPoints, targetDays, bodyweight, today])
}
