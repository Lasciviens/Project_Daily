import { useMemo } from 'react'
import { useTrainingHistory, useBodyweightHistory } from './useTrainingProgress'
import { useAthleteProfile, useAthleteLimitations, useCurrentProgramRoutines, useMusclePreferences, useExerciseTargetOverrides } from './useAthleteProfile'
import { useHevyRoutines } from './useHevyRoutines'
import { useHealthMetricSeries } from './useHealthExport'
import { computeSleepSummary } from '../healthAggregate'
import { computeWeeklySleepTrend } from '../recoveryAggregate'
import {
  computeExerciseProgression, metricKindForExerciseType, mondayOf, computeWeeklySetsPerMuscleTrend,
  type ProgressSetRow,
} from '../progressAggregate'
import {
  filterToCurrentProgram, resolveExpectation, computeExerciseDecision, computeProgramDecision,
  type ExerciseDecision, type ProgramDecision, type RoutineTargetLookup, type UserOverrideLookup,
} from '../progressDecisions'
import { buildTemplateMuscleMap, contribution, labelForSlug, MUSCLE_LANDMARKS, scaleLandmarksForExperience, limitedSlugsFromLimitations } from '../muscleMap'
import type { Landmarks } from '../muscleMap'
import type { Slug } from 'react-muscle-highlighter'

export interface MuscleDoseCard {
  slug: string
  label: string
  weeklySets: number
  expectedMev: number | null
  expectedMav: number | null
  preference: 'priority' | 'exclude_direct' | null
  restriction: 'avoid' | 'limit' | undefined
}

export interface ProgressData {
  isLoading: boolean
  decisions: ExerciseDecision[]
  program: ProgramDecision | null
  titleById: Map<string, string>
  muscles: MuscleDoseCard[]
  currentProgramSelected: boolean
}

const RECOVERY_WINDOW_DAYS = 182

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
    void bodyweight // reserved for a future bodyweight-context card; not consumed by the decision engine itself
    if (isLoading || !history) {
      return { isLoading: true, decisions: [], program: null, titleById: new Map(), muscles: [], currentProgramSelected: false }
    }

    const currentProgramIds = new Set(currentProgram.map(c => c.routine_id))
    const filteredSets = filterToCurrentProgram(history.sets, currentProgramIds)

    const routineTarget: RoutineTargetLookup = (templateId) => {
      for (const r of routines) {
        if (currentProgramIds.size > 0 && !currentProgramIds.has(r.id)) continue
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

    const templateIds = [...new Set(filteredSets.map(s => s.exercise_template_id))]
    const titleById = new Map(history.templates.map(t => [t.id, t.title]))
    const typeById = new Map(history.templates.map(t => [t.id, t.type]))

    const decisions: ExerciseDecision[] = templateIds.map(templateId => {
      const type = typeById.get(templateId) ?? 'weight_reps'
      const metricKind = metricKindForExerciseType(type)
      const points = computeExerciseProgression(filteredSets, templateId, metricKind)
      const expectation = resolveExpectation(templateId, metricKind, routineTarget, userOverride)

      // Qualifying sets = the raw rows behind the last 2 eligible sessions —
      // used only for RPE bonus evidence (computeExerciseDecision reads it).
      const eligibleDates = new Set(points.filter(p => p.topValue != null).slice(-2).map(p => p.date))
      const qualifyingSets = filteredSets.filter(s => s.exercise_template_id === templateId && eligibleDates.has(s.date))

      return computeExerciseDecision({ templateId, metricKind, points, qualifyingSets, expectation })
    })

    // Corroborating signal for a program-level "review workload" call: a
    // sustained (>=2 week) unfavorable sleep trend, gated the same way
    // RecoveryLoadPanel already gates it (>=4 tracked nights/week) — never
    // a single night, per the algorithm's own multi-signal requirement.
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

    // ── Muscle dose — ALL muscles actually trained under the current
    // program, not just a priority-filtered subset (a real gap the second
    // review round caught: filtering the default view can hide a genuine
    // deficiency in a non-priority muscle like quads or back).
    const templateMuscles = buildTemplateMuscleMap(history.templates)
    const trainedSlugs = new Set<Slug>()
    for (const t of templateMuscles.values()) {
      if (t.primarySlug) trainedSlugs.add(t.primarySlug)
      for (const s of t.secondarySlugs) trainedSlugs.add(s)
    }
    const prefBySlug = new Map(musclePrefs.map(p => [p.muscle_slug, p.preference]))
    const limitedSlugs = limitedSlugsFromLimitations(limitations)
    const lastWeek = mondayOf(toStr)

    const muscles: MuscleDoseCard[] = [...trainedSlugs].map(slug => {
      const weekly = computeWeeklySetsPerMuscleTrend(filteredSets as ProgressSetRow[], templateMuscles, slug, contribution)
      const latestWeek = weekly.filter(w => w.weekStart <= lastWeek).slice(-1)[0]
      const landmarks: Landmarks | undefined = MUSCLE_LANDMARKS[slug]
        ? scaleLandmarksForExperience(MUSCLE_LANDMARKS[slug], profile?.experience_level)
        : undefined
      return {
        slug, label: labelForSlug(slug),
        weeklySets: latestWeek?.sets ?? 0,
        expectedMev: landmarks?.mev ?? null,
        expectedMav: landmarks?.mav ?? null,
        preference: prefBySlug.get(slug) ?? null,
        restriction: limitedSlugs.get(slug),
      }
    }).sort((a, b) => a.label.localeCompare(b.label))

    return { isLoading: false, decisions, program, titleById, muscles, currentProgramSelected: currentProgramIds.size > 0 }
  }, [isLoading, history, currentProgram, routines, targetOverrides, musclePrefs, limitations, sleepPoints, profile, bodyweight, toStr])
}
