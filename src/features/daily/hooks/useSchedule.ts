import { queryOptions, useQuery } from '@tanstack/react-query'
import {
  fetchScheduleBlocks,
  createScheduleBlock,
  updateScheduleBlock,
  fetchTimeBlocks,
  fetchTimeBlock,
  fetchTimeBlockByTaskId,
  fetchTrainingBlocksRange,
  createTimeBlock,
  updateTimeBlock,
} from '../api/scheduleApi'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { useRowsDelete } from '../../../shared/hooks/useRowsDelete'
import { deleteRows } from '../../../shared/utils/deletedRows'
import { BLOCK_EVENT_RESET, relinkRestoredBlockEvents, removeDeletedBlockEvents } from '../../calendar/api/deletedBlockEvents'
import { qk, STALE } from '../../../shared/query'
import type {
  CreateTimeBlockInput, UpdateTimeBlockInput, CreateScheduleBlockInput, UpdateScheduleBlockInput,
} from '../types'

export function useScheduleBlocks() {
  return useQuery({
    queryKey: qk.schedule.templates(),
    queryFn:  fetchScheduleBlocks,
    staleTime: STALE.long,
  })
}

/** One recurring template by id — a projection of the templates list (one request for every consumer). */
export function useScheduleBlock(id: string | null | undefined) {
  return useQuery({
    queryKey: qk.schedule.templates(),
    queryFn:  fetchScheduleBlocks,
    staleTime: STALE.long,
    enabled: !!id,
    select: blocks => blocks.find(b => b.id === id) ?? null,
  })
}

/** One one-off block by id (entity popups re-read it, never trust a list row). */
export function useTimeBlock(id: string | null | undefined) {
  return useQuery({
    queryKey: qk.schedule.block(id ?? ''),
    queryFn:  () => fetchTimeBlock(id as string),
    enabled: !!id,
    staleTime: 0,
  })
}

/**
 * A task's linked one-off block (null = none). staleTime 0: the plan editor
 * decides "update the existing block" vs "insert one" off this value, so it
 * must reflect the server when the editor opens. Shared options so the
 * editor's one-shot `queryClient.fetchQuery` and the hook use one definition.
 */
export const linkedTimeBlockQuery = (taskId: string) => queryOptions({
  queryKey: qk.schedule.byTask(taskId),
  queryFn:  () => fetchTimeBlockByTaskId(taskId),
  staleTime: 0,
})

// Recurring templates live under qk.schedule, so the 'schedule' group covers
// every template/day/range view at once.
export function useCreateScheduleBlock() {
  return useMutationWithFeedback({
    action:      'create_schedule_block',
    silent:      'the plan editor reports the save',
    mutationFn:  (input: CreateScheduleBlockInput) => createScheduleBlock(input),
    invalidates: ['schedule'],
  })
}

// Real gap fixed (migration 077 completed the recurring model): there was no
// way to edit an existing recurring template at all before this — only
// create/delete existed at the API layer, so a schedule_blocks row, once
// created, was permanently stuck as-is short of deleting and recreating it.
export function useUpdateScheduleBlock() {
  return useMutationWithFeedback({
    action:      'update_schedule_block',
    silent:      'the plan editor reports the save',
    mutationFn:  ({ id, patch }: { id: string; patch: UpdateScheduleBlockInput }) => updateScheduleBlock(id, patch),
    invalidates: ['schedule'],
  })
}

/** Deletes a weekly plan with Undo; the days it became (migration 142) get their link back on Undo. */
export function useDeleteScheduleBlock() {
  return useRowsDelete({
    table: 'schedule_blocks',
    action: 'delete_schedule_block',
    invalidates: ['schedule'],
    cache: qk.schedule.all,
  })
}

export function useTimeBlocks(dateStr: string) {
  return useQuery({
    queryKey: qk.schedule.day(dateStr),
    queryFn:  () => fetchTimeBlocks(dateStr),
    staleTime: STALE.default,
  })
}

export function useTrainingBlocks(from: string, to: string) {
  return useQuery({
    queryKey: qk.schedule.trainingRange(from, to),
    queryFn:  () => fetchTrainingBlocksRange(from, to),
    staleTime: STALE.default,
  })
}

// Every one-off block write refreshes the whole task graph: consumers read
// schedule under different sub-keys (day, training range, by-task, block),
// 'calendar' because a block change may have synced a Google event, and
// 'tasks' because a block's title is mirrored FROM its linked task (migration
// 077 retired the old bidirectional date/time sync and the delete-cascade-to-
// task behaviour; the only cross-table effects left are the one-way task-title
// trigger and task_id's ON DELETE CASCADE).
export function useCreateTimeBlock() {
  return useMutationWithFeedback({
    action:      'create_time_block',
    silent:      'the plan editor reports the save',
    mutationFn:  (input: CreateTimeBlockInput) => createTimeBlock(input),
    invalidates: ['taskGraph'],
  })
}

// Covers postpone (+30m / +1d) and the plan editor's own block writes.
// mutateAsync resolves the typed calendarStatus. `report: false` for the plan
// editor, which reports the whole save itself.
//
// Real gap fixed (migration 077): this used to silently drop
// duration_minutes/category/color/google_calendar_event_id even though the
// underlying API function already accepted them. Every field now passes through.
export function useUpdateTimeBlock({ report = true }: { report?: boolean } = {}) {
  return useMutationWithFeedback({
    action:      'update_time_block',
    mutationFn:  ({ id, patch }: { id: string; patch: UpdateTimeBlockInput; dateStr?: string; newDateStr?: string }) =>
      updateTimeBlock(id, patch),
    successMessage: (_r, { patch }) => (!report ? undefined
      : patch.date !== undefined ? 'Slot moved to another day'
      : patch.start_time !== undefined ? 'Slot moved'
      : patch.title !== undefined ? 'Slot renamed'
      : 'Slot saved'),
    invalidates: ['taskGraph'],
  })
}

/**
 * Deletes a one-off slot with Undo (the task it belongs to stays). Its Google
 * Calendar event is removed right after; Undo makes a new one.
 */
export function useDeleteTimeBlock() {
  return useRowsDelete({
    table: 'time_blocks',
    action: 'delete_time_block',
    invalidates: ['taskGraph'],
    cache: qk.schedule.all,
    afterDelete: removeDeletedBlockEvents,
    overrides: () => BLOCK_EVENT_RESET,
    afterRestore: relinkRestoredBlockEvents,
  })
}

/** The plan editor turning a task's slot off: one step of its save, which reports the result. */
export function useRemoveSlotOnSave() {
  return useMutationWithFeedback({
    action: 'delete_time_block',
    silent: "a step of the plan editor's save",
    mutationFn: async (id: string) => { await removeDeletedBlockEvents(await deleteRows('time_blocks', [id])) },
    invalidates: ['taskGraph'],
  })
}
