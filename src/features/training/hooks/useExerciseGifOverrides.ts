import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import {
  fetchExerciseGifOverrides, upsertExerciseGifOverride, deleteExerciseGifOverride,
  type ExerciseGifOverride,
} from '../api/exerciseGifOverrideApi'

const OVERRIDES_KEY = ['exercise-gif-overrides'] as const

export function useExerciseGifOverrides() {
  return useQuery({ queryKey: OVERRIDES_KEY, queryFn: fetchExerciseGifOverrides, staleTime: 5 * 60_000 })
}

export function useUpsertExerciseGifOverride() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'upsert_exercise_gif_override',
    successMessage: 'GIF updated',
    mutationFn:     ({ templateId, gifUrl, source }: { templateId: string; gifUrl: string; source: ExerciseGifOverride['source'] }) =>
      upsertExerciseGifOverride(templateId, gifUrl, source),
    onSuccess:      () => qc.invalidateQueries({ queryKey: OVERRIDES_KEY }),
  })
}

export function useDeleteExerciseGifOverride() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'delete_exercise_gif_override',
    successMessage: 'Reverted to automatic match',
    mutationFn:     (templateId: string) => deleteExerciseGifOverride(templateId),
    onSuccess:      () => qc.invalidateQueries({ queryKey: OVERRIDES_KEY }),
  })
}
