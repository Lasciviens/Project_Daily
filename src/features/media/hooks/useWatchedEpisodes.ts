import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  fetchWatchedEpisodes,
  markEpisodeWatched,
  unmarkEpisodeWatched,
} from '../api/watchedEpisodesApi'

export function useWatchedEpisodes(tvEntryId: string | null) {
  return useQuery({
    queryKey: ['watched_episodes', tvEntryId],
    queryFn:  () => fetchWatchedEpisodes(tvEntryId!),
    enabled:  !!tvEntryId,
    staleTime: 5 * 60_000,
  })
}

export function useToggleEpisodeWatched(tvEntryId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ season, episode, watched }: { season: number; episode: number; watched: boolean }) => {
      if (watched) {
        await unmarkEpisodeWatched(tvEntryId, season, episode)
      } else {
        await markEpisodeWatched(tvEntryId, season, episode, format(new Date(), 'yyyy-MM-dd'))
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['watched_episodes', tvEntryId] }),
  })
}
