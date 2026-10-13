import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { confirmDelete } from '../../../shared/modals'
import { qk } from '../../../shared/query/keys'
import { STALE } from '../../../shared/query/stale'
import {
  addToTraktList, createTraktList, deleteTraktList, fetchMediaScores, fetchTraktCalendar, fetchTraktListItems,
  fetchTraktLists, fetchTraktPlayback, removeTraktPlayback, removeFromTraktList, type ListItemRef, type MediaScores, type TraktPlaybackItem,
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

/** Removes a paused playback from Trakt; the strip drops it at once. */
export function useRemoveTraktPlayback() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'trakt_playback_remove',
    mutationFn: async (id: number) => { await removeTraktPlayback(id); return true },
    silent: 'the delete flow reports the result',
    onMutate: (id: number) => {
      qc.setQueryData<TraktPlaybackItem[]>(qk.trakt.playback(), old => old?.filter(i => i.id !== id))
    },
    invalidates: [qk.trakt.playback()],
  })
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
    silent: 'the delete flow reports the result',
    mutationFn: async (listId: number) => { await deleteTraktList(listId); return true },
    invalidates: [qk.trakt.lists()],
  })
}

/** Add to or remove from one list; refreshes that list and the counts. `quiet`: the caller reports it. */
export function useChangeTraktList() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'trakt_list_change',
    mutationFn: async ({ listId, items, remove }: { listId: number; items: ListItemRef[]; remove?: boolean; quiet?: boolean }) => {
      await (remove ? removeFromTraktList(listId, items) : addToTraktList(listId, items))
      return true
    },
    successMessage: (_r, v) => (v.quiet ? undefined : v.remove ? 'Removed from list' : 'Added to list'),
    onSuccess: (_r, v) => { void qc.invalidateQueries({ queryKey: qk.trakt.listItems(v.listId) }) },
    invalidates: [qk.trakt.lists()],
  })
}

/**
 * Takes titles off a Trakt list: asks, removes, "Removed Dune · Undo". Undo
 * adds them again — at the end of the list (Trakt keeps no place for them).
 */
export function useRemoveFromTraktList() {
  const change = useChangeTraktList()
  return (listId: number, items: ListItemRef[], q: { title: string; done: string }) => confirmDelete({
    title: q.title,
    confirmLabel: 'Remove',
    remove: () => change.mutateAsync({ listId, items, remove: true, quiet: true }),
    restore: async () => { await change.mutateAsync({ listId, items, quiet: true }) },
    done: q.done,
    restored: 'Back on the list (at the end)',
  })
}
