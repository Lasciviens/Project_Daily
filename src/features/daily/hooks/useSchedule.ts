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
import type { CreateTimeBlockInput, CreateScheduleBlockInput } from '../types'

export function useScheduleBlocks() {
  return useQuery({
    queryKey: ['schedule', 'blocks'],
    queryFn:  fetchScheduleBlocks,
    staleTime: 10 * 60_000,
  })
}

export function useCreateScheduleBlock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateScheduleBlockInput) => createScheduleBlock(input),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['schedule', 'blocks'] }),
  })
}

export function useDeleteScheduleBlock() {
  const qc = useQueryClient()
  return useMutation({
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
}

export function useCreateTimeBlock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateTimeBlockInput) => createTimeBlock(input),
    onSuccess:  () => invalidateSchedule(qc),
  })
}

export function useUpdateTimeBlock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, start_time, date, title }: { id: string; start_time?: string; date?: string; title?: string; dateStr: string; newDateStr?: string }) =>
      updateTimeBlock(id, { start_time, date, title }),
    onSuccess: () => invalidateSchedule(qc),
  })
}

export function useDeleteTimeBlock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, dateStr: _dateStr }: { id: string; dateStr: string }) => deleteTimeBlock(id),
    onSuccess:  () => invalidateSchedule(qc),
  })
}
