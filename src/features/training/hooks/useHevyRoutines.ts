import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { fetchHevyRoutines, fetchHevyRoutineFolders, callHevyApi, createHevyRoutineFolder } from '../api/hevyApi'

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

/** A routine folder made in Hevy (POST /v1/routine_folders), then stored here. */
export function useCreateHevyRoutineFolder() {
  return useMutationWithFeedback({
    action:         'create_routine_folder',
    loadingMessage: 'Creating the folder in Hevy…',
    successMessage: (r: Awaited<ReturnType<typeof createHevyRoutineFolder>>, title: string) => r.stored
      ? `Folder “${title}” created`
      : `Folder “${title}” created in Hevy — it shows here after the next Sync`,
    mutationFn:     createHevyRoutineFolder,
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
