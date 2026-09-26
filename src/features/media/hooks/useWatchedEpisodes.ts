import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import type { WatchedEpisode } from '../types'
import {
  fetchWatchedEpisodes,
  markEpisodeWatched,
  unmarkEpisodeWatched,
} from '../api/watchedEpisodesApi'

export function useWatchedEpisodes(tvEntryId: string | null) {
  return useQuery({
    queryKey: qk.media.watched(tvEntryId ?? ''),
    queryFn:  () => fetchWatchedEpisodes(tvEntryId!),
    enabled:  !!tvEntryId,
    staleTime: STALE.default,
  })
}

export interface EpisodeRef { season: number; episode: number }

export interface MarkEpisodesInput {
  tvEntryId: string
  episodes: EpisodeRef[]
  /** false = unmark (remove the watched rows). Default true. */
  watched?: boolean
  /** yyyy-MM-dd; defaults to today. */
  watchedOn?: string
}

type Ctx = { key: readonly unknown[]; previous?: WatchedEpisode[] }

/**
 * THE one "episode watched" write (THEME.md §10 — one action, one hook). Used
 * for a single tap, a season batch and "watched next episode" alike, so every
 * surface refreshes the same set: progress, next-up, recents and the planned
 * block the DB trigger deletes (group `episodeWatched`). Optimistic on the
 * series' watched list, rolled back on failure.
 */
export function useMarkEpisodeWatched() {
  const qc = useQueryClient()
  return useMutationWithFeedback<void, MarkEpisodesInput, Ctx>({
    action: 'mark_episode_watched',
    mutationFn: async ({ tvEntryId, episodes, watched = true, watchedOn }) => {
      const day = watchedOn ?? format(new Date(), 'yyyy-MM-dd')
      for (const { season, episode } of episodes) {
        if (watched) await markEpisodeWatched(tvEntryId, season, episode, day)
        else await unmarkEpisodeWatched(tvEntryId, season, episode)
      }
    },
    onMutate: async ({ tvEntryId, episodes, watched = true }) => {
      const key = qk.media.watched(tvEntryId)
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<WatchedEpisode[]>(key)
      const same = (w: WatchedEpisode, e: EpisodeRef) => w.season_number === e.season && w.episode_number === e.episode
      qc.setQueryData<WatchedEpisode[]>(key, old => {
        if (!old) return old
        if (!watched) return old.filter(w => !episodes.some(e => same(w, e)))
        // A rapid double-tap must not add a duplicate optimistic row.
        const added = episodes.filter(e => !old.some(w => same(w, e))).map(e => ({
          id:             'optimistic',
          user_id:        '',
          tv_entry_id:    tvEntryId,
          tv_series_id:   '',
          season_number:  e.season,
          episode_number: e.episode,
          watched_at:     new Date().toISOString(),
        }))
        return [...old, ...added]
      })
      return { key, previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined) qc.setQueryData(ctx.key, ctx.previous)
    },
    invalidates: ['episodeWatched'],
  })
}
