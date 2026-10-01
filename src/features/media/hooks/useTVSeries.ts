import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { scheduleTraktSync } from '../trakt/traktAutoSync'
import {
  fetchUserTVEntries,
  upsertTVSeries,
  addTVEntry,
  updateTVEntry,
  deleteTVEntry,
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
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateTVEntry>[1] }) =>
      updateTVEntry(id, patch),
    invalidates: ['media'],
    onSuccess: () => scheduleTraktSync(qc),
  })
}

export function useDeleteTV() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'delete_tv',
    mutationFn: (id: string) => deleteTVEntry(id),
    invalidates: ['media'],
    onSuccess: () => scheduleTraktSync(qc),
  })
}
