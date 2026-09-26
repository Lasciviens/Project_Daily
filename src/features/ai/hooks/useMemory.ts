import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { fetchMemories, createMemory, updateMemory, deleteMemory } from '../api/memoryApi'
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
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Pick<AiMemory, 'kind' | 'title' | 'content'>> }) =>
      updateMemory(id, patch),
    invalidates: [qk.memory.all],
  })
}

export function useDeleteMemory() {
  return useMutationWithFeedback({
    action:         'delete_ai_memory',
    successMessage: 'Deleted',
    mutationFn:     (id: string) => deleteMemory(id),
    invalidates:    [qk.memory.all],
  })
}
