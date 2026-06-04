import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchScheduleBlocks,
  createScheduleBlock,
  deleteScheduleBlock,
  fetchTimeBlocks,
  createTimeBlock,
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
  })
}

export function useCreateTimeBlock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateTimeBlockInput) => createTimeBlock(input),
    onSuccess:  (_, vars) => qc.invalidateQueries({ queryKey: ['schedule', 'day', vars.date] }),
  })
}

export function useDeleteTimeBlock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, dateStr: _dateStr }: { id: string; dateStr: string }) => deleteTimeBlock(id),
    onSuccess:  (_, vars) => qc.invalidateQueries({ queryKey: ['schedule', 'day', vars.dateStr] }),
  })
}
