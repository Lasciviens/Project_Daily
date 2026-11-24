import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
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
 * `check` resolves true when the add may go ahead; `busy` covers the whole
 * check (a second tap meanwhile is refused). A failed read is toasted once.
 */
export function useQueueAddCheck() {
  const qc = useQueryClient()
  const modal = useEntityModal()
  const startRewatch = useStartRewatch()
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const read = useMutationWithFeedback({
    action: 'media_queue_add_check',
    silent: 'the add that follows reports the result',
    errorFallback: 'Could not read your library — nothing was added to the Queue',
    mutationFn: async (tmdb: number) => {
      const entries = await qc.ensureQueryData({ queryKey: qk.media.userMovies(), queryFn: fetchUserMovieEntries })
      return entries.find(e => e.movie.tmdb_id === tmdb) ?? null
    },
  })

  async function ask(item: ListItemRef, title: string): Promise<boolean> {
    if (item.type !== 'movie') return true
    const entry = await read.mutateAsync(item.tmdb).catch(() => undefined) // toasted by the hook
    if (entry === undefined) return false
    if (!entry || !queueAddNeedsRewatch(item.type, entry.status)) return true
    const ok = await modal.confirm({
      title: 'Already watched: start a rewatch?',
      message: `“${title}” is Completed. Rewatch marks it Watching and adds it to the Queue.`,
      confirmLabel: 'Rewatch',
      cancelLabel: 'Cancel',
      destructive: false,
    })
    if (!ok) return false
    // The round is only the pre-161 fallback (one more than its watches), as on the title page.
    const round = (entry.watches ?? cacheWatches(entry)).length + 1
    return startRewatch.mutateAsync({ kind: 'movie', id: entry.id, round }).then(() => true, () => false) // the hook reports a failure
  }

  async function check(item: ListItemRef, title: string): Promise<boolean> {
    if (running.current) return false
    running.current = true
    setBusy(true)
    try { return await ask(item, title) } finally { running.current = false; setBusy(false) }
  }

  return { check, busy }
}
