import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { useRowsDelete } from '../../../shared/hooks/useRowsDelete'
import { qk, STALE } from '../../../shared/query'
import { scheduleTraktSync } from '../trakt/traktAutoSync'
import {
  fetchUserTVEntries,
  upsertTVSeries,
  addTVEntry,
  updateTVEntry,
  } from '../api/tvApi'
import type { UserTVEntry, TMDBTVSeries } from '../types'

export function useTVSeries() {
  return useQuery({
    queryKey: qk.media.userTv(),
    queryFn:  fetchUserTVEntries,
    staleTime: STALE.default,
  })
}

/** The user's library entry for one TMDB series (a projection of the list). */
export function useTVEntryByTmdb(tmdbId: number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.media.userTv(),
    queryFn:  fetchUserTVEntries,
    staleTime: STALE.default,
    enabled:  enabled && tmdbId != null,
    select:   (list: UserTVEntry[]) => list.find(e => e.tv_series.tmdb_id === tmdbId) ?? null,
  })
}

// Callers pass their own success copy (withProgress) — see useMovies.ts.
export function useAddTV() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'add_tv',
    silent: 'callers report the result (the same hook adds, rates, notes and completes)',
    mutationFn: async ({
      tmdb,
      status,
      priority,
      dates,
    }: {
      tmdb: TMDBTVSeries
      status: UserTVEntry['status']
      priority?: UserTVEntry['priority']
      dates?: Partial<Pick<UserTVEntry, 'started_at' | 'finished_at'>>
    }) => {
      const series = await upsertTVSeries(tmdb)
      return addTVEntry(series.id, status, priority, dates)
    },
    invalidates: ['media'],
    onSuccess: () => scheduleTraktSync(qc),
  })
}

export function useUpdateTV() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'update_tv',
    silent: 'callers report the result (the same hook adds, rates, notes and completes)',
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateTVEntry>[1] }) =>
      updateTVEntry(id, patch),
    invalidates: ['media'],
    onSuccess: () => scheduleTraktSync(qc),
  })
}

/**
 * Removes a title from the library with Undo (its watched episodes go with it).
 * The Trakt outbox sends the removal; Undo puts the same rows back and the
 * outbox sends them again (plays at their kept dates; the Trakt note is made
 * anew, so the old link is cleared).
 */
export function useDeleteTV() {
  const qc = useQueryClient()
  return useRowsDelete({
    table: 'user_tv_entries', action: 'delete_tv', invalidates: ['media'], cache: qk.media.tv,
    overrides: () => ({ user_tv_entries: { trakt_note_id: null, trakt_note_text: null } }),
    afterDelete: () => scheduleTraktSync(qc),
    afterRestore: () => { scheduleTraktSync(qc) },
  })
}
