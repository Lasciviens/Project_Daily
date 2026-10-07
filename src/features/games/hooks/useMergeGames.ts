import { useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { mergeGames, type MergeResult } from '../api/gameMerge'

/** Merge `dropId` into `keepId` (the owner's choice, after the preview); refreshes the whole library. */
export function useMergeGames() {
  const qc = useQueryClient()
  return useMutationWithFeedback<MergeResult, { keepId: string; dropId: string }>({
    action: 'merge_games',
    loadingMessage: 'Merging…',
    successMessage: 'Games merged ✓',
    mutationFn: ({ keepId, dropId }) => mergeGames(keepId, dropId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['games'] }),
  })
}
