import { useMemo } from 'react'
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
import {
  SERIES_EVENT_RESET, relinkRestoredSeriesEvents, removeDeletedSeriesEvents, syncScheduleSeriesAfterSave,
} from '../../calendar/api/scheduleSeriesCalendar'
import { qk, STALE } from '../../../shared/query'
import { todayStr } from '../../../shared/utils/dateUtils'
import { repeatDaysOn, repeatsToDoBetween, repeatsToDoOn } from '../dayItems'
import type {
  CreateTimeBlockInput, UpdateTimeBlockInput, CreateScheduleBlockInput, UpdateScheduleBlockInput, ScheduleBlock,
} from '../types'
import type { TimeBlockCalendarStatus } from '../api/scheduleSyncRules'

export function useScheduleBlocks() {
  return useQuery({
    queryKey: qk.schedule.templates(),
    queryFn:  fetchScheduleBlocks,
    staleTime: STALE.long,
  })
}

/**
 * Days of repeating plans in the week strips and the month (owner, 15.10.2026:
 * the counts and dots include repeats). A day already acted on is its own task
 * and counts as one; a past day nobody ticked is missed — on its day, not open.
 */
export function useRepeatDays() {
  const { data: templates = [] } = useScheduleBlocks()
  const today = todayStr()
  return useMemo(() => ({
    /** Repeat days still to do on `day` (none before today). */
    toDoOn: (day: string) => repeatsToDoOn(templates, day, today),
    /** Any repeat day on `day` (a past one too: the day view lists it as missed). */
    on: (day: string) => repeatDaysOn(templates, day),
    toDoBetween: (from: string, to: string) => repeatsToDoBetween(templates, from, to, today),
  }), [templates, today])
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

/** A repeating plan's save and what its Google Calendar series did (147). */
export interface ScheduleBlockSaveResult {
  block:          ScheduleBlock
  calendarStatus: TimeBlockCalendarStatus
}

// Recurring templates live under qk.schedule, so the 'schedule' group covers
// every template/day/range view at once. `gcal`: the planner's "Add to Google
// Calendar" (undefined = no connection to ask with). The series' own failure
// never fails the save — it is reported once by scheduleSeriesCalendar. The
// 'schedule' group refreshes the day's Google events too (the series' instances).
export function useCreateScheduleBlock() {
  return useMutationWithFeedback({
    action:      'create_schedule_block',
    silent:      'the plan editor reports the save',
    mutationFn:  async ({ input, gcal }: { input: CreateScheduleBlockInput; gcal?: boolean }): Promise<ScheduleBlockSaveResult> => {
      const block = await createScheduleBlock(input)
      return { block, calendarStatus: await syncScheduleSeriesAfterSave(block, gcal) }
    },
    invalidates: ['schedule'],
  })
}

// Real gap fixed (migration 077 completed the recurring model): there was no
// way to edit an existing recurring template at all before this — only
// create/delete existed at the API layer, so a schedule_blocks row, once
// created, was permanently stuck as-is short of deleting and recreating it.
// Every save also brings its Google Calendar series up to date (147) — or
// adds / removes it, per `gcal`.
export function useUpdateScheduleBlock() {
  return useMutationWithFeedback({
    action:      'update_schedule_block',
    silent:      'the plan editor reports the save',
    mutationFn:  async ({ id, patch, gcal }: { id: string; patch: UpdateScheduleBlockInput; gcal?: boolean }): Promise<ScheduleBlockSaveResult> => {
      const block = await updateScheduleBlock(id, patch)
      return { block, calendarStatus: await syncScheduleSeriesAfterSave(block, gcal) }
    },
    invalidates: ['schedule'],
  })
}

/** Deletes a repeating plan with Undo; the days it became (migration 142) get
 *  their link back on Undo. Its Google Calendar series is removed right after
 *  (the calendar outbox, 147, if Google isn't reached); Undo makes a new one. */
export function useDeleteScheduleBlock() {
  return useRowsDelete({
    table: 'schedule_blocks',
    action: 'delete_schedule_block',
    invalidates: ['schedule'],
    cache: qk.schedule.all,
    afterDelete: removeDeletedSeriesEvents,
    overrides: () => SERIES_EVENT_RESET,
    afterRestore: relinkRestoredSeriesEvents,
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
