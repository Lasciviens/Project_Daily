import { useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { useRowsDelete } from '../../../shared/hooks/useRowsDelete'
import {
  fetchExerciseGifOverrides, upsertExerciseGifOverride, type ExerciseGifOverride } from '../api/exerciseGifOverrideApi'

const OVERRIDES_KEY = qk.training.exerciseGifOverrides

export function useExerciseGifOverrides() {
  return useQuery({ queryKey: OVERRIDES_KEY, queryFn: fetchExerciseGifOverrides, staleTime: STALE.default })
}

export function useUpsertExerciseGifOverride() {
  return useMutationWithFeedback({
    action:         'upsert_exercise_gif_override',
    successMessage: 'GIF updated',
    mutationFn:     ({ templateId, gifUrl, source }: { templateId: string; gifUrl: string; source: ExerciseGifOverride['source'] }) =>
      upsertExerciseGifOverride(templateId, gifUrl, source),
    invalidates:    [OVERRIDES_KEY],
  })
}

export function useDeleteExerciseGifOverride() {
  return useRowsDelete({ table: 'exercise_gif_overrides', action: 'delete_exercise_gif_override', invalidates: [OVERRIDES_KEY], cache: OVERRIDES_KEY })
}
