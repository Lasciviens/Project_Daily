import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { fetchBodyweightSeries, fetchLatestBodyweight } from '../api/bodyweightApi'
import { fetchHealthMetricsBatch } from '../api/healthApi'

// The ONE bodyweight read (the smart scale via Apple Health, its photo report,
// then Hevy — merged with the precedence documented in bodyweight.ts). Body, Progress, the nutrition
// coach, the PT coach and Daily should all read these instead of picking a
// table each. Invalidate qk.health.bodyweightAll after writing a weight.

/** Every day in [from, to] with a weight: [{ date, kg, fatPct, leanKg, source, fatSource, leanSource }]. */
export function useBodyweightSeries(from: string, to: string, opts: { enabled?: boolean } = {}) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: qk.health.bodyweight(from, to),
    // The scale rows go through useHealthMetricsBatch's key: the goal report reads the same three metrics over
    // the same days beside this, and the two were two identical requests. staleTime 0: a refresh still reads
    // them anew; only a read already on its way is shared.
    queryFn:  () => fetchBodyweightSeries(from, to, (names, f, t) => qc.fetchQuery({
      queryKey: qk.health.metricBatch(names, f, t),
      queryFn:  () => fetchHealthMetricsBatch(names, f, t),
      staleTime: 0,
    })),
    staleTime: STALE.default,
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
  })
}

/** The newest merged weight on or before `onOrBefore` (default: ever), or null. */
export function useLatestBodyweight(onOrBefore?: string) {
  return useQuery({
    queryKey: qk.health.bodyweightLatest(onOrBefore),
    queryFn:  () => fetchLatestBodyweight(onOrBefore),
    staleTime: STALE.default,
    placeholderData: keepPreviousData,
  })
}
