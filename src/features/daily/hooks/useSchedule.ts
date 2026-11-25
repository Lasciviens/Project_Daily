import { useMemo } from 'react'
import { queryOptions, useQuery } from '@tanstack/react-query'
import {
  fetchScheduleBlocks,
  fetchTimeBlocks,
  fetchTimeBlock,
  fetchTimeBlockByTaskId,
  fetchTimeBlocksRange,
  fetchTrainingBlocksRange,
  fetchTrainingDayTasks,
  updateTimeBlock,
} from '../api/scheduleApi'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { useRowsDelete } from '../../../shared/hooks/useRowsDelete'
import { BLOCK_EVENT_RESET, SERIES_EVENT_RESET } from '../../calendar/areas/restoreResets'
import { drainICloudSoon } from '../../calendar/areas/appleAreas'
import { qk, STALE } from '../../../shared/query'
import { todayStr } from '../../../shared/utils/dateUtils'
import { repeatDayKeys, repeatDaysOn, repeatsToDoBetween, repeatsToDoOn } from '../dayItems'
import { TASK_GOOGLE_RESET, useDayTasks } from '../../todo/hooks/useTodos'
import type { Task } from '../../todo/types'
import type { UpdateTimeBlockInput } from '../types'

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
 * and counts as one; so is a day whose task was made on its day (156) —
 * `tasks`: the range the caller reads (and today's list), so no day counts
 * twice. A past day nobody ticked is missed — on its day, not open.
 */
export function useRepeatDays(tasks: readonly Task[] = [], { withoutTraining = false }: { withoutTraining?: boolean } = {}) {
  const { data: allTemplates = [] } = useScheduleBlocks()
  // Personal → Month leaves training repeats to its Training line while that kind is shown.
  const templates = useMemo(
    () => (withoutTraining ? allTemplates.filter(t => t.category !== 'training') : allTemplates),
    [allTemplates, withoutTraining],
  )
  const today = todayStr()
  const todayList = useDayTasks(today)
  const asTasks = useMemo(
    () => repeatDayKeys([...tasks, ...todayList.repeatDays, ...todayList.open, ...todayList.done, ...todayList.cancelled]),
    [tasks, todayList.repeatDays, todayList.open, todayList.done, todayList.cancelled],
  )
  return useMemo(() => ({
    /** Repeat days still to do on `day` (none before today), a day that is a task not again. */
    toDoOn: (day: string) => repeatsToDoOn(templates, day, today, asTasks),
    /** Any repeat day on `day` (a past one too: the day view lists it as missed). */
    on: (day: string) => repeatDaysOn(templates, day),
    /** Repeat days that passed with no task of their own (no tick, no split): missed on their day (156). */
    missedOn: (day: string) => (day < today ? repeatDaysOn(templates, day, asTasks) : 0),
    toDoBetween: (from: string, to: string) => repeatsToDoBetween(templates, from, to, today, asTasks),
  }), [templates, today, asTasks])
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

/** Deletes a repeating plan with Undo; the days it became (migration 142) get
 *  their link back on Undo. Its Apple Calendar series goes through the queue
 *  (sent right after); Undo makes a new one. Its days nobody acted on yet (an open day's task, 156) go with it and come
 *  back with Undo (their Google Tasks are made again). */
export function useDeleteScheduleBlock() {
  return useRowsDelete({
    table: 'schedule_blocks',
    action: 'delete_schedule_block',
    invalidates: ['taskGraph'],
    cache: qk.schedule.all,
    afterDelete: () => drainICloudSoon(),
    overrides: () => ({ ...SERIES_EVENT_RESET, ...TASK_GOOGLE_RESET }),
    afterRestore: () => drainICloudSoon(),
  })
}

export const timeBlocksQuery = (dateStr: string) => queryOptions({
  queryKey: qk.schedule.day(dateStr),
  queryFn:  () => fetchTimeBlocks(dateStr),
  staleTime: STALE.default,
})

export function useTimeBlocks(dateStr: string) {
  return useQuery(timeBlocksQuery(dateStr))
}

export const trainingBlocksQuery = (from: string, to: string) => queryOptions({
  queryKey: qk.schedule.trainingRange(from, to),
  queryFn:  () => fetchTrainingBlocksRange(from, to),
  staleTime: STALE.default,
})

export function useTrainingBlocks(from: string, to: string) {
  return useQuery(trainingBlocksQuery(from, to))
}

/** Every slot in a range (the month calendar's plans line): one read for the month, never one per day. */
export function useTimeBlocksRange(from: string, to: string, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.schedule.range(from, to),
    queryFn:  () => fetchTimeBlocksRange(from, to),
    staleTime: STALE.default,
    enabled,
  })
}

export function useTrainingDayTasks(from: string, to: string) {
  return useQuery({
    queryKey: qk.schedule.trainingDays(from, to),
    queryFn:  () => fetchTrainingDayTasks(from, to),
    staleTime: STALE.default,
  })
}

// Every one-off block write refreshes the whole task graph: consumers read
// schedule under different sub-keys (day, training range, by-task, block), and
// 'tasks' because a block's title is mirrored FROM its linked task (migration
// 077 retired the old bidirectional date/time sync and the delete-cascade-to-
// task behaviour; the only cross-table effects left are the one-way task-title
// trigger and task_id's ON DELETE CASCADE).
//
// Covers postpone (+30m / +1d) and the plan editor's own block writes.
// `report: false` for the plan editor, which reports the whole save itself.
//
// Real gap fixed (migration 077): this used to silently drop
// duration_minutes/category/color even though the
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
 * Deletes a one-off slot with Undo (the task it belongs to stays). Its Apple
 * Calendar event goes through the queue (sent right after); Undo makes a new one.
 */
export function useDeleteTimeBlock() {
  return useRowsDelete({
    table: 'time_blocks',
    action: 'delete_time_block',
    invalidates: ['taskGraph'],
    cache: qk.schedule.all,
    afterDelete: () => drainICloudSoon(),
    overrides: () => BLOCK_EVENT_RESET,
    afterRestore: () => drainICloudSoon(),
  })
}
