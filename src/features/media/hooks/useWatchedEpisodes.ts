import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import type { WatchedEpisode } from '../types'
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
  const key = ['watched_episodes', tvEntryId]

  return useMutation({
    mutationFn: async ({ season, episode, watched }: { season: number; episode: number; watched: boolean }) => {
      if (watched) {
        await unmarkEpisodeWatched(tvEntryId, season, episode)
      } else {
        await markEpisodeWatched(tvEntryId, season, episode, format(new Date(), 'yyyy-MM-dd'))
      }
    },
    onMutate: async ({ season, episode, watched }) => {
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<WatchedEpisode[]>(key)
      qc.setQueryData<WatchedEpisode[]>(key, old => {
        if (!old) return old
        if (watched) {
          return old.filter(w => !(w.season === season && w.episode === episode))
        }
        return [...old, {
          id:          'optimistic',
          user_id:     '',
          tv_entry_id: tvEntryId,
          season,
          episode,
          watched_on:  format(new Date(), 'yyyy-MM-dd'),
        }]
      })
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous !== undefined) qc.setQueryData(key, context.previous)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })
}

