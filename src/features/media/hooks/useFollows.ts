import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { addFollow, checkFollowsNow, fetchFollowEvents, fetchFollows, markEventsSeen, removeFollow, type FollowKind } from '../api/followsApi'

export const useFollows = () => useQuery({ queryKey: qk.mediaFollows.list(), queryFn: fetchFollows, staleTime: STALE.default })
export const useFollowEvents = () => useQuery({ queryKey: qk.mediaFollows.events(), queryFn: fetchFollowEvents, staleTime: STALE.default })

export function useToggleFollow() {
  return useMutationWithFeedback({
    action: 'media_follow_toggle',
    mutationFn: async (v: { followId?: string; kind: FollowKind; tmdbId: number; name: string }) => {
      if (v.followId) { await removeFollow(v.followId); return false }
      await addFollow({ kind: v.kind, tmdb_id: v.tmdbId, name: v.name })
      // The baseline is recorded right away, so later checks only report what's new.
      await checkFollowsNow().catch(() => null)
      return true
    },
    successMessage: (on, v) => (on ? `Following ${v.name}` : `Stopped following ${v.name}`),
    invalidates: [qk.mediaFollows.all],
  })
}

export function useCheckFollows() {
  return useMutationWithFeedback({
    action: 'media_follow_check',
    loadingMessage: 'Checking what you follow…',
    mutationFn: checkFollowsNow,
    successMessage: r => (r.newTitles || r.trailers ? `${r.newTitles} new titles · ${r.trailers} new trailers` : 'Nothing new'),
    invalidates: [qk.mediaFollows.all],
  })
}

export function useMarkFollowEventsSeen() {
  return useMutationWithFeedback({
    action: 'media_follow_seen',
    mutationFn: (ids: string[]) => markEventsSeen(ids),
    invalidates: [qk.mediaFollows.events()],
  })
}
