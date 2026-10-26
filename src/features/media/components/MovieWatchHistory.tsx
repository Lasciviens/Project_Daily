import { useState } from 'react'
import { withProgress } from '../../../shared/hooks/useMutationWithFeedback'
import type { UserMovieEntry } from '../types'
import { useAddMovieWatch, useDeleteWatches, useSetMovieWatchDate } from '../hooks/useWatches'
import { useWatchesWaitForTrakt } from '../trakt/useTrakt'
import { cacheWatches, watchDate, watchMark, type Watch } from '../watches'
import { WatchesSheet } from './WatchesSheet'
import { WatchHistoryButton } from './WatchHistoryButton'

/**
 * A movie's watch count — ×N from 2 watches, else the History icon — and the
 * watch list it opens (a Completed movie's panel, and a movie being watched
 * again): add a watch, change one's date, remove one (the one delete flow,
 * with Undo). Each reaches Trakt as that one play.
 */
export function MovieWatchHistory({ entry, disabled, className }: {
  entry: UserMovieEntry
  disabled?: boolean
  className?: string
}) {
  const watches: Watch[] = entry.watches ?? cacheWatches(entry)
  const traktWaits = useWatchesWaitForTrakt()
  const [open, setOpen] = useState(false)
  const addWatch = useAddMovieWatch()
  const setDate = useSetMovieWatchDate()
  const remove = useDeleteWatches()
  const busy = disabled || addWatch.isPending || setDate.isPending || remove.busy

  async function removeWatch(w: Watch) {
    const last = watches.length <= 1
    // The database puts a Completed movie with no watch back on the Wishlist; one being watched stays Watching.
    const back = entry.status === 'completed'
    await remove.run([w.id], {
      title: 'Remove this watch?',
      message: last
        ? `${watchDate(w)} is its only watch: ${back ? 'the film goes back to your Wishlist' : 'the film has no watch left'}. On Trakt only this play goes.`
        : `${watchDate(w)} — on Trakt only this play goes; the other watches stay.`,
      confirmLabel: 'Remove',
      done: last && back ? 'Watch removed · back on the Wishlist' : 'Watch removed',
    })
  }

  if (!watches.length) return null
  return (
    <>
      {open && (
        <WatchesSheet
          title={entry.movie.title}
          target="movie"
          watches={watches}
          editable={!!entry.watches}
          traktWaits={traktWaits}
          busy={busy}
          onClose={() => setOpen(false)}
          onAdd={at => withProgress(() => addWatch.mutateAsync({ entry, at }).then(() => true), { loading: 'Adding a watch…', success: 'Watch added' })}
          onSetDate={(w, at) => withProgress(() => setDate.mutateAsync({ entry, watchId: w.id, at }).then(() => true), { loading: 'Changing the date…', success: 'Watched date changed' })}
          onRemove={removeWatch}
        />
      )}
      <WatchHistoryButton counter={watchMark(watches).counter} onOpen={() => setOpen(true)} disabled={busy} className={className} />
    </>
  )
}
