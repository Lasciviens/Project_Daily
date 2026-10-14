import { useState } from 'react'
import { CalendarDays, History, Hourglass, RotateCcw, Undo2 } from 'lucide-react'
import { toast } from '../../../app/store'
import { withProgress } from '../../../shared/hooks/useMutationWithFeedback'
import { Button, IconButton } from '../../../shared/ui'
import { formatDate } from '../../../shared/utils/dateFormat'
import type { UserMovieEntry } from '../types'
import { useWatchedWhenPrompt } from '../hooks/useWatchedWhenPrompt'
import { useWatchPick } from '../hooks/useWatchPick'
import { useAddMovieWatch, useDeleteWatches, useMovieNotWatched, useSetMovieWatchDate, WAITS_FOR_TRAKT } from '../hooks/useWatches'
import { useWatchesWaitForTrakt } from '../trakt/useTrakt'
import { resolveWatchedAt } from '../watchedWhen'
import { cacheWatches, editableWatches, watchDate, watchFor, watchSummary, type Watch } from '../watches'
import { WatchesSheet } from './WatchesSheet'

/**
 * A watched movie's record: every watch with its own date (migration 149),
 * and the ways to change it — one more watch, a new date for one of them,
 * the watch list, or not watched at all. Each reaches Trakt as that one play;
 * "Not watched" (asks, then "· Undo") removes every play there.
 */
export function MovieWatchedControls({ entry, releaseDate, disabled }: {
  entry: UserMovieEntry
  releaseDate: string | null
  disabled?: boolean
}) {
  const watches: Watch[] = entry.watches ?? cacheWatches(entry)
  const linked = !!entry.watches
  const traktWaits = useWatchesWaitForTrakt()
  // A placeholder waiting for Trakt's dates is never moved or removed.
  const editable = linked ? editableWatches(watches, traktWaits) : []
  // Not watched would remove placeholders too: it waits with them.
  const waiting = linked && editable.length < watches.length
  const [listOpen, setListOpen] = useState(false)

  const { ask, dialog } = useWatchedWhenPrompt()
  const pick$ = useWatchPick()
  const addWatch = useAddMovieWatch()
  const setDate = useSetMovieWatchDate()
  const remove = useDeleteWatches()
  const notWatched = useMovieNotWatched()
  const busy = disabled || addWatch.isPending || setDate.isPending || remove.busy || notWatched.busy

  // One more watch; its time asked like Trakt does (Unknown = a watch with no date).
  async function watchAgain() {
    const when = await ask({ title: entry.movie.title, subtitle: 'When did you watch it again?', releaseLabel: releaseDate ? formatDate(releaseDate) : null })
    if (!when) return
    const at = resolveWatchedAt(when, releaseDate, 'movie', new Date().toISOString())
    await withProgress(() => addWatch.mutateAsync({ entry, at }).then(() => true), { loading: 'Adding a watch…', success: 'Watch added' })
  }

  // A new date for ONE watch — the latest unless the user picks another; the others keep theirs.
  async function changeDate() {
    if (linked && !editable.length) {
      toast.info(WAITS_FOR_TRAKT)
      return
    }
    let target: Watch | null = watchFor(editable, 'latest')
    if (watches.length > 1 && linked) {
      const a = await pick$.ask({ title: entry.movie.title, watches, traktWaits })
      if (!a) return
      target = watchFor(editable, a)
    }
    const when = await ask({ title: entry.movie.title, subtitle: 'Change when you watched it', releaseLabel: releaseDate ? formatDate(releaseDate) : null })
    if (!when) return
    const at = resolveWatchedAt(when, releaseDate, 'movie', new Date().toISOString())
    // Before migration 149 there is no watch to name: the hook says so and writes nothing.
    await withProgress(
      () => setDate.mutateAsync({ entry, watchId: target?.id ?? null, at }).then(() => true),
      { loading: 'Changing the date…', success: 'Watched date changed' },
    )
  }

  async function removeWatch(w: Watch) {
    const last = watches.length <= 1
    await remove.run([w.id], {
      title: 'Remove this watch?',
      message: last
        ? `${watchDate(w)} is its only watch: the film goes back to your Wishlist. On Trakt only this play goes.`
        : `${watchDate(w)} — on Trakt only this play goes; the other watches stay.`,
      confirmLabel: 'Remove',
      done: last ? 'Watch removed · back on the Wishlist' : 'Watch removed',
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {dialog}
      {pick$.dialog}
      {listOpen && watches.length > 0 && (
        <WatchesSheet
          title={entry.movie.title}
          target="movie"
          watches={watches}
          editable={linked}
          traktWaits={traktWaits}
          busy={busy}
          onClose={() => setListOpen(false)}
          onAdd={at => withProgress(() => addWatch.mutateAsync({ entry, at }).then(() => true), { loading: 'Adding a watch…', success: 'Watch added' })}
          onSetDate={(w, at) => withProgress(() => setDate.mutateAsync({ entry, watchId: w.id, at }).then(() => true), { loading: 'Changing the date…', success: 'Watched date changed' })}
          onRemove={removeWatch}
        />
      )}
      {/* Every watch with its own date, compact: "3 watches · 12.10.2018 · 01.12.2024 · 08.01.2026", and the list beside it. */}
      <div className="flex basis-full items-center gap-1">
        <p className="min-w-0 flex-1 text-meta tabular-nums text-fg-muted">
          {watchSummary(watches)}
          {waiting && <span className="whitespace-nowrap"> · <Hourglass aria-hidden className="inline h-3 w-3 align-[-2px]" /> waits for Trakt's dates</span>}
        </p>
        <IconButton label="Watches…" disabled={busy} onClick={() => setListOpen(true)} className="-my-1 text-fg-faint hover:text-fg-2">
          <History />
        </IconButton>
      </div>
      <Button size="sm" variant="ghost" icon={<CalendarDays />} disabled={busy} onClick={() => { void changeDate() }}>Change date</Button>
      <Button size="sm" icon={<RotateCcw />} disabled={busy} onClick={() => { void watchAgain() }}>Watched again</Button>
      {/* Icon-only on phones so the three fit one row. */}
      <Button size="sm" variant="ghost" icon={<Undo2 />} disabled={busy || waiting} onClick={() => { void notWatched.run(entry, traktWaits) }} aria-label="Not watched" title={waiting ? "Not watched waits for Trakt's dates" : 'Not watched'} className="max-sm:px-2.5">
        <span className="max-sm:sr-only">Not watched</span>
      </Button>
    </div>
  )
}
