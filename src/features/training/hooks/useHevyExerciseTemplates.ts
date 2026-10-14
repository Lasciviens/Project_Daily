import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import {
  createHevyExerciseTemplate, fetchHevyExerciseHistory, fetchHevyExerciseTemplate, fetchHevyExerciseTemplates,
  fetchHevyExerciseThumbnails,
} from '../api/hevyApi'
import { historyStartDate, type HistoryRange } from '../exerciseHistory'
import type { CustomExercisePayload } from '../hevyEnums'

export function useHevyExerciseTemplates() {
  return useQuery({
    queryKey: qk.hevy.templates(),
    queryFn:  fetchHevyExerciseTemplates,
    staleTime: STALE.long,
  })
}

/** One exercise for its popup, loaded by id. */
export function useHevyExerciseTemplate(id: string) {
  return useQuery({
    queryKey: qk.hevy.template(id),
    queryFn:  () => fetchHevyExerciseTemplate(id),
    staleTime: STALE.long,
  })
}

/** template id → Hevy's picture, shared by every thumbnail on a page. */
export function useHevyExerciseThumbnails() {
  return useQuery({
    queryKey: qk.hevy.thumbnails(),
    queryFn:  fetchHevyExerciseThumbnails,
    staleTime: STALE.long,
  })
}

/** Hevy's own history of one exercise — a live read through hevy-api, run
 *  only while the popup's "History from Hevy" is open. */
export function useHevyExerciseHistory(templateId: string, range: HistoryRange, enabled: boolean) {
  return useQuery({
    queryKey: qk.hevy.exerciseHistory(templateId, range),
    queryFn:  () => fetchHevyExerciseHistory(templateId, historyStartDate(range, new Date())),
    staleTime: STALE.default,
    enabled,
  })
}

/** A custom exercise made in Hevy from the Exercises tab, then stored here. */
export function useCreateHevyExercise() {
  return useMutationWithFeedback({
    action:         'create_exercise_template',
    loadingMessage: 'Creating the exercise in Hevy…',
    successMessage: (r: Awaited<ReturnType<typeof createHevyExerciseTemplate>>, p: CustomExercisePayload) => r.stored
      ? `“${p.title}” created in Hevy`
      : `“${p.title}” created in Hevy — it shows here after the next Sync`,
    mutationFn:     createHevyExerciseTemplate,
    invalidates:    ['training'],
  })
}
