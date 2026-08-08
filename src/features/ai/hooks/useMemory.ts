import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { fetchMemories, createMemory, updateMemory, deleteMemory } from '../api/memoryApi'
import type { AiMemory, CreateMemoryInput } from '../api/memoryApi'

const MEMORY_KEY = ['ai-memory'] as const

export function useMemories() {
  return useQuery({ queryKey: MEMORY_KEY, queryFn: fetchMemories })
}

export function useCreateMemory() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'create_ai_memory',
    successMessage: 'Remembered ✓',
    mutationFn:     (input: CreateMemoryInput) => createMemory(input),
    onSuccess:      () => qc.invalidateQueries({ queryKey: MEMORY_KEY }),
  })
}

export function useUpdateMemory() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:     'update_ai_memory',
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Pick<AiMemory, 'kind' | 'title' | 'content'>> }) =>
      updateMemory(id, patch),
    onSuccess:  () => qc.invalidateQueries({ queryKey: MEMORY_KEY }),
  })
}

export function useDeleteMemory() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'delete_ai_memory',
    successMessage: 'Deleted',
    mutationFn:     (id: string) => deleteMemory(id),
    onSuccess:      () => qc.invalidateQueries({ queryKey: MEMORY_KEY }),
  })
}
