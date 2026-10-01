import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { applyIgdb, fetchIgdbData, fetchIgdbStatus, matchIgdb, refreshIgdb, searchIgdb, unlinkIgdb, type IgdbApplyItem, type IgdbMatchItem } from './igdbApi'

// Keys live under ['igdb'] — outside ['games'], so a status tap on the shelf
// never refetches them. A save refreshes ['games'] itself (once per run).
export const IGDB_KEYS = {
  status: ['igdb', 'status'] as const,
  data: (gameId: string) => ['igdb', 'data', gameId] as const,
  search: (q: string) => ['igdb', 'search', q] as const,
}

export function useIgdbStatus() {
  return useQuery({ queryKey: IGDB_KEYS.status, queryFn: fetchIgdbStatus, staleTime: 10 * 60_000, retry: false })
}

export function useIgdbData(gameId: string | null) {
  return useQuery({ queryKey: IGDB_KEYS.data(gameId ?? ''), queryFn: () => fetchIgdbData(gameId!), enabled: !!gameId, staleTime: 10 * 60_000 })
}

export function useIgdbSearch(query: string) {
  const q = query.trim()
  return useQuery({ queryKey: IGDB_KEYS.search(q), queryFn: () => searchIgdb(q), enabled: q.length >= 2, staleTime: 10 * 60_000, retry: false })
}

/** Looks up candidates; scoring and saving are the caller's (the batch). */
export function useIgdbMatch() {
  return useMutationWithFeedback({ action: 'igdb_match', mutationFn: (items: IgdbMatchItem[]) => matchIgdb(items) })
}

/** Saves picked matches. The library refresh is the caller's (`useAfterIgdbWrite`),
 *  so a long run refreshes it once, not after every chunk. */
export function useApplyIgdb() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'igdb_apply',
    mutationFn: (items: IgdbApplyItem[]) => applyIgdb(items),
    onSuccess: (_d, items) => { for (const i of items) qc.invalidateQueries({ queryKey: IGDB_KEYS.data(i.game_id) }) },
  })
}

export function useAfterIgdbWrite() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['games'] })
}

/** Re-reads ratings and lengths for every matched game, 200 per request. */
export function useRefreshIgdb() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'igdb_refresh',
    loadingMessage: 'Refreshing IGDB data…',
    mutationFn: async () => {
      let offset = 0, updated = 0
      for (let i = 0; i < 50; i++) {
        const r = await refreshIgdb(offset)
        updated += r.updated
        if (r.done) break
        offset = r.next
      }
      return updated
    },
    successMessage: (n: number) => `IGDB data refreshed for ${n} game${n === 1 ? '' : 's'}`,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['games'] }); qc.invalidateQueries({ queryKey: ['igdb', 'data'] }) },
  })
}

export function useUnlinkIgdb() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'igdb_unlink',
    mutationFn: (gameId: string) => unlinkIgdb(gameId),
    successMessage: 'IGDB match removed',
    onSuccess: (_d, id) => { qc.invalidateQueries({ queryKey: ['games'] }); qc.invalidateQueries({ queryKey: IGDB_KEYS.data(id) }) },
  })
}
