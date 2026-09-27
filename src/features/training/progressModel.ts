import {
  metricKindForExerciseType, sessionsThisWeek, sessionsFromSets, lastCompleteWeek, bodyweightChange,
  type BodyweightAnchor, type BodyweightChange, type ProgressSetRow,
} from './progressAggregate'
import {
  buildCanonicalSessions, evaluateExerciseProgress, resolveExpectation, inferEquipmentClass, routineTargetFromSets,
  computeProgramDecision, sleepCorroboratingSignal, filterToCurrentProgram, suggestCurrentProgramRoutineIds,
  isImproving, isAnalyzable, DEFAULT_POLICY,
  type ExerciseProgressResult, type RoutineTargetLookup, type UserOverrideLookup, type CanonicalExerciseSession,
  type ProgressMetricKind, type ProgramDecision,
} from './progress-engine'
import { computeSleepSummary } from '../health/healthAggregate'
import { computeWeeklySleepTrend } from '../health/recoveryAggregate'
import type { HevyRoutine } from './types.hevy'
import type { CurrentProgramRoutine, ExerciseTargetOverride } from './types.athlete'
import type { HealthMetric } from '../health/api/healthApi'
import type { TrainingExerciseTemplate } from './api/hevyApi'

// ─────────────────────────────────────────────────────────────────────────────
//  The progress engine, assembled once from plain data. Pure: no React, no
//  Supabase. The Progress page (useProgressData, via React Query) and the AI
//  coaches (coach/coachData.ts, via direct fetches) both call this, so the PT
//  assessment and the Coach chat read exactly the decisions the Progress tab
//  shows — they used to work from a hard-coded split and could contradict it.
// ─────────────────────────────────────────────────────────────────────────────

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
  /** True when no saved current-program routine still exists — the decision
   *  engine refuses to run at all in this state (it used to treat every
   *  logged exercise, current program or not, as current) and asks the user
   *  to pick their program instead. */
  needsCurrentProgram: boolean
  /** True when routines ARE saved as the current program but none of them
   *  exists any more (deleted in the Hevy app, pruned by Sync). */
  staleProgram: boolean
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
  /** The current-program routines that still exist, in routine order. */
  activeRoutines: HevyRoutine[]
  /** Today (local) as the data was computed — consumers use it for "last 14
   *  days" style windows so they agree with the engine. */
  today: string
}

export function emptyProgressData(today: string, over: Partial<ProgressData> = {}): ProgressData {
  return {
    isLoading: true, needsCurrentProgram: false, staleProgram: false, suggestedRoutines: [], decisions: [], program: null,
    summary: null, titleById: new Map(), sessionsByTemplateId: new Map(), metricKindByTemplateId: new Map(),
    muscleGroupByTemplateId: new Map(), routineTitlesByTemplateId: new Map(), activeRoutines: [], today, ...over,
  }
}

export interface ProgressModelInput {
  history: { sets: ProgressSetRow[]; templates: TrainingExerciseTemplate[] }
  currentProgram: readonly CurrentProgramRoutine[]
  routines: readonly HevyRoutine[]
  targetOverrides: readonly ExerciseTargetOverride[]
  sleepPoints: readonly HealthMetric[]
  bodyweight: readonly BodyweightAnchor[]
  targetDays: number | null
  today: string
}

export function computeProgressModel(input: ProgressModelInput): ProgressData {
  const { history, currentProgram, routines, targetOverrides, sleepPoints, bodyweight, targetDays, today } = input
  const routineIds = new Set(routines.map(r => r.id))
  // Only saved routines that still exist count: a routine deleted in Hevy
  // (and pruned by Sync) used to keep the gate open with nothing behind it.
  const currentProgramIds = new Set(currentProgram.map(c => c.routine_id).filter(id => routineIds.has(id)))

  // The critical gate: no explicit current program -> no decisions at all.
  if (currentProgramIds.size === 0) {
    const suggestedIds = suggestCurrentProgramRoutineIds(routines.map(r => r.id), history.sets, today)
    const byId = new Map(routines.map(r => [r.id, r]))
    return emptyProgressData(today, {
      isLoading: false, needsCurrentProgram: true, staleProgram: currentProgram.length > 0,
      suggestedRoutines: suggestedIds.map(id => byId.get(id)).filter((r): r is HevyRoutine => !!r),
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

  const signal = sleepCorroboratingSignal(computeWeeklySleepTrend(computeSleepSummary([...sleepPoints])), lastCompleteWeek(today))
  const program = computeProgramDecision(decisions, signal)

  const analyzable = decisions.filter(isAnalyzable)
  const summary: SummaryCards = {
    adherence: { completedThisWeek: sessionsThisWeek(sessionsFromSets(filteredSets), today), target: targetDays },
    exerciseProgress: { improving: analyzable.filter(isImproving).length, analyzable: analyzable.length },
    bodyweight: bodyweightChange([...bodyweight], today),
    dataConfidence: { reliable: program.reliableCount, total: decisions.length },
  }

  return {
    isLoading: false, needsCurrentProgram: false, staleProgram: false, suggestedRoutines: [], decisions, program, summary, titleById,
    sessionsByTemplateId, metricKindByTemplateId, muscleGroupByTemplateId, routineTitlesByTemplateId, activeRoutines, today,
  }
}
