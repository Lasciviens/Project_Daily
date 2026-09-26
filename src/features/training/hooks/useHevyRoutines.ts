import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { fetchHevyRoutines, fetchHevyRoutineFolders, callHevyApi, deleteHevyRoutineLocal } from '../api/hevyApi'

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

export function useCreateHevyRoutine() {
  return useMutationWithFeedback({
    action:         'create_routine',
    loadingMessage: 'Creating routine…',
    successMessage: 'Routine created',
    mutationFn:     (payload: unknown) => callHevyApi('create_routine', payload),
    invalidates:    [qk.hevy.routines()],
  })
}

export function useUpdateHevyRoutine() {
  return useMutationWithFeedback({
    action:         'update_routine',
    loadingMessage: 'Saving routine…',
    successMessage: 'Routine saved',
    mutationFn:     (payload: unknown) => callHevyApi('update_routine', payload),
    invalidates:    [qk.hevy.routines()],
  })
}

export function useDeleteHevyRoutineLocal() {
  return useMutationWithFeedback({
    action:         'delete_routine_local',
    loadingMessage: 'Deleting routine…',
    successMessage: 'Routine removed',
    mutationFn:     (id: string) => deleteHevyRoutineLocal(id),
    invalidates:    [qk.hevy.routines()],
  })
}
