import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchHevyRoutines, fetchHevyRoutineFolders, callHevyApi, deleteHevyRoutineLocal } from '../api/hevyApi'
import { toast } from '../../../app/store'

const ROUTINES_KEY = ['hevy', 'routines'] as const
const FOLDERS_KEY  = ['hevy', 'routine-folders'] as const

export function useHevyRoutines() {
  return useQuery({
    queryKey: ROUTINES_KEY,
    queryFn:  fetchHevyRoutines,
    staleTime: 5 * 60_000,
  })
}

export function useHevyRoutineFolders() {
  return useQuery({
    queryKey: FOLDERS_KEY,
    queryFn:  fetchHevyRoutineFolders,
    staleTime: 10 * 60_000,
  })
}

export function useCreateHevyRoutine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: unknown) => callHevyApi('create_routine', payload),
    onMutate: () => toast.loading('Creating routine…'),
    onSuccess: (_data, _vars, tid) => {
      qc.invalidateQueries({ queryKey: ROUTINES_KEY })
      toast.dismiss(tid as string)
      toast.success('Routine created ✓')
    },
    onError: (err, _vars, tid) => {
      toast.dismiss(tid as string)
      toast.error((err as Error).message ?? 'Failed to create routine')
    },
  })
}

export function useUpdateHevyRoutine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: unknown) => callHevyApi('update_routine', payload),
    onMutate: () => toast.loading('Saving routine…'),
    onSuccess: (_data, _vars, tid) => {
      qc.invalidateQueries({ queryKey: ROUTINES_KEY })
      toast.dismiss(tid as string)
      toast.success('Routine saved ✓')
    },
    onError: (err, _vars, tid) => {
      toast.dismiss(tid as string)
      toast.error((err as Error).message ?? 'Failed to save routine')
    },
  })
}

export function useDeleteHevyRoutineLocal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteHevyRoutineLocal(id),
    onMutate: () => toast.loading('Deleting routine…'),
    onSuccess: (_data, _vars, tid) => {
      qc.invalidateQueries({ queryKey: ROUTINES_KEY })
      toast.dismiss(tid as string)
      toast.success('Routine removed ✓')
    },
    onError: (err, _vars, tid) => {
      toast.dismiss(tid as string)
      toast.error((err as Error).message ?? 'Failed to delete routine')
    },
  })
}
