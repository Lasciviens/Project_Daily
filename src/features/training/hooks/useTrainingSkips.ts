import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { useTodayStr } from '../../../shared/hooks/useToday'
import { createTrainingSkip, deleteTrainingSkip, fetchTrainingSkips, type CreateTrainingSkipInput } from '../api/trainingSkipsApi'
import { skipsFromWeek } from '../plan/skippedRoutines'

export function useTrainingSkips() {
  const fromWeek = skipsFromWeek(useTodayStr())
  return useQuery({ queryKey: qk.training.skips(fromWeek), queryFn: () => fetchTrainingSkips(fromWeek), staleTime: STALE.default })
}

export function useSkipTrainingSession() {
  return useMutationWithFeedback({
    action:         'skip_training_session',
    successMessage: 'Skipped',
    mutationFn:     (input: CreateTrainingSkipInput) => createTrainingSkip(input),
    invalidates:    [qk.training.skipsAll],
  })
}

export function useUndoTrainingSkip() {
  return useMutationWithFeedback({
    action:         'undo_training_skip',
    successMessage: 'Skip undone',
    mutationFn:     (id: string) => deleteTrainingSkip(id),
    invalidates:    [qk.training.skipsAll],
  })
}
