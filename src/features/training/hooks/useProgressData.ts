import { useMemo } from 'react'
import { useTrainingHistory, useBodyweightHistory } from './useTrainingProgress'
import { useAthleteProfile, useCurrentProgramRoutines, useExerciseTargetOverrides } from './useAthleteProfile'
import { useHevyRoutines } from './useHevyRoutines'
import { useHealthMetricSeries } from './useHealthExport'
import { computeSleepSummary } from '../healthAggregate'
import { computeWeeklySleepTrend } from '../recoveryAggregate'
import { metricKindForExerciseType, computeConsistencyByWeek, type ProgressSetRow } from '../progressAggregate'
import { computeProgramDecision, type ProgramDecision } from '../progressDecisions'
import {
  buildCanonicalSessions, evaluateExerciseProgress, resolveExpectation, DEFAULT_POLICY,
  type ExerciseProgressResult, type RoutineTargetLookup, type UserOverrideLookup, type CanonicalExerciseSession,
  type ProgressMetricKind,
} from '../progress-engine'
import type { HevyRoutine } from '../types.hevy'

/** A set counts toward decision-making when its workout belongs to the
 *  explicit current program, OR was freeform (no routine_id at all — an
 *  unambiguous, un-programmed but still-current session). A set tied to a
 *  KNOWN OTHER routine (one that exists but isn't in the current-program
 *  set) is excluded — that's "old program" history, not noise to keep.
 *  Ported from the retired progressDecisions.ts verbatim — this scoping
 *  rule is independent of the per-exercise algorithm rewrite. */
function filterToCurrentProgram(sets: ProgressSetRow[], currentProgramRoutineIds: ReadonlySet<string>): ProgressSetRow[] {
  if (currentProgramRoutineIds.size === 0) return sets
  return sets.filter(s => s.routine_id == null || currentProgramRoutineIds.has(s.routine_id))
}

/** computeProgramDecision (the program-level "is this exercise declining"
 *  tally, unrelated to this round's per-exercise algorithm rewrite) still
 *  expects the old coarse {status, reasonCodes} shape. This maps the new
 *  engine's richer result onto exactly that shape — a thin, local adapter,
 *  never exposed outside this hook. */
function toLegacyStatusShape(result: ExerciseProgressResult): { templateId: string; status: 'increase' | 'keep' | 'watch' | 'plateau' | 'insufficient_data'; reasonCodes: string[]; trendConfidence: 'low' | 'medium' | 'high' } {
  const trendConfidence = result.evidence.progress === 'strong' ? 'high' : result.evidence.progress === 'moderate' ? 'medium' : 'low'
  switch (result.currentAction) {
    case 'READY_TO_INCREASE': return { templateId: result.exerciseTemplateId, status: 'increase', reasonCodes: [], trendConfidence }
    case 'BUILD_AT_CURRENT_LOAD': return { templateId: result.exerciseTemplateId, status: 'keep', reasonCodes: [], trendConfidence }
    case 'WATCH_FOR_PLATEAU': return { templateId: result.exerciseTemplateId, status: 'plateau', reasonCodes: [], trendConfidence }
    case 'WATCH_FOR_REGRESSION': return { templateId: result.exerciseTemplateId, status: 'watch', reasonCodes: ['TREND_DOWN'], trendConfidence }
    case 'INSUFFICIENT_DATA': return { templateId: result.exerciseTemplateId, status: 'insufficient_data', reasonCodes: [], trendConfidence }
    default: return { templateId: result.exerciseTemplateId, status: 'watch', reasonCodes: [], trendConfidence }
  }
}

const RECENT_DAYS = 28

export interface SummaryCards {
  adherence: { completedThisWeek: number; target: number | null } | null
  exerciseProgress: { improving: number; analyzable: number }
  bodyweightDirection: { deltaKg: number; days: number } | null
  dataConfidence: { reliable: number; total: number }
}

export interface ProgressData {
  isLoading: boolean
  /** True when current_program_routines is empty — the decision engine
   *  refuses to run at all in this state (a real bug, fixed 2026-09-02):
   *  it used to silently treat every logged exercise, current program or
   *  not, as equally current, producing an unreliable verdict and a
   *  40+-row table. Now it produces NO decisions and asks the user to
   *  select their program instead. */
  needsCurrentProgram: boolean
  suggestedRoutines: HevyRoutine[]
  decisions: ExerciseProgressResult[]
  program: ProgramDecision | null
  summary: SummaryCards | null
  titleById: Map<string, string>
  /** Full comparable session history per exercise — "Show all sessions"
   *  and the progress chart render straight from this rather than
   *  recomputing it, since useProgressData already builds it once per
   *  exercise to run the decision engine. */
  sessionsByTemplateId: Map<string, CanonicalExerciseSession[]>
  metricKindByTemplateId: Map<string, ProgressMetricKind>
  /** Primary muscle group per exercise (from hevy_exercise_templates) — the
   *  metadata backing the muscle-group filter (§10). Null when the template
   *  carries no group. */
  muscleGroupByTemplateId: Map<string, string | null>
  /** Every CURRENT-program routine title an exercise appears in — the
   *  metadata backing the routine filter (§10). Sourced from the same
   *  active-routine structure `filterToCurrentProgram`/`currentExerciseIds`
   *  already use, so it never drifts from what "current program" means
   *  elsewhere in this hook. */
  routineTitlesByTemplateId: Map<string, string[]>
}

const RECOVERY_WINDOW_DAYS = 182
const EMPTY: ProgressData = {
  isLoading: true, needsCurrentProgram: false, suggestedRoutines: [], decisions: [], program: null,
  summary: null, titleById: new Map(), sessionsByTemplateId: new Map(), metricKindByTemplateId: new Map(),
  muscleGroupByTemplateId: new Map(), routineTitlesByTemplateId: new Map(),
}

/** Assembles everything progressDecisions.ts needs from the app's existing
 *  data hooks, runs the decision engine, and returns render-ready results.
 *  Kept as a hook (not a pure function) because it composes several React
 *  Query results — the actual math underneath is 100% the pure functions in
 *  progress-engine/ (per-exercise decisions) and progressAggregate.ts
 *  (consistency/adherence). */
export function useProgressData(): ProgressData {
  const { data: history, isLoading: loadingHistory } = useTrainingHistory()
  const { data: bodyweight = [] } = useBodyweightHistory()
  const { data: profile } = useAthleteProfile()
  const { data: currentProgram = [], isLoading: loadingProgram } = useCurrentProgramRoutines()
  const { data: targetOverrides = [] } = useExerciseTargetOverrides()
  const { data: routines = [], isLoading: loadingRoutines } = useHevyRoutines()

  const toStr = new Date().toISOString().slice(0, 10)
  const fromStr = new Date(Date.now() - RECOVERY_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10)
  const { data: sleepPoints = [] } = useHealthMetricSeries('sleep_analysis', fromStr, toStr)

  const isLoading = loadingHistory || loadingProgram || loadingRoutines

  return useMemo(() => {
    if (isLoading || !history) return EMPTY

    const currentProgramIds = new Set(currentProgram.map(c => c.routine_id))

    // ── The critical gate: no explicit current program -> no decisions at
    // all, ever. A recency hint is offered so the picker isn't a blank
    // wall, but the engine itself never runs on it unconfirmed.
    if (currentProgramIds.size === 0) {
      const cutoff = Date.now() - RECENT_DAYS * 86_400_000
      const suggestedRoutines = routines.filter(r => new Date(r.hevy_updated_at).getTime() >= cutoff)
      return { ...EMPTY, isLoading: false, needsCurrentProgram: true, suggestedRoutines }
    }

    const filteredSets = filterToCurrentProgram(history.sets, currentProgramIds)
    const activeRoutines = routines.filter(r => currentProgramIds.has(r.id))

    const routineTarget: RoutineTargetLookup = (templateId) => {
      for (const r of activeRoutines) {
        for (const ex of r.exercises ?? []) {
          if (ex.exercise_template_id !== templateId) continue
          const workingSets = (ex.sets ?? []).filter(s => s.type !== 'warmup')
          for (const s of workingSets) {
            if (s.rep_range_start != null && s.rep_range_end != null) {
              return { repMin: s.rep_range_start, repMax: s.rep_range_end, targetSets: workingSets.length }
            }
          }
        }
      }
      return null
    }
    const userOverride: UserOverrideLookup = (templateId) => {
      const o = targetOverrides.find(t => t.exercise_template_id === templateId)
      return o ? { repMin: o.rep_range_start, repMax: o.rep_range_end } : null
    }

    // Scoped to the CURRENT routine structure's own exercise list, not every
    // exercise ever logged under a current-program routine_id — a real bug,
    // reported live (a routine that has since swapped out an exercise still
    // tagged its old logged sets with the same routine_id, so decisions kept
    // including exercises no longer actually in the program: "6 of 44"
    // instead of the program's real "9 of 13"). A freeform session (no
    // routine_id) for an exercise that's part of the current structure still
    // counts via filterToCurrentProgram above; an exercise trained only
    // freeform and never part of any current routine is out of scope here —
    // this view is specifically "how is my CURRENT PROGRAM going".
    const currentExerciseIds = new Set<string>()
    for (const r of activeRoutines) {
      for (const ex of r.exercises ?? []) currentExerciseIds.add(ex.exercise_template_id)
    }
    const templateIds = [...new Set(filteredSets.map(s => s.exercise_template_id))]
      .filter(id => currentExerciseIds.has(id))
    const titleById = new Map(history.templates.map(t => [t.id, t.title]))
    const typeById = new Map(history.templates.map(t => [t.id, t.type]))
    const muscleGroupByTemplateId = new Map(history.templates.map(t => [t.id, t.primary_muscle_group]))

    const routineTitlesByTemplateId = new Map<string, string[]>()
    for (const r of activeRoutines) {
      for (const ex of r.exercises ?? []) {
        const bucket = routineTitlesByTemplateId.get(ex.exercise_template_id) ?? []
        if (!bucket.includes(r.title)) bucket.push(r.title)
        routineTitlesByTemplateId.set(ex.exercise_template_id, bucket)
      }
    }

    const sessionsByTemplateId = new Map<string, ReturnType<typeof buildCanonicalSessions>>()
    const metricKindByTemplateId = new Map<string, ProgressMetricKind>()
    const decisions: ExerciseProgressResult[] = templateIds.map(templateId => {
      const type = typeById.get(templateId) ?? 'weight_reps'
      const metricKind = metricKindForExerciseType(type)
      const sessions = buildCanonicalSessions(filteredSets, templateId)
      sessionsByTemplateId.set(templateId, sessions)
      metricKindByTemplateId.set(templateId, metricKind)
      const fallbackTargetSets = sessions[sessions.length - 1]?.comparableWorkingSets.length || 3
      const expectation = resolveExpectation(templateId, metricKind, fallbackTargetSets, routineTarget, userOverride)
      return evaluateExerciseProgress({ exerciseTemplateId: templateId, metricKind, sessions, expectation }, DEFAULT_POLICY)
    }).sort((a, b) => a.comparableSessions - b.comparableSessions === 0
      ? a.exerciseTemplateId.localeCompare(b.exerciseTemplateId)
      : b.comparableSessions - a.comparableSessions) // most-evidenced exercises first, insufficient_data sinks to the bottom naturally

    const weeklySleep = computeWeeklySleepTrend(computeSleepSummary(sleepPoints))
    const withData = weeklySleep.filter(w => w.avgHours != null)
    let corroboratingSignal: { label: string } | null = null
    if (withData.length >= 4) {
      const recent2 = withData.slice(-2).map(w => w.avgHours as number)
      const prior2 = withData.slice(-4, -2).map(w => w.avgHours as number)
      if (recent2.length === 2 && prior2.length === 2) {
        const recentAvg = (recent2[0] + recent2[1]) / 2
        const priorAvg = (prior2[0] + prior2[1]) / 2
        if (recentAvg < priorAvg - 0.75) corroboratingSignal = { label: `sleep down ~${Math.round((priorAvg - recentAvg) * 10) / 10}h/night over the last 2 weeks` }
      }
    }

    const legacyShapes = decisions.map(toLegacyStatusShape)
    const program = computeProgramDecision({ decisions: legacyShapes, corroboratingSignal })

    // ── Summary cards ──────────────────────────────────────────────────────
    const consistencyWeeks = computeConsistencyByWeek(filteredSets)
    const thisWeekSessions = consistencyWeeks[consistencyWeeks.length - 1]?.sessionCount ?? 0
    const adherence = { completedThisWeek: thisWeekSessions, target: profile?.training_days_per_week ?? null }

    const analyzable = legacyShapes.filter(d => d.status !== 'insufficient_data')
    const improving = analyzable.filter(d => d.status === 'increase' || d.status === 'keep')

    let bodyweightDirection: SummaryCards['bodyweightDirection'] = null
    if (bodyweight.length >= 2) {
      const latestBw = bodyweight[bodyweight.length - 1]
      const twoWeeksAgo = Date.now() - 14 * 86_400_000
      const older = [...bodyweight].reverse().find(b => new Date(b.date).getTime() <= twoWeeksAgo) ?? bodyweight[0]
      const days = Math.max(1, Math.round((new Date(latestBw.date).getTime() - new Date(older.date).getTime()) / 86_400_000))
      bodyweightDirection = { deltaKg: Math.round((latestBw.kg - older.kg) * 10) / 10, days }
    }

    const reliable = legacyShapes.filter(d => d.trendConfidence !== 'low' && d.status !== 'insufficient_data').length
    const summary: SummaryCards = {
      adherence, exerciseProgress: { improving: improving.length, analyzable: analyzable.length },
      bodyweightDirection, dataConfidence: { reliable, total: decisions.length },
    }

    return {
      isLoading: false, needsCurrentProgram: false, suggestedRoutines: [], decisions, program, summary, titleById,
      sessionsByTemplateId, metricKindByTemplateId, muscleGroupByTemplateId, routineTitlesByTemplateId,
    }
  }, [isLoading, history, currentProgram, routines, targetOverrides, sleepPoints, profile, bodyweight])
}
