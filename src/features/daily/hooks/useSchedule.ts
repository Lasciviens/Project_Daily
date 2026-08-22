import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchScheduleBlocks,
  createScheduleBlock,
  updateScheduleBlock,
  deleteScheduleBlock,
  fetchTimeBlocks,
  fetchTrainingBlocksRange,
  createTimeBlock,
  updateTimeBlock,
  deleteTimeBlock,
} from '../api/scheduleApi'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import type {
  CreateTimeBlockInput, UpdateTimeBlockInput, CreateScheduleBlockInput, UpdateScheduleBlockInput,
} from '../types'

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

// Real gap fixed (migration 077 completed the recurring model): there was no
// way to edit an existing recurring template at all before this — only
// create/delete existed at the API layer, so a schedule_blocks row, once
// created, was permanently stuck as-is short of deleting and recreating it.
export function useUpdateScheduleBlock() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:     'update_schedule_block',
    mutationFn: ({ id, patch }: { id: string; patch: UpdateScheduleBlockInput }) => updateScheduleBlock(id, patch),
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
// refresh 'calendar' since a block change may have synced a Google event, and
// 'tasks' since a block's title is mirrored FROM its linked task (never the
// other way — migration 077 retired the old bidirectional date/time sync and
// the delete-cascade-to-task behavior; the only remaining cross-table effect
// is the one-way task-title-to-block-title trigger, plus the task_id FK
// itself cascading a Task hard-delete onto its block).
function invalidateSchedule(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['schedule'] })
  qc.invalidateQueries({ queryKey: ['calendar'] })
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
//
// Real gap fixed (migration 077): this used to silently drop
// duration_minutes/category/color/google_calendar_event_id even though the
// underlying API function already accepted them — a title or duration edit
// never reached a linked Google Calendar event's remote copy, only date/time
// changes did. Every field the row has now passes through.
export function useUpdateTimeBlock() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:     'update_time_block',
    mutationFn: ({ id, patch }: { id: string; patch: UpdateTimeBlockInput; dateStr?: string; newDateStr?: string }) =>
      updateTimeBlock(id, patch),
    onSuccess: () => invalidateSchedule(qc),
  })
}

export function useDeleteTimeBlock() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'delete_time_block',
    successMessage: 'Deleted',
    mutationFn:     ({ id, dateStr: _dateStr }: { id: string; dateStr?: string }) => deleteTimeBlock(id),
    onSuccess:      () => invalidateSchedule(qc),
  })
}
