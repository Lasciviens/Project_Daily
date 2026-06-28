import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { logError } from '../../../shared/utils/logError'
import {
  fetchHevyWorkouts,
  fetchHevyWorkoutDetail,
  triggerIncrementalHevySync,
} from '../api/hevyApi'
import { toast } from '../../../app/store'

// ─── Queries ──────────────────────────────────────────────────────────────────

export function useHevyWorkouts(opts: {
  limit?: number
  offset?: number
  from?: string
  to?: string
} = {}) {
  return useQuery({
    queryKey: ['hevy', 'workouts', opts],
    queryFn:  () => fetchHevyWorkouts(opts),
    staleTime: 5 * 60_000,
  })
}

export function useHevyWorkoutDetail(id: string | null) {
  return useQuery({
    queryKey: ['hevy', 'workout', id],
    queryFn:  () => fetchHevyWorkoutDetail(id!),
    enabled:  !!id,
    staleTime: 10 * 60_000,
  })
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useIncrementalHevySync() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: triggerIncrementalHevySync,
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['hevy'] })
      toast.success(`Synced: +${result.updated} updated, ${result.deleted} deleted`)
    },
    onError: (e) => {
      logError(`Incremental Hevy sync failed: ${(e as Error).message}`)
      toast.error((e as Error).message ?? 'Failed')
    },
  })
}
