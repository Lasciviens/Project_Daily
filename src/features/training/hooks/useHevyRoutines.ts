import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { fetchHevyRoutines, fetchHevyRoutineFolders, callHevyApi } from '../api/hevyApi'

export function useHevyRoutines() {
  return useQuery({
    queryKey: qk.hevy.routines(),
    queryFn:  fetchHevyRoutines,
    staleTime: STALE.default,
  })
}

export function useHevyRoutineFolders() {
  return useQuery({
    queryKey: qk.hevy.routineFolders(),
    queryFn:  fetchHevyRoutineFolders,
    staleTime: STALE.long,
  })
}

// Routine edits feed Progress (routine targets and the current program), so
// they refresh the whole training group, not only the routine list.
export function useCreateHevyRoutine() {
  return useMutationWithFeedback({
    action:         'create_routine',
    loadingMessage: 'Creating routine…',
    successMessage: 'Routine created',
    mutationFn:     (payload: unknown) => callHevyApi('create_routine', payload),
    invalidates:    ['training'],
  })
}

export function useUpdateHevyRoutine() {
  return useMutationWithFeedback({
    action:         'update_routine',
    loadingMessage: 'Saving routine…',
    successMessage: 'Routine saved',
    mutationFn:     (payload: unknown) => callHevyApi('update_routine', payload),
    invalidates:    ['training'],
  })
}
