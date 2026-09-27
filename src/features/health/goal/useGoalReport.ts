import { useMemo } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { localDayOf, shiftDateStr, todayStr } from '../../../shared/utils/dateUtils'
import { useHealthDaily, useHealthMetricsBatch } from '../hooks/useHealthExport'
import { useBodyweightSeries } from '../hooks/useBodyweight'
import { useBodyCompositionReports } from '../hooks/useBodyCompositionReports'
import { fetchEatenDiaryRows } from './diaryTotalsApi'
import type { EnergyDay } from './energyBalance'
import { compositionReadings, type AppleScalePoint, type ScaleReport } from './bodyGoal'
import { buildGoalReport, type GoalReport } from './goalReport'
import { useBodyGoals, usePhase } from './useBodyGoals'

export type GoalWindow = 14 | 28 | 56

// The smart scale writes these into Apple Health (Health Auto Export → health_metrics).
const SCALE_METRICS = ['weight_body_mass', 'body_fat_percentage', 'lean_body_mass'] as const
// Goal baselines reach back to the phase start, but never more than two years.
const MAX_HISTORY_DAYS = 730

const earlier = (a: string, b: string) => (a < b ? a : b)

/** Everything the goal report needs for the last `windowDays` complete days
 *  (today is left out — its diary and energy aren't finished). */
export function useGoalReport(windowDays: GoalWindow) {
  const today = todayStr()
  const to = shiftDateStr(today, -1)
  const from = shiftDateStr(to, -(windowDays - 1))

  const goals = useBodyGoals()
  const phase = usePhase()
  const phaseStart = goals.settings.phaseStartDate
  const oldest = shiftDateStr(today, -MAX_HISTORY_DAYS)
  const startBound = phaseStart && phaseStart >= oldest ? phaseStart : null
  // Six days before the window feed the first moving-average points; today's
  // morning weigh-in reflects yesterday.
  const weightFrom = startBound ? earlier(startBound, shiftDateStr(from, -6)) : shiftDateStr(from, -6)
  const scaleFrom = startBound ? earlier(startBound, from) : from

  const diary = useQuery({
    queryKey: qk.health.cutDiary(from, to),
    queryFn: () => fetchEatenDiaryRows(from, to),
    staleTime: STALE.default,
    placeholderData: keepPreviousData,
  })
  const active = useHealthDaily('active_energy', from, to)
  const basal = useHealthDaily('basal_energy_burned', from, to)
  const weights = useBodyweightSeries(weightFrom, today)
  const scale = useHealthMetricsBatch(SCALE_METRICS, scaleFrom, today)
  const reports = useBodyCompositionReports()

  const diaryRows = diary.data, activeRows = active.data, basalRows = basal.data, weightRows = weights.data
  const scalePoints = scale.data?.points, reportRows = reports.data
  // A failed scale read shouldn't hide the rest of the report.
  const scaleReady = !scale.isLoading || scale.isError
  const reportsReady = !reports.isLoading || reports.isError

  const report: GoalReport | null = useMemo(() => {
    if (!diaryRows || !activeRows || !basalRows || !weightRows || !scaleReady || !reportsReady) return null
    const energy = new Map<string, EnergyDay>()
    for (const d of activeRows) energy.set(d.date, { date: d.date, activeKcal: d.value, basalKcal: null })
    for (const d of basalRows) energy.set(d.date, { ...(energy.get(d.date) ?? { date: d.date, activeKcal: null }), basalKcal: d.value })

    const apple: AppleScalePoint[] = []
    for (const [metric, pts] of Object.entries(scalePoints ?? {})) {
      for (const p of pts) {
        const v = Number(p.value?.qty)
        if (Number.isFinite(v)) apple.push({ metric, date: p.date, recordedAt: p.recorded_at, source: p.source, value: v })
      }
    }
    const scaleReports: ScaleReport[] = (reportRows ?? []).flatMap(r => {
      const date = localDayOf(r.measured_at)
      return date ? [{ date, weightKg: Number(r.weight_kg), fatPct: Number(r.body_fat_percent), fatMassKg: Number(r.body_fat_mass_kg), leanMassKg: Number(r.lean_body_mass_kg), musclePct: r.muscle_percent != null ? Number(r.muscle_percent) : null }] : []
    })

    return buildGoalReport({
      from, to,
      phase: phase.phase,
      phaseStartDate: phaseStart,
      intake: diaryRows.map(r => ({ date: r.date, kcal: Number(r.calories) || 0, proteinG: Number(r.protein_g) || 0 })),
      energy: [...energy.values()],
      weights: weightRows.map(p => ({ date: p.date, kg: p.kg })),
      weightHistory: weightRows.map(p => ({ date: p.date, kg: p.kg })),
      readings: compositionReadings(apple, scaleReports),
      goals: { weightKg: goals.settings.goalWeightKg, bodyFatPct: goals.settings.goalBodyFatPct, muscleMassKg: goals.settings.goalMuscleMassKg },
      targetKcal: phase.isLoaded ? phase.targetKcal : null,
    })
  }, [diaryRows, activeRows, basalRows, weightRows, scalePoints, reportRows, scaleReady, reportsReady, from, to, phase.phase, phase.isLoaded, phase.targetKcal, phaseStart, goals.settings])

  return {
    report, from, to, goals, phase,
    isLoading: diary.isLoading || active.isLoading || basal.isLoading || weights.isLoading || !scaleReady || !reportsReady,
    isError: diary.isError || active.isError || basal.isError || weights.isError,
  }
}

export type GoalReportData = ReturnType<typeof useGoalReport>
