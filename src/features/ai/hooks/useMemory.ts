import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { useRowsDelete } from '../../../shared/hooks/useRowsDelete'
import { qk, STALE } from '../../../shared/query'
import { fetchMemories, createMemory, updateMemory } from '../api/memoryApi'
import type { AiMemory, CreateMemoryInput } from '../api/memoryApi'

export function useMemories() {
  return useQuery({ queryKey: qk.memory.all, queryFn: fetchMemories, staleTime: STALE.default })
}

export function useCreateMemory() {
  return useMutationWithFeedback({
    action:         'create_ai_memory',
    successMessage: 'Remembered',
    mutationFn:     (input: CreateMemoryInput) => createMemory(input),
    invalidates:    [qk.memory.all],
  })
}

export function useUpdateMemory() {
  return useMutationWithFeedback({
    action:     'update_ai_memory',
    successMessage: 'Memory saved',
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Pick<AiMemory, 'kind' | 'title' | 'content'>> }) =>
      updateMemory(id, patch),
    invalidates: [qk.memory.all],
  })
}

export function useDeleteMemory() {
  return useRowsDelete({ table: 'ai_memory', action: 'delete_ai_memory', invalidates: [qk.memory.all], cache: qk.memory.all })
}
