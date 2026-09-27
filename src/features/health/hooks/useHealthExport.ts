import { useCallback } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  fetchHealthMetricSeries, fetchHealthMetricsBatch, fetchLatestHealthValue, fetchLatestHealthValues,
  fetchHealthWorkoutSummaries, fetchHealthWorkout, upsertManualSleepEntry,
  type HealthMetric, type ManualSleepInput,
} from '../api/healthApi'
import {
  computeDailySeries, computeHourlyBuckets, computeHeartRateDailySeries, computeHeartRateHourlySeries,
  computeSleepSummary, sleepNightKey,
  type DailyValue, type HourlyValue, type DailyRange, type HourlyRange, type SleepSummary,
} from '../healthAggregate'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { shiftDateStr } from '../../../shared/utils/dateUtils'
import { qk, STALE } from '../../../shared/query'

// Every Health read goes through here. Aggregation runs in each query's
// `select`, so it is memoised per downloaded page set instead of re-running on
// every render, and all views of one metric+range share ONE download (the raw
// points live under qk.health.metricSeries). `placeholderData:
// keepPreviousData` keeps the previous window on screen while the next one
// loads, instead of blanking every chart on each date step (H-16).

/** Raw points for one metric — for views that need the rows themselves (the
 *  sleep timeline, raw-data list). Prefer the aggregated hooks below. */
export function useHealthMetricSeries(metricName: string, fromDate: string, toDate: string, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.health.metricSeries(metricName, fromDate, toDate),
    queryFn:  () => fetchHealthMetricSeries(metricName, fromDate, toDate),
    staleTime: STALE.default,
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
  })
}

/** One number per day for a sum/average/latest metric over [from, to]. */
export function useHealthDaily(metricName: string, fromDate: string, toDate: string, opts: { enabled?: boolean } = {}) {
  const select = useCallback((pts: HealthMetric[]): DailyValue[] => computeDailySeries(metricName, pts), [metricName])
  return useQuery({
    queryKey: qk.health.metricSeries(metricName, fromDate, toDate),
    queryFn:  () => fetchHealthMetricSeries(metricName, fromDate, toDate),
    select,
    staleTime: STALE.default,
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
  })
}

/** The 24 hourly values of one day (null = no reading that hour). Reads the
 *  same [fetchFrom, date] range the day's window already downloaded, so the
 *  Day chart costs no extra request. */
export function useHealthHourly(metricName: string, date: string, fetchFrom: string = date) {
  const select = useCallback(
    (pts: HealthMetric[]): HourlyValue[] => computeHourlyBuckets(metricName, pts.filter(p => p.date === date)),
    [metricName, date],
  )
  return useQuery({
    queryKey: qk.health.metricSeries(metricName, fetchFrom, date),
    queryFn:  () => fetchHealthMetricSeries(metricName, fetchFrom, date),
    select,
    staleTime: STALE.default,
    placeholderData: keepPreviousData,
  })
}

/** Heart rate's min/avg/max per day (null fields when a day has none). */
export function useHeartRateDaily(fromDate: string, toDate: string) {
  return useQuery({
    queryKey: qk.health.metricSeries('heart_rate', fromDate, toDate),
    queryFn:  () => fetchHealthMetricSeries('heart_rate', fromDate, toDate),
    select:   selectHeartRateDaily,
    staleTime: STALE.default,
    placeholderData: keepPreviousData,
  })
}
function selectHeartRateDaily(pts: HealthMetric[]): DailyRange[] { return computeHeartRateDailySeries(pts) }

/** Heart rate's min/avg/max per hour of one day (null = no reading). */
export function useHeartRateHourly(date: string, fetchFrom: string = date) {
  const select = useCallback((pts: HealthMetric[]): HourlyRange[] => computeHeartRateHourlySeries(pts.filter(p => p.date === date)), [date])
  return useQuery({
    queryKey: qk.health.metricSeries('heart_rate', fetchFrom, date),
    queryFn:  () => fetchHealthMetricSeries('heart_rate', fetchFrom, date),
    select,
    staleTime: STALE.default,
    placeholderData: keepPreviousData,
  })
}

export interface SleepData { points: HealthMetric[]; nights: SleepSummary[] }

function sleepDataInRange(pts: HealthMetric[], fromDate: string, toDate: string): SleepData {
  const points = pts.filter(p => sleepNightKey(p) >= fromDate && sleepNightKey(p) <= toDate)
  return { points, nights: computeSleepSummary(points) }
}

/** Nights whose WAKE day is in [from, to], plus the raw rows. Fetches one day
 *  earlier because a session that began before midnight can be stored under
 *  the previous date. */
export function useSleepData(fromDate: string, toDate: string, opts: { enabled?: boolean } = {}) {
  const select = useCallback((pts: HealthMetric[]) => sleepDataInRange(pts, fromDate, toDate), [fromDate, toDate])
  const fetchFrom = shiftDateStr(fromDate, -1)
  return useQuery({
    queryKey: qk.health.metricSeries('sleep_analysis', fetchFrom, toDate),
    queryFn:  () => fetchHealthMetricSeries('sleep_analysis', fetchFrom, toDate),
    select,
    staleTime: STALE.default,
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
  })
}

export interface MetricBatch {
  points: Record<string, HealthMetric[]>
  daily: Record<string, DailyValue[]>
}

function selectBatch(raw: Record<string, HealthMetric[]>): MetricBatch {
  const daily: Record<string, DailyValue[]> = {}
  for (const [m, pts] of Object.entries(raw)) daily[m] = computeDailySeries(m, pts)
  return { points: raw, daily }
}

/** Several metrics over one range in ONE request (the mini-card grids). */
export function useHealthMetricsBatch(metricNames: readonly string[], fromDate: string, toDate: string, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.health.metricBatch(metricNames, fromDate, toDate),
    queryFn:  () => fetchHealthMetricsBatch(metricNames, fromDate, toDate),
    select:   selectBatch,
    staleTime: STALE.default,
    placeholderData: keepPreviousData,
    enabled: (opts.enabled ?? true) && metricNames.length > 0,
  })
}

/** The newest reading EVER of a point-in-time metric, on or before a day
 *  when given — `{ value, date }` or null. */
export function useLatestHealthValue(metricName: string, onOrBefore?: string) {
  return useQuery({
    queryKey: qk.health.latest(metricName, onOrBefore),
    queryFn:  () => fetchLatestHealthValue(metricName, onOrBefore),
    staleTime: STALE.default,
    placeholderData: keepPreviousData,
  })
}

/** Batch form of useLatestHealthValue (one query key for a whole grid). */
export function useLatestHealthValues(metricNames: readonly string[], onOrBefore?: string) {
  return useQuery({
    queryKey: qk.health.latestMany(metricNames, onOrBefore),
    queryFn:  () => fetchLatestHealthValues(metricNames, onOrBefore),
    staleTime: STALE.default,
    placeholderData: keepPreviousData,
    enabled: metricNames.length > 0,
  })
}

/** Workout rows (no raw payload) that started inside [from, to]. */
export function useHealthWorkoutSummaries(fromDate: string, toDate: string) {
  return useQuery({
    queryKey: qk.health.workoutSummaries(fromDate, toDate),
    queryFn:  () => fetchHealthWorkoutSummaries(fromDate, toDate),
    staleTime: STALE.default,
    placeholderData: keepPreviousData,
  })
}

/** One workout with its raw payload — only while its detail is open. */
export function useHealthWorkout(id: string | null) {
  return useQuery({
    queryKey: qk.health.workout(id ?? ''),
    queryFn:  () => fetchHealthWorkout(id as string),
    staleTime: STALE.long,
    enabled: !!id,
  })
}

// Logs a night the Watch wasn't worn for (or corrects an existing manual
// entry) as source: 'manual' — see upsertManualSleepEntry for the
// Deep/Core/REM split + upsert-not-insert logic.
export function useAddManualSleep() {
  return useMutationWithFeedback({
    action:         'add_manual_sleep',
    successMessage: 'Sleep entry saved',
    mutationFn:     (input: ManualSleepInput) => upsertManualSleepEntry(input),
    invalidates:    [qk.health.metricSeriesAll('sleep_analysis')],
  })
}
