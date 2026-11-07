import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { useRowsDelete } from '../../../shared/hooks/useRowsDelete'
import { qk, STALE } from '../../../shared/query'
import { checkFollowsNow, fetchFollowEvents, fetchFollows, markEventsSeen } from '../api/followsApi'

export const useFollows = () => useQuery({ queryKey: qk.mediaFollows.list(), queryFn: fetchFollows, staleTime: STALE.default })
export const useFollowEvents = () => useQuery({ queryKey: qk.mediaFollows.events(), queryFn: fetchFollowEvents, staleTime: STALE.default })

export function useCheckFollows() {
  return useMutationWithFeedback({
    action: 'media_follow_check',
    loadingMessage: 'Checking what you follow…',
    mutationFn: checkFollowsNow,
    successMessage: r => `${r.newTitles || r.trailers ? `${r.newTitles} new titles · ${r.trailers} new trailers` : 'Nothing new'}${r.listWaiting ? ` · ${r.listWaiting} film${r.listWaiting === 1 ? '' : 's'} still waiting for a Trakt list` : ''}`,
    invalidates: [qk.mediaFollows.all],
  })
}

export function useMarkFollowEventsSeen() {
  return useMutationWithFeedback({
    action: 'media_follow_seen',
    successMessage: (_r, ids) => `${ids.length} marked seen`,
    mutationFn: (ids: string[]) => markEventsSeen(ids),
    invalidates: [qk.mediaFollows.events()],
  })
}

/** Deletes a rule that lives only in this app (and what it found), with Undo. */
export function useDeleteFollow() {
  return useRowsDelete({ table: 'media_follows', action: 'media_follow_delete', invalidates: [qk.mediaFollows.all], cache: qk.mediaFollows.all })
}
