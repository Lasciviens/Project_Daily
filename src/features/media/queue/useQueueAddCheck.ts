import { useQueryClient } from '@tanstack/react-query'
import { useEntityModal } from '../../../shared/modals'
import { qk } from '../../../shared/query/keys'
import { fetchUserMovieEntries } from '../api/moviesApi'
import { useStartRewatch } from '../hooks/useWatches'
import { queueAddNeedsRewatch } from '../trakt/traktQueue'
import { cacheWatches } from '../watches'
import type { ListItemRef } from '../trakt/traktApi'

/**
 * Before a title goes into the Queue (every way in: "+ Queue", Add to list).
 * A Completed film would leave it again at the next sync (207), so the owner is
 * asked "Already watched: start a rewatch?": Rewatch starts one (Completed →
 * Watching, `useStartRewatch`) and the add goes ahead; Cancel adds nothing.
 * Resolves true when the add may go ahead.
 */
export function useQueueAddCheck() {
  const qc = useQueryClient()
  const modal = useEntityModal()
  const startRewatch = useStartRewatch()
  return async (item: ListItemRef, title: string): Promise<boolean> => {
    if (item.type !== 'movie') return true
    const entries = await qc.ensureQueryData({ queryKey: qk.media.userMovies(), queryFn: fetchUserMovieEntries })
    const entry = entries.find(e => e.movie.tmdb_id === item.tmdb)
    if (!entry || !queueAddNeedsRewatch(item.type, entry.status)) return true
    const ok = await modal.confirm({
      title: 'Already watched: start a rewatch?',
      message: `“${title}” is Completed, and a Completed film leaves the Queue at the next sync. Rewatch sets it to Watching again and adds it to the Queue.`,
      confirmLabel: 'Rewatch',
      cancelLabel: 'Cancel',
      destructive: false,
    })
    if (!ok) return false
    // The round is only the pre-161 fallback (one more than its watches), as on the title page.
    const round = (entry.watches ?? cacheWatches(entry)).length + 1
    return startRewatch.mutateAsync({ kind: 'movie', id: entry.id, round }).then(() => true, () => false) // the hook reports a failure
  }
}
