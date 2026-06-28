import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchHevyPRs, triggerInitialHevySync } from '../api/hevyApi'
import { toast } from '../../../app/store'
import { logError } from '../../../shared/utils/logError'

// ─── Queries ──────────────────────────────────────────────────────────────────

export function useHevyPRs() {
  return useQuery({
    queryKey: ['hevy', 'prs'],
    queryFn:  fetchHevyPRs,
    staleTime: 10 * 60_000,
  })
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useInitialHevySync() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: triggerInitialHevySync,
    onMutate: () => toast.loading('Syncing all Hevy data…'),
    onSuccess: (result, _, tid) => {
      toast.dismiss(tid as string)
      toast.success(`Synced ${result.workouts} workouts`)
      qc.invalidateQueries({ queryKey: ['hevy'] })
    },
    onError: (e, _, tid) => {
      toast.dismiss(tid as string)
      logError(`Initial Hevy sync failed: ${(e as Error).message}`)
      toast.error((e as Error).message ?? 'Failed')
    },
  })
}
