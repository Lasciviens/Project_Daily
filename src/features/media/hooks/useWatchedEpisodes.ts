import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import type { WatchedEpisode } from '../types'
import { scheduleTraktSync } from '../trakt/traktAutoSync'
import {
  fetchWatchedEpisodes,
  markEpisodeWatched,
  markEpisodesWatched,
  rewatchEpisodes,
  setEpisodeWatchDates,
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

/** `at`: this episode's own watched time (ISO or yyyy-MM-dd), e.g. its release date. */
export interface EpisodeRef { season: number; episode: number; at?: string }

export interface MarkEpisodesInput {
  tvEntryId: string
  episodes: EpisodeRef[]
  /** false = unmark (remove the watched rows). Default true. */
  watched?: boolean
  /** One more watch of each episode (Watched again, a rewatch round) — every other watch keeps its date. */
  again?: boolean
  /** yyyy-MM-dd or an ISO timestamp; defaults to today. */
  watchedOn?: string
}

type Ctx = { key: readonly unknown[]; previous?: WatchedEpisode[] }

/**
 * THE one "episode watched" write (THEME.md §10 — one action, one hook). Used
 * for a single tap, a season batch, "watched next episode" and a rewatch
 * alike, so every surface refreshes the same set: progress, next-up, recents
 * and the planned block the DB trigger deletes (group `episodeWatched`).
 * Optimistic on the series' watched list, rolled back on failure.
 */
export function useMarkEpisodeWatched(opts?: { successMessage?: string }) {
  const qc = useQueryClient()
  return useMutationWithFeedback<void, MarkEpisodesInput, Ctx>({
    action: 'mark_episode_watched',
    // Opt-in per surface: a one-tap "watched next" confirms itself, a
    // checkbox list stays silent.
    successMessage: opts?.successMessage,
    mutationFn: async ({ tvEntryId, episodes, watched = true, again, watchedOn }) => {
      const day = watchedOn ?? format(new Date(), 'yyyy-MM-dd')
      if (again) {
        await rewatchEpisodes(tvEntryId, episodes.map(e => ({ season: e.season, episode: e.episode, at: e.at ?? day })))
        return
      }
      if (watched && episodes.length > 1) {
        await markEpisodesWatched(tvEntryId, episodes, day)
        return
      }
      for (const { season, episode, at } of episodes) {
        if (watched) await markEpisodeWatched(tvEntryId, season, episode, at ?? day)
        else await unmarkEpisodeWatched(tvEntryId, season, episode)
      }
    },
    onMutate: async ({ tvEntryId, episodes, watched = true, again }) => {
      const key = qk.media.watched(tvEntryId)
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<WatchedEpisode[]>(key)
      const same = (w: WatchedEpisode, e: EpisodeRef) => w.season_number === e.season && w.episode_number === e.episode
      const now = new Date().toISOString()
      qc.setQueryData<WatchedEpisode[]>(key, old => {
        if (!old) return old
        if (again) {
          return old.map(w => {
            const e = episodes.find(x => same(w, x))
            if (!e) return w
            const watches = w.watches ? [...w.watches, { id: `optimistic-${e.season}x${e.episode}`, watched_at: e.at ?? now }] : undefined
            return { ...w, repeat_count: (w.repeat_count ?? 0) + 1, watches }
          })
        }
        if (!watched) return old.filter(w => !episodes.some(e => same(w, e)))
        // A rapid double-tap must not add a duplicate optimistic row.
        const added = episodes.filter(e => !old.some(w => same(w, e))).map(e => ({
          id:             'optimistic',
          user_id:        '',
          tv_entry_id:    tvEntryId,
          tv_series_id:   '',
          season_number:  e.season,
          episode_number: e.episode,
          watched_at:     e.at ?? now,
          watches:        [{ id: `optimistic-${e.season}x${e.episode}`, watched_at: e.at ?? now }],
        }))
        return [...old, ...added]
      })
      return { key, previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined) qc.setQueryData(ctx.key, ctx.previous)
    },
    invalidates: ['episodeWatched'],
    onSuccess: () => scheduleTraktSync(qc),
  })
}

/**
 * New dates for chosen watches of episodes, each its own (Change date, Dates,
 * Spread's Change dates, a date in the watch list). Every other watch — here
 * and on Trakt — keeps its date.
 */
export function useSetEpisodeDates() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'set_episode_dates',
    silent: 'the episode sheets report the result',
    mutationFn: ({ tvEntryId, episodes }: { tvEntryId: string; episodes: { season: number; episode: number; at: string; watchId?: string | null }[] }) =>
      setEpisodeWatchDates(tvEntryId, episodes),
    invalidates: ['episodeWatched'],
    onSuccess: () => scheduleTraktSync(qc),
  })
}
