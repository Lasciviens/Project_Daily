import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
    queryKey: ['tv', 'user'],
    queryFn:  fetchUserTVEntries,
    staleTime: 5 * 60_000,
  })
}

export function useAddTV() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      tmdb,
      status,
      priority,
    }: {
      tmdb: TMDBTVSeries
      status: UserTVEntry['status']
      priority?: UserTVEntry['priority']
    }) => {
      const series = await upsertTVSeries(tmdb)
      return addTVEntry(series.id, status, priority)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tv', 'user'] }),
  })
}

export function useUpdateTV() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateTVEntry>[1] }) =>
      updateTVEntry(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tv', 'user'] }),
  })
}

export function useDeleteTV() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteTVEntry(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tv', 'user'] }),
  })
}
