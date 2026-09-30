import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk } from '../../../shared/query/keys'
import { STALE } from '../../../shared/query/stale'
import {
  addToTraktList, createTraktList, deleteTraktList, fetchMediaScores, fetchTraktCalendar, fetchTraktListItems,
  fetchTraktLists, fetchTraktPlayback, removeFromTraktList, type ListItemRef, type MediaScores,
} from './traktApi'
import { useTraktStatus } from './useTrakt'

const WEEK_MS = 7 * 24 * 3600_000

type StoredScores = Partial<MediaScores> & { ratings_fetched_at?: string | null }

/**
 * Scores for one title. A library title's stored scores are used while under
 * a week old (the sync refreshes them); otherwise one MDBList read, cached a day.
 */
export function useMediaScores(mediaType: 'movie' | 'tv', tmdbId: number, stored?: StoredScores | null) {
  const [now] = useState(() => Date.now())
  const fresh = !!stored?.ratings_fetched_at && now - Date.parse(stored.ratings_fetched_at) < WEEK_MS
  const q = useQuery({
    queryKey: qk.mediaScores(mediaType, tmdbId),
    queryFn: () => fetchMediaScores(mediaType, tmdbId),
    enabled: !fresh && tmdbId > 0,
    staleTime: STALE.day,
    retry: false,
  })
  const scores: MediaScores | null = fresh
    ? {
        rt_critics: stored?.rt_critics ?? null, rt_audience: stored?.rt_audience ?? null, metacritic: stored?.metacritic ?? null,
        imdb_rating: stored?.imdb_rating ?? null, letterboxd_rating: stored?.letterboxd_rating ?? null, rt_url: stored?.rt_url ?? null,
      }
    : q.data ?? null
  return { scores, isLoading: !fresh && q.isLoading, error: q.error }
}

/** True once Trakt is connected; Trakt-only reads wait for it. */
function useTraktConnected() {
  const { data } = useTraktStatus()
  return !!data?.connected
}

export function useTraktPlayback() {
  const connected = useTraktConnected()
  return useQuery({ queryKey: qk.trakt.playback(), queryFn: fetchTraktPlayback, enabled: connected, staleTime: STALE.short, retry: false })
}

export function useTraktCalendar() {
  const connected = useTraktConnected()
  return useQuery({ queryKey: qk.trakt.calendar(), queryFn: fetchTraktCalendar, enabled: connected, staleTime: STALE.hour, retry: false })
}

export function useTraktLists(enabled = true) {
  const connected = useTraktConnected()
  return useQuery({ queryKey: qk.trakt.lists(), queryFn: fetchTraktLists, enabled: connected && enabled, staleTime: STALE.default, retry: false })
}

export function useTraktListItems(listId: number | null) {
  return useQuery({
    queryKey: qk.trakt.listItems(listId ?? 0),
    queryFn: () => fetchTraktListItems(listId!),
    enabled: listId !== null,
    staleTime: STALE.default,
    retry: false,
  })
}

export function useCreateTraktList() {
  return useMutationWithFeedback({
    action: 'trakt_list_create',
    loadingMessage: 'Creating list…',
    successMessage: 'List created',
    mutationFn: ({ name, description, items }: { name: string; description?: string; items?: ListItemRef[] }) =>
      createTraktList(name, description).then(async list => {
        if (items?.length) await addToTraktList(list.id, items)
        return list
      }),
    invalidates: [qk.trakt.lists()],
  })
}

export function useDeleteTraktList() {
  return useMutationWithFeedback({
    action: 'trakt_list_delete',
    loadingMessage: 'Deleting list…',
    successMessage: 'List deleted',
    mutationFn: (listId: number) => deleteTraktList(listId),
    invalidates: [qk.trakt.lists()],
  })
}

/** Add to or remove from one list; refreshes that list and the counts. */
export function useChangeTraktList() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'trakt_list_change',
    mutationFn: ({ listId, items, remove }: { listId: number; items: ListItemRef[]; remove?: boolean }) =>
      (remove ? removeFromTraktList(listId, items) : addToTraktList(listId, items)),
    successMessage: (_r, v) => (v.remove ? 'Removed from list' : 'Added to list'),
    onSuccess: (_r, v) => { void qc.invalidateQueries({ queryKey: qk.trakt.listItems(v.listId) }) },
    invalidates: [qk.trakt.lists()],
  })
}
