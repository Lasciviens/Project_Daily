import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchScheduleBlocks,
  createScheduleBlock,
  deleteScheduleBlock,
  fetchTimeBlocks,
  fetchTrainingBlocksRange,
  createTimeBlock,
  updateTimeBlock,
  deleteTimeBlock,
} from '../api/scheduleApi'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import type { CreateTimeBlockInput, CreateScheduleBlockInput } from '../types'

export function useScheduleBlocks() {
  return useQuery({
    queryKey: ['schedule', 'blocks'],
    queryFn:  fetchScheduleBlocks,
    staleTime: 10 * 60_000,
  })
}

// NOT using useMutationWithFeedback here — its only consumer
// (UnifiedPlanModal) already wraps this in its own complete
// toast.loading/success/error flow around mutateAsync; adding the wrapper's
// automatic error toast on top would double-toast the same failure.
export function useCreateScheduleBlock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateScheduleBlockInput) => createScheduleBlock(input),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['schedule', 'blocks'] }),
  })
}

export function useDeleteScheduleBlock() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:     'delete_schedule_block',
    mutationFn: (id: string) => deleteScheduleBlock(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['schedule', 'blocks'] }),
  })
}

export function useTimeBlocks(dateStr: string) {
  return useQuery({
    queryKey: ['schedule', 'day', dateStr],
    queryFn:  () => fetchTimeBlocks(dateStr),
    staleTime: 5 * 60_000,
  })
}

export function useTrainingBlocks(from: string, to: string) {
  return useQuery({
    queryKey: ['schedule', 'training-range', from, to],
    queryFn:  () => fetchTrainingBlocksRange(from, to),
    staleTime: 5 * 60_000,
  })
}

// All three invalidate the WHOLE 'schedule' namespace (day + training-range +
// blocks) so every consumer refreshes — the Work timeline, Training calendar,
// Home's next-session card all read schedule under different sub-keys. Also
// refresh 'calendar' since a block change may have synced a Google event.
function invalidateSchedule(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['schedule'] })
  qc.invalidateQueries({ queryKey: ['calendar'] })
  // A block edit/delete can cascade to its linked task via migration 043's
  // sync_task_from_time_block trigger (date/time propagation on update,
  // soft-cancel on delete), so task views must refresh too — mirrors the
  // reverse direction (useUpdateTask/useDeleteTask already invalidate schedule).
  qc.invalidateQueries({ queryKey: ['tasks'] })
}

// NOT using useMutationWithFeedback here — both consumers (UnifiedPlanModal,
// LogWorkoutModal) already wrap this in their own complete toast flow around
// mutateAsync; the wrapper's automatic error toast would double-fire.
export function useCreateTimeBlock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateTimeBlockInput) => createTimeBlock(input),
    onSuccess:  () => invalidateSchedule(qc),
  })
}

// Covers drag-reposition, postpone, and inline rename — all frequent,
// autosave-like edits, so success stays silent (matches the rest of the
// app's "edits feel live" convention) while failures always toast + log.
export function useUpdateTimeBlock() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:     'update_time_block',
    mutationFn: ({ id, start_time, date, title }: { id: string; start_time?: string; date?: string; title?: string; dateStr: string; newDateStr?: string }) =>
      updateTimeBlock(id, { start_time, date, title }),
    onSuccess: () => invalidateSchedule(qc),
  })
}

export function useDeleteTimeBlock() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'delete_time_block',
    successMessage: 'Deleted',
    mutationFn:     ({ id, dateStr: _dateStr }: { id: string; dateStr: string }) => deleteTimeBlock(id),
    onSuccess:      () => invalidateSchedule(qc),
  })
}
