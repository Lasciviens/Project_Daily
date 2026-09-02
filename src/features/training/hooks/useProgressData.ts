import { useMemo } from 'react'
import { useTrainingHistory, useBodyweightHistory } from './useTrainingProgress'
import { useAthleteProfile, useAthleteLimitations, useCurrentProgramRoutines, useMusclePreferences, useExerciseTargetOverrides } from './useAthleteProfile'
import { useHevyRoutines } from './useHevyRoutines'
import { useHealthMetricSeries } from './useHealthExport'
import { computeSleepSummary } from '../healthAggregate'
import { computeWeeklySleepTrend } from '../recoveryAggregate'
import {
  computeExerciseProgression, metricKindForExerciseType, mondayOf, computeWeeklySetsPerMuscleTrend,
  computeConsistencyByWeek, computeCurrentWeekMuscleDose,
  type ProgressSetRow, type CurrentWeekMuscleDose,
} from '../progressAggregate'
import { lastCompleteWeek } from '../trainingInsights'
import {
  filterToCurrentProgram, resolveExpectation, computeExerciseDecision, computeProgramDecision,
  type ExerciseDecision, type ProgramDecision, type RoutineTargetLookup, type UserOverrideLookup,
} from '../progressDecisions'
import { buildTemplateMuscleMap, contribution, labelForSlug, limitedSlugsFromLimitations, ROLE_WEIGHTS } from '../muscleMap'
import type { Slug } from 'react-muscle-highlighter'
import type { HevyRoutine } from '../types.hevy'

const RECENT_DAYS = 28

export interface MuscleDoseCard {
  slug: string
  label: string
  /** Last up to 6 COMPLETE weeks of credited sets, oldest first — the
   *  current, still-in-progress week is deliberately excluded (a real bug,
   *  reported live: judging a Wednesday against a full week's target read
   *  as a deficit before the week had even happened). This is what "growth
   *  over time" actually looks like per muscle, not just a single latest
   *  number, and it's ONLY ever compared against other complete weeks. */
  weeklyTrend: number[]
  /** Last COMPLETE week's credited sets — the number `direction`/`gap`
   *  below are actually about. Never the in-progress current week. */
  weeklySets: number
  /** Derived from the CURRENT PROGRAM'S OWN routine structure (one full
   *  pass through every routine in current_program_routines), not a generic
   *  population landmark — the user's explicit correction: "below MEV"
   *  warnings that don't come from their own program aren't trustworthy.
   *  Null when the current program's routines don't have this muscle
   *  mapped yet (e.g. an exercise never logged, so its muscle group is
   *  unknown) — shown as "not enough data", never a silent zero. */
  routineExpectation: number | null
  /** Only ever compares the last COMPLETE week against the plan — never the
   *  in-progress current week (see currentWeek below for that). */
  gap: number | null
  /** Trend across complete weeks only — never swayed by how far into the
   *  current week you happen to be when you open the page. */
  direction: 'improving' | 'declining' | 'flat' | null
  preference: 'priority' | 'exclude_direct' | null
  restriction: 'avoid' | 'limit' | undefined
  /** The CURRENT, still-in-progress week — informational only, never a
   *  deficit/gap judgment (a real bug, reported live: a Wednesday showed
   *  "Gap: -7.5" against the full week's plan before the week was even
   *  over). `remainingPlannedSets` is computed from the ACTUAL structure of
   *  whichever of the current program's routines haven't been trained yet
   *  this week — not a proportional guess — so it reflects what's really
   *  left, not an even split of the weekly total. Null once the current
   *  week's program has no routines to schedule against (no current
   *  program, or this muscle isn't in any of them). */
  currentWeek: CurrentWeekMuscleDose | null
}

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
  decisions: ExerciseDecision[]
  program: ProgramDecision | null
  summary: SummaryCards | null
  titleById: Map<string, string>
  muscles: MuscleDoseCard[]
}

const RECOVERY_WINDOW_DAYS = 182
const EMPTY: ProgressData = {
  isLoading: true, needsCurrentProgram: false, suggestedRoutines: [], decisions: [], program: null,
  summary: null, titleById: new Map(), muscles: [],
}

/** Assembles everything progressDecisions.ts needs from the app's existing
 *  data hooks, runs the decision engine, and returns render-ready results.
 *  Kept as a hook (not a pure function) because it composes several React
 *  Query results — the actual math underneath is 100% the pure functions in
 *  progressDecisions.ts/progressAggregate.ts/muscleMap.ts. */
export function useProgressData(): ProgressData {
  const { data: history, isLoading: loadingHistory } = useTrainingHistory()
  const { data: bodyweight = [] } = useBodyweightHistory()
  const { data: profile } = useAthleteProfile()
  const { data: limitations = [] } = useAthleteLimitations(true)
  const { data: currentProgram = [], isLoading: loadingProgram } = useCurrentProgramRoutines()
  const { data: musclePrefs = [] } = useMusclePreferences()
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
          for (const s of ex.sets ?? []) {
            if (s.rep_range_start != null && s.rep_range_end != null) {
              return { repMin: s.rep_range_start, repMax: s.rep_range_end }
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

    const decisions: ExerciseDecision[] = templateIds.map(templateId => {
      const type = typeById.get(templateId) ?? 'weight_reps'
      const metricKind = metricKindForExerciseType(type)
      const points = computeExerciseProgression(filteredSets, templateId, metricKind)
      const expectation = resolveExpectation(templateId, metricKind, routineTarget, userOverride)

      const eligibleDates = new Set(points.filter(p => p.topValue != null).slice(-2).map(p => p.date))
      const qualifyingSets = filteredSets.filter(s => s.exercise_template_id === templateId && eligibleDates.has(s.date))

      return computeExerciseDecision({ templateId, metricKind, points, qualifyingSets, expectation })
    }).sort((a, b) => a.comparableSessions - b.comparableSessions === 0
      ? a.templateId.localeCompare(b.templateId)
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

    const program = computeProgramDecision({ decisions, corroboratingSignal })

    // ── Muscle dose — every muscle actually trained under the current
    // program, with a growth-over-time TREND (not just a latest number)
    // and an expectation derived from the athlete's OWN routine structure.
    const templateMuscles = buildTemplateMuscleMap(history.templates)
    const trainedSlugs = new Set<Slug>()
    for (const t of templateMuscles.values()) {
      if (t.primarySlug) trainedSlugs.add(t.primarySlug)
      for (const s of t.secondarySlugs) trainedSlugs.add(s)
    }
    const prefBySlug = new Map(musclePrefs.map(p => [p.muscle_slug, p.preference]))
    const limitedSlugs = limitedSlugsFromLimitations(limitations)
    // The current, still-in-progress week is judged SEPARATELY from complete
    // weeks (a real bug, reported live: a Wednesday with 2 of 4 workouts done
    // showed a "-7.5 sets" deficit against the FULL week's plan, before the
    // week had even happened). Trend/gap below only ever look at complete
    // weeks; `currentWeek` on each card is purely informational.
    const currentWeekMonday = mondayOf(toStr)
    const completeWeekCutoff = lastCompleteWeek(toStr)

    // One full pass through every routine in the current program = the
    // program's OWN implied weekly target per muscle. Deliberately not a
    // generic MEV/MAV landmark — the user's explicit correction: an
    // "expected" number that doesn't come from their own program isn't
    // trustworthy. Simplification, stated plainly rather than hidden: this
    // assumes the program is intended to be completed about once a week
    // (true for a standard N-day split); a program run more or less often
    // than weekly will read as over/under its own target even when
    // followed exactly as written. Credit is also kept PER ROUTINE (not just
    // summed) so "sets planned in the remaining workouts this week" reflects
    // the actual structure of whichever routines haven't been trained yet —
    // never a proportional guess, since different routines can load a given
    // muscle very differently (e.g. a push day vs a pull day).
    const routineExpectationBySlug = new Map<string, number>()
    const creditByRoutineAndSlug = new Map<string, Map<string, number>>()
    const templatesWithKnownMuscle = new Set(templateMuscles.keys())
    let anyExerciseUnmapped = false
    for (const r of activeRoutines) {
      const perRoutine = new Map<string, number>()
      creditByRoutineAndSlug.set(r.id, perRoutine)
      for (const ex of r.exercises ?? []) {
        const muscles = templateMuscles.get(ex.exercise_template_id)
        if (!muscles) { anyExerciseUnmapped = true; continue }
        const workingSets = (ex.sets ?? []).filter(s => s.type !== 'warmup').length
        if (workingSets === 0) continue
        if (muscles.primarySlug) {
          const credit = workingSets * ROLE_WEIGHTS.primary
          routineExpectationBySlug.set(muscles.primarySlug, (routineExpectationBySlug.get(muscles.primarySlug) ?? 0) + credit)
          perRoutine.set(muscles.primarySlug, (perRoutine.get(muscles.primarySlug) ?? 0) + credit)
        }
        for (const s of muscles.secondarySlugs) {
          const credit = workingSets * ROLE_WEIGHTS.secondary
          routineExpectationBySlug.set(s, (routineExpectationBySlug.get(s) ?? 0) + credit)
          perRoutine.set(s, (perRoutine.get(s) ?? 0) + credit)
        }
      }
    }
    void templatesWithKnownMuscle
    void anyExerciseUnmapped // surfaced via routineExpectation:null on affected muscles, not a global banner (most programs are fully mapped)

    // Which of the current program's routines have already been trained at
    // least once this week — the other side of "N of M workouts completed".
    const doneRoutineIdsThisWeek = new Set(
      filteredSets
        .filter(s => s.date >= currentWeekMonday && s.date <= toStr && s.routine_id != null && currentProgramIds.has(s.routine_id))
        .map(s => s.routine_id as string),
    )
    const workoutsPlannedThisWeek = activeRoutines.length
    const workoutsCompletedThisWeek = activeRoutines.filter(r => doneRoutineIdsThisWeek.has(r.id)).length
    const remainingRoutines = activeRoutines.filter(r => !doneRoutineIdsThisWeek.has(r.id))

    const muscles: MuscleDoseCard[] = [...trainedSlugs].map(slug => {
      const weekly = computeWeeklySetsPerMuscleTrend(filteredSets as ProgressSetRow[], templateMuscles, slug, contribution)
      const completeWeeks = weekly.filter(w => w.weekStart <= completeWeekCutoff)
      const last6 = completeWeeks.slice(-6)
      const latest = last6[last6.length - 1]?.sets ?? 0
      const earliest = last6[0]?.sets ?? 0
      const direction: MuscleDoseCard['direction'] = last6.length < 2 ? null
        : latest > earliest * 1.1 ? 'improving' : latest < earliest * 0.9 ? 'declining' : 'flat'

      const routineExpectation = routineExpectationBySlug.has(slug) ? Math.round((routineExpectationBySlug.get(slug) as number) * 10) / 10 : null

      const currentWeekEntry = weekly.find(w => w.weekStart === currentWeekMonday)
      const completedSets = currentWeekEntry?.sets ?? 0
      const remainingPlannedSets = Math.round(
        remainingRoutines.reduce((sum, r) => sum + (creditByRoutineAndSlug.get(r.id)?.get(slug) ?? 0), 0) * 10,
      ) / 10
      const currentWeek = computeCurrentWeekMuscleDose({
        routineExpectation, completedSets, remainingPlannedSets,
        workoutsCompleted: workoutsCompletedThisWeek, workoutsPlanned: workoutsPlannedThisWeek,
      })

      return {
        slug, label: labelForSlug(slug),
        weeklyTrend: last6.map(w => w.sets),
        weeklySets: latest,
        routineExpectation,
        gap: routineExpectation != null ? Math.round((latest - routineExpectation) * 10) / 10 : null,
        direction,
        preference: prefBySlug.get(slug) ?? null,
        restriction: limitedSlugs.get(slug),
        currentWeek,
      }
    }).sort((a, b) => a.label.localeCompare(b.label))

    // ── Summary cards ──────────────────────────────────────────────────────
    const consistencyWeeks = computeConsistencyByWeek(filteredSets)
    const thisWeekSessions = consistencyWeeks[consistencyWeeks.length - 1]?.sessionCount ?? 0
    const adherence = { completedThisWeek: thisWeekSessions, target: profile?.training_days_per_week ?? null }

    const analyzable = decisions.filter(d => d.status !== 'insufficient_data')
    const improving = analyzable.filter(d => d.status === 'increase' || d.status === 'keep')

    let bodyweightDirection: SummaryCards['bodyweightDirection'] = null
    if (bodyweight.length >= 2) {
      const latestBw = bodyweight[bodyweight.length - 1]
      const twoWeeksAgo = Date.now() - 14 * 86_400_000
      const older = [...bodyweight].reverse().find(b => new Date(b.date).getTime() <= twoWeeksAgo) ?? bodyweight[0]
      const days = Math.max(1, Math.round((new Date(latestBw.date).getTime() - new Date(older.date).getTime()) / 86_400_000))
      bodyweightDirection = { deltaKg: Math.round((latestBw.kg - older.kg) * 10) / 10, days }
    }

    const reliable = decisions.filter(d => d.trendConfidence !== 'low' && d.status !== 'insufficient_data').length
    const summary: SummaryCards = {
      adherence, exerciseProgress: { improving: improving.length, analyzable: analyzable.length },
      bodyweightDirection, dataConfidence: { reliable, total: decisions.length },
    }

    return { isLoading: false, needsCurrentProgram: false, suggestedRoutines: [], decisions, program, summary, titleById, muscles }
  }, [isLoading, history, currentProgram, routines, targetOverrides, musclePrefs, limitations, sleepPoints, profile, bodyweight, toStr])
}
