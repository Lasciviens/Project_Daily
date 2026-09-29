import { useMemo } from 'react'
import { shiftDateStr, todayStr } from '../../../shared/utils/dateUtils'
import { useHealthDaily } from '../../health/hooks/useHealthExport'
import { useGoalReport } from '../../health/goal/useGoalReport'
import { useMuscleWatch } from '../../health/goal/useMuscleWatch'
import { buildGoalDecision, proteinAdvice, type GoalDecision } from '../../health/goal/cutDecision'
import type { DayTargets, NutritionGoal } from './useDayTargets'

// ─────────────────────────────────────────────────────────────────────────────
//  The nutrition coach — a thin reader around THE goal decision
//  (health/goal/cutDecision.ts). Every coaching surface (the goal editor,
//  Food · Today's coach card, Health → Goal progress) calls this hook, so the
//  same data always gives the same answer: protein from lean mass, a calorie
//  floor that only limits cutting, and one precedence-ordered headline.
//
//  Data: the goal report's standard 28-day window (useGoalReport(28) — the
//  same cache the Goal progress card opens on): the fitted weight trend, the
//  paired logged intake / Apple burn, the scale's own burn and the latest
//  body-fat %; Muscle watch's level; the last 7 complete days' steps.
//
//  `targets` is passed in so the goal editor can ask about the phase and
//  calories it is DRAFTING rather than the saved ones.
// ─────────────────────────────────────────────────────────────────────────────

export interface NutritionCoach {
  weightKg:        number | null
  bodyFatPct:      number | null
  proteinByGoal:   Record<NutritionGoal, number>
  proteinForGoal:  number | null
  proteinPerMealG: number | null
  fatFloorG:       number | null
  calorieFloor:    number
  decision:        GoalDecision
  isLoading:       boolean
}

const PHASES: NutritionGoal[] = ['cut', 'maintain', 'gain']

export function useNutritionCoach(targets: DayTargets): NutritionCoach {
  const today = todayStr()
  const d = useGoalReport(28)
  const { watch, isLoading: watchLoading } = useMuscleWatch()
  const steps = useHealthDaily('step_count', shiftDateStr(today, -7), shiftDateStr(today, -1))
  const report = d.report

  return useMemo(() => {
    const e = report?.energy
    const weightKg = e ? (e.weight.currentTrendKg ?? e.weight.meanKg) : null
    const bodyFatPct = report?.latest.fatPct ?? null
    const last7 = e?.daysDetail.slice(-7) ?? []
    const stepDays = steps.data ?? []
    const steps7 = stepDays.length >= 4 ? stepDays.reduce((a, s) => a + s.value, 0) / stepDays.length : null

    const decision = buildGoalDecision({
      phase: targets.goal,
      today,
      weightKg,
      bodyFatPct,
      pctPerWeek: e?.weight.pctPerWeek != null ? -e.weight.pctPerWeek : null,
      kgPerWeek: e?.weight.kgPerWeek ?? null,
      weighIns: e?.weight.weighIns ?? 0,
      weighInSpanDays: e?.weight.spanDays ?? 0,
      loggedDays7: last7.filter(x => x.use === 'used' || x.use === 'apple_gap').length,
      targetKcal: targets.calories,
      targetProteinG: targets.protein,
      loggedIntakeKcal: e?.paired.days ? e.paired.meanIntake : null,
      appleBurnKcal: e?.paired.days ? e.paired.meanBurn : null,
      scaleBurnKcal: e?.observedTdee ?? null,
      muscleWatch: watch?.level ?? null,
      phaseStartDate: targets.phaseStartDate,
      lastCalorieAdjust: targets.lastCalorieAdjust,
      steps7,
    })
    const proteinByGoal = Object.fromEntries(PHASES.map(g => [g, weightKg ? proteinAdvice(g, weightKg, bodyFatPct).targetG : 0])) as Record<NutritionGoal, number>
    return {
      weightKg,
      bodyFatPct,
      proteinByGoal,
      proteinForGoal: decision.protein?.targetG ?? null,
      proteinPerMealG: decision.protein?.perMealG ?? null,
      fatFloorG: decision.fatFloorG,
      calorieFloor: decision.floor.kcal,
      decision,
      isLoading: (!report && d.isLoading) || watchLoading,
    }
  }, [report, d.isLoading, watch, watchLoading, steps.data, targets.goal, targets.calories, targets.protein, targets.phaseStartDate, targets.lastCalorieAdjust, today])
}
