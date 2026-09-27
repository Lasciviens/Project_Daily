import { useCallback, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { localDayOf, shiftDateStr, todayStr } from '../../../shared/utils/dateUtils'
import { useHealthDaily } from '../hooks/useHealthExport'
import { useBodyweightSeries } from '../hooks/useBodyweight'
import { useBodyCompositionReports } from '../hooks/useBodyCompositionReports'
import { useDayTargets } from '../../daily/hooks/useDayTargets'
import { fetchEatenDiaryRows } from './cutDiaryApi'
import { buildCutReport, type CutReport, type EnergyDay, type ScaleReading } from './energyBalance'

export type CutWindow = 14 | 28 | 56

export interface CutSettings { goalWeightKg: number | null; cutStartDate: string | null }

// Goal weight and cut start are per-viewer conveniences (not synced): the
// report works without them, they only add a projection and the early-weeks
// water note. Storage can be blocked, so every access is guarded.
const SETTINGS_KEY = 'lasci.cutReport.settings'
function readSettings(): CutSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { goalWeightKg: null, cutStartDate: null }
    const v = JSON.parse(raw) as Partial<CutSettings>
    return {
      goalWeightKg: typeof v.goalWeightKg === 'number' && v.goalWeightKg > 25 && v.goalWeightKg < 300 ? v.goalWeightKg : null,
      cutStartDate: typeof v.cutStartDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.cutStartDate) ? v.cutStartDate : null,
    }
  } catch { return { goalWeightKg: null, cutStartDate: null } }
}

export interface CutReportData {
  report: CutReport | null
  from: string
  to: string
  goal: 'cut' | 'maintain' | 'gain'
  targetKcal: number
  targetProtein: number
  settings: CutSettings
  setSettings: (next: CutSettings) => void
  isLoading: boolean
  isError: boolean
}

/** Everything the cut report needs for the last `windowDays` complete days
 *  (today is left out — its diary and energy aren't finished). */
export function useCutReport(windowDays: CutWindow): CutReportData {
  const today = todayStr()
  const to = shiftDateStr(today, -1)
  const from = shiftDateStr(to, -(windowDays - 1))

  const diary = useQuery({
    queryKey: qk.health.cutDiary(from, to),
    queryFn: () => fetchEatenDiaryRows(from, to),
    staleTime: STALE.default,
    placeholderData: keepPreviousData,
  })
  const active = useHealthDaily('active_energy', from, to)
  const basal = useHealthDaily('basal_energy_burned', from, to)
  // Six days before the window feed the first moving-average points; today's
  // morning weigh-in reflects yesterday.
  const weights = useBodyweightSeries(shiftDateStr(from, -6), today)
  const scale = useBodyCompositionReports()
  const { targets, isLoaded: targetsLoaded } = useDayTargets()

  const [settings, setSettingsState] = useState<CutSettings>(readSettings)
  const setSettings = useCallback((next: CutSettings) => {
    setSettingsState(next)
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)) } catch { /* storage blocked */ }
  }, [])

  const diaryRows = diary.data, activeRows = active.data, basalRows = basal.data
  const weightRows = weights.data, scaleRows = scale.data

  const report = useMemo(() => {
    if (!diaryRows || !activeRows || !basalRows || !weightRows) return null
    const energy = new Map<string, EnergyDay>()
    for (const d of activeRows) energy.set(d.date, { date: d.date, activeKcal: d.value, basalKcal: null })
    for (const d of basalRows) energy.set(d.date, { ...(energy.get(d.date) ?? { date: d.date, activeKcal: null }), basalKcal: d.value })
    const scaleReadings: ScaleReading[] = (scaleRows ?? []).flatMap(r => {
      const date = localDayOf(r.measured_at)
      return date ? [{ date, weightKg: r.weight_kg, fatMassKg: r.body_fat_mass_kg, leanMassKg: r.lean_body_mass_kg }] : []
    })
    return buildCutReport({
      from, to,
      intake: diaryRows.map(r => ({ date: r.date, kcal: Number(r.calories) || 0, proteinG: Number(r.protein_g) || 0 })),
      energy: [...energy.values()],
      weights: weightRows.map(p => ({ date: p.date, kg: p.kg })),
      scale: scaleReadings,
      goal: targets.goal,
      targetKcal: targetsLoaded ? targets.calories : null,
      goalWeightKg: settings.goalWeightKg,
      cutStartDate: settings.cutStartDate,
    })
  }, [diaryRows, activeRows, basalRows, weightRows, scaleRows, from, to, targets.goal, targets.calories, targetsLoaded, settings])

  return {
    report, from, to,
    goal: targets.goal,
    targetKcal: targets.calories,
    targetProtein: targets.protein,
    settings, setSettings,
    isLoading: diary.isLoading || active.isLoading || basal.isLoading || weights.isLoading,
    isError: diary.isError || active.isError || basal.isError || weights.isError,
  }
}
