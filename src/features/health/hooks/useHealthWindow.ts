import { useMemo } from 'react'
import { getAggregationType } from '../healthMetrics'
import { summarizeWindow, windowRuleFor, type HealthWindow, type WindowKind, type WindowSummary, type DayValue } from '../healthWindowStats'
import type { DailyRange, DailyValue, SleepSummary } from '../healthAggregate'
import type { HealthMetric } from '../api/healthApi'
import { useHealthDaily, useHeartRateDaily, useSleepData } from './useHealthExport'

// The headline number of each metric for a window, computed ONCE. The section
// headline, the side panel and Daily's card all call these, so the same label
// can never show two numbers (H-02). Each read covers [fetchFrom, to] — the
// window plus the one before it — so the section chart and the panel's trend
// share one download.

export interface MetricWindow {
  daily: DailyValue[]
  summary: WindowSummary
  isLoading: boolean
  /** The previous window's data is still on screen while this one loads. */
  isPlaceholderData: boolean
  isError: boolean
}

interface WindowOverride {
  kind?: WindowKind
  todayComplete?: boolean
  isDayComplete?: (d: DayValue) => boolean
}

function opts(win: HealthWindow, todayComplete: boolean, isDayComplete?: (d: DayValue) => boolean) {
  return { from: win.from, to: win.to, today: win.today, todayComplete, isDayComplete }
}

export function useMetricWindow(metric: string, win: HealthWindow, override: WindowOverride = {}): MetricWindow {
  const q = useHealthDaily(metric, win.fetchFrom, win.to)
  const rule = windowRuleFor(getAggregationType(metric))
  const kind = override.kind ?? rule.kind
  const todayComplete = override.todayComplete ?? rule.todayComplete
  const daily = q.data
  const { isDayComplete } = override
  const summary = useMemo(
    () => summarizeWindow(kind, daily ?? [], opts(win, todayComplete, isDayComplete)),
    [kind, daily, win, todayComplete, isDayComplete],
  )
  return { daily: daily ?? EMPTY, summary, isLoading: q.isLoading, isPlaceholderData: q.isPlaceholderData, isError: q.isError }
}
const EMPTY: DailyValue[] = []

// Basal energy alone is ~1600-2400 kcal a day for this user, so a finished day
// under this total is a coverage gap (Watch off the wrist, a sync that never
// landed), not a light day. It stays in the chart and out of the average.
export const MIN_COMPLETE_DAY_KCAL = 1550

export interface EnergyWindow {
  active: DailyValue[]
  basal: DailyValue[]
  /** active + basal per day. */
  total: DailyValue[]
  activeSummary: WindowSummary
  basalSummary: WindowSummary
  totalSummary: WindowSummary
  isLoading: boolean
  isPlaceholderData: boolean
}

export function useEnergyWindow(win: HealthWindow): EnergyWindow {
  const a = useHealthDaily('active_energy', win.fetchFrom, win.to)
  const b = useHealthDaily('basal_energy_burned', win.fetchFrom, win.to)
  const activeData = a.data, basalData = b.data
  return useMemo(() => {
    const active = activeData ?? EMPTY, basal = basalData ?? EMPTY
    const byDate = new Map<string, number>()
    for (const d of [...active, ...basal]) byDate.set(d.date, (byDate.get(d.date) ?? 0) + d.value)
    const total = [...byDate.entries()].map(([date, value]) => ({ date, value })).sort((x, y) => x.date.localeCompare(y.date))
    const complete = new Set(total.filter(d => d.value > MIN_COMPLETE_DAY_KCAL).map(d => d.date))
    const isDayComplete = (d: DayValue) => complete.has(d.date)
    const o = opts(win, false, isDayComplete)
    return {
      active, basal, total,
      activeSummary: summarizeWindow('sum', active, o),
      basalSummary: summarizeWindow('sum', basal, o),
      totalSummary: summarizeWindow('sum', total, o),
      isLoading: a.isLoading || b.isLoading,
      isPlaceholderData: a.isPlaceholderData || b.isPlaceholderData,
    }
  }, [activeData, basalData, win, a.isLoading, b.isLoading, a.isPlaceholderData, b.isPlaceholderData])
}

export interface HeartWindow {
  daily: DailyRange[]
  /** Mean of each day's own average (a busy day doesn't outweigh a quiet one). */
  summary: WindowSummary
  /** Lowest min / highest max inside the window, today included. */
  lo: number | null
  hi: number | null
  isLoading: boolean
  isPlaceholderData: boolean
}

export function useHeartWindow(win: HealthWindow): HeartWindow {
  const q = useHeartRateDaily(win.fetchFrom, win.to)
  const data = q.data
  return useMemo(() => {
    const daily = data ?? []
    const avgs = daily.filter(d => d.avg != null).map(d => ({ date: d.date, value: d.avg as number }))
    const inWin = daily.filter(d => d.date >= win.from && d.date <= win.to)
    const mins = inWin.map(d => d.min).filter((v): v is number => v != null)
    const maxs = inWin.map(d => d.max).filter((v): v is number => v != null)
    return {
      daily,
      summary: summarizeWindow('average', avgs, opts(win, false)),
      lo: mins.length ? Math.min(...mins) : null,
      hi: maxs.length ? Math.max(...maxs) : null,
      isLoading: q.isLoading,
      isPlaceholderData: q.isPlaceholderData,
    }
  }, [data, win, q.isLoading, q.isPlaceholderData])
}

export interface SleepWindow {
  /** Raw rows of the nights in [fetchFrom, to]. */
  points: HealthMetric[]
  nights: SleepSummary[]
  /** Average hours asleep per night; last night always counts (it's finished). */
  summary: WindowSummary
  isLoading: boolean
  isPlaceholderData: boolean
}

export function useSleepWindow(win: HealthWindow): SleepWindow {
  const q = useSleepData(win.fetchFrom, win.to)
  const data = q.data
  return useMemo(() => {
    const nights = data?.nights ?? []
    const rule = windowRuleFor('sleep')
    return {
      points: data?.points ?? [],
      nights,
      summary: summarizeWindow(rule.kind, nights.map(n => ({ date: n.date, value: n.total })), opts(win, rule.todayComplete)),
      isLoading: q.isLoading,
      isPlaceholderData: q.isPlaceholderData,
    }
  }, [data, win, q.isLoading, q.isPlaceholderData])
}
