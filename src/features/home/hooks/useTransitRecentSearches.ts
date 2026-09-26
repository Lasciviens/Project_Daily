import { useQuery, useQueryClient } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { fetchRecentSearches, recordRecentSearch, type RecentSearch } from '../api/transitStoreApi'

export type { RecentSearch }

// Only stop→stop pairs are recorded (the table has no lat/lon columns), so a
// search from an address or your live location is simply not remembered.
export function useTransitRecentSearches() {
  const qc = useQueryClient()
  const { data: recent = [] } = useQuery({
    queryKey: qk.transit.recentSearches(),
    queryFn:  fetchRecentSearches,
    staleTime: STALE.short,
  })

  // Best-effort and silent on purpose: remembering a search must never make
  // planning it look failed, so this is not a feedback mutation.
  async function recordSearch(from: { id: string; name: string }, to: { id: string; name: string }): Promise<void> {
    if (recent[0]?.from_stop_id === from.id && recent[0]?.to_stop_id === to.id) return
    try {
      await recordRecentSearch(from, to)
      await qc.invalidateQueries({ queryKey: qk.transit.recentSearches() })
    } catch { /* see comment above */ }
  }

  return { recent, recordSearch }
}
