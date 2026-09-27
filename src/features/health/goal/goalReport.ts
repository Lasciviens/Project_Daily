// Assembles the goal report from its pure parts: the energy balance
// (energyBalance.ts), the phase-aware pace, fat vs muscle and goals
// (bodyGoal.ts) and the path (goalPath.ts). Pure (scripts/verify-body-goal.cjs).

import { addDays, buildEnergyReport, neededDays, type EnergyInputs, type EnergyReport, type WeighIn } from './energyBalance'
import {
  analyseComposition, buildRateVerdict, goalProgress, REPORT_SOURCE,
  type CompositionReading, type CompositionResult, type GoalProgress, type GoalSeries, type Phase, type RateVerdict, type SeriesTrend,
} from './bodyGoal'
import { buildPath, type GoalPath } from './goalPath'

export interface BodyGoals { weightKg: number | null; bodyFatPct: number | null; muscleMassKg: number | null }

export interface GoalReportInputs extends Omit<EnergyInputs, 'goal' | 'phaseStartDate' | 'leanMassKg'> {
  phase: Phase
  phaseStartDate: string | null
  /** Scale readings from every source, from the phase start (or the window) on. */
  readings: CompositionReading[]
  /** The merged bodyweight series from the phase start (or the window) on. */
  weightHistory: WeighIn[]
  goals: BodyGoals
}

export interface GoalReport {
  phase: Phase
  energy: EnergyReport
  rate: RateVerdict | null
  comp: CompositionResult
  path: GoalPath
  goals: { weight: GoalProgress | null; bodyFat: GoalProgress | null; muscle: GoalProgress | null }
  /** Latest scale lean / muscle mass, for labels. */
  latest: { leanKg: number | null; muscleKg: number | null; fatPct: number | null; date: string | null }
}

/** A weight change counts as moving once it beats 0.3 kg and twice its own noise. */
export const MIN_WEIGHT_CHANGE_KG = 0.3

function trendOf(t: SeriesTrend | null): GoalSeries['trend'] {
  return t ? { slopePerDay: t.slopePerDay, current: t.current, lastDate: t.lastDate, significant: t.significant } : null
}

export function buildGoalReport(inp: GoalReportInputs): GoalReport {
  const windowEnd = addDays(inp.to, 1)
  const comp = analyseComposition(inp.readings, inp.from, windowEnd)

  const newestFirst = [...inp.readings].sort((a, b) => b.date.localeCompare(a.date))
  const newest = (pick: (r: CompositionReading) => number | null, source?: string | null) =>
    newestFirst.find(r => (source == null || r.source === source) && pick(r) != null) ?? null
  const leanReading = newest(r => r.leanMassKg, comp.source) ?? newest(r => r.leanMassKg)
  const muscleReading = newest(r => r.muscleMassKg, REPORT_SOURCE)
  const fatSource = comp.source ?? newest(r => r.fatPct)?.source ?? null
  const fatReading = newest(r => r.fatPct, fatSource)

  const energy = buildEnergyReport({
    ...inp, goal: inp.phase, phaseStartDate: inp.phaseStartDate, leanMassKg: leanReading?.leanMassKg ?? null,
  })
  const rate = buildRateVerdict(inp.phase, energy, { intakeReliable: energy.intake.loggedDays >= neededDays(energy.days) })

  // Weight goal: the window's fitted trend, the merged series for the baseline.
  const w = energy.weight
  const lastWeighIn = w.series[w.series.length - 1]?.date ?? null
  const span = w.spanDays
  const weightTrend: GoalSeries['trend'] = energy.hasTrend && w.slopeKgPerDay != null && w.currentTrendKg != null && lastWeighIn
    ? {
      slopePerDay: w.slopeKgPerDay, current: w.currentTrendKg, lastDate: lastWeighIn,
      significant: Math.abs(w.slopeKgPerDay * span) >= Math.max(MIN_WEIGHT_CHANGE_KG, 2 * (w.slopeSe ?? 0) * span),
    }
    : null
  const weightPoints = inp.weightHistory.filter(p => Number.isFinite(p.kg)).map(p => ({ date: p.date, value: p.kg }))

  const series = (source: string | null, pick: (r: CompositionReading) => number | null) =>
    inp.readings.flatMap(r => (r.source === source && pick(r) != null ? [{ date: r.date, value: pick(r) as number }] : []))

  const goals = {
    weight: goalProgress('weight', inp.goals.weightKg, { points: weightPoints, trend: weightTrend }, inp.phaseStartDate),
    bodyFat: goalProgress('bodyFat', inp.goals.bodyFatPct, {
      points: series(fatSource, r => r.fatPct),
      trend: comp.source === fatSource ? trendOf(comp.fatPct) : null,
    }, inp.phaseStartDate),
    muscle: goalProgress('muscle', inp.goals.muscleMassKg, {
      points: series(REPORT_SOURCE, r => r.muscleMassKg), trend: trendOf(comp.muscle),
    }, inp.phaseStartDate),
  }

  const path = buildPath({ phase: inp.phase, rate, comp, energy, weightKg: w.currentTrendKg ?? w.meanKg })
  return {
    phase: inp.phase, energy, rate, comp, path, goals,
    latest: {
      leanKg: leanReading?.leanMassKg ?? null,
      muscleKg: muscleReading?.muscleMassKg ?? null,
      fatPct: fatReading?.fatPct ?? null,
      date: [leanReading?.date, fatReading?.date].filter(Boolean).sort().pop() ?? null,
    },
  }
}
