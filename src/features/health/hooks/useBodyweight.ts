import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { fetchBodyweightSeries, fetchLatestBodyweight } from '../api/bodyweightApi'

// The ONE bodyweight read (smart scale + Hevy + Apple Health, merged with the
// precedence documented in bodyweight.ts). Body, Progress, the nutrition
// coach, the PT coach and Daily should all read these instead of picking a
// table each. Invalidate qk.health.bodyweightAll after writing a weight.

/** Every day in [from, to] with a weight: [{ date, kg, fatPct, source, fatSource }]. */
export function useBodyweightSeries(from: string, to: string, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.health.bodyweight(from, to),
    queryFn:  () => fetchBodyweightSeries(from, to),
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
