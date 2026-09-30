import { CalendarDays, RotateCcw, Undo2 } from 'lucide-react'
import { withProgress } from '../../../shared/hooks/useMutationWithFeedback'
import { useEntityModal } from '../../../shared/modals'
import { Button } from '../../../shared/ui'
import { formatDate } from '../../../shared/utils/dateFormat'
import { isUnknownWatchedAt } from '../trakt/traktDates'
import type { UserMovieEntry } from '../types'
import { useWatchedWhenPrompt } from '../hooks/useWatchedWhenPrompt'
import { resolveWatchedAt } from '../watchedWhen'

type Patch = Partial<Pick<UserMovieEntry, 'status' | 'watched_at' | 'repeat_count'>>

/**
 * A watched movie's record: when, how many times, and the two ways to change
 * it — one more play (a rewatch) or not watched at all. Both reach Trakt
 * through the outbox (migration 117); "Not watched" removes every play there.
 */
export function MovieWatchedControls({ entry, releaseDate, disabled, onPatch }: {
  entry: UserMovieEntry
  releaseDate: string | null
  disabled?: boolean
  onPatch: (patch: Patch) => Promise<unknown>
}) {
  const modal = useEntityModal()
  const plays = 1 + Math.max(0, entry.repeat_count ?? 0)
  const when = entry.watched_at && !isUnknownWatchedAt(entry.watched_at) ? formatDate(entry.watched_at) : 'date unknown'

  const { ask, dialog } = useWatchedWhenPrompt()

  // One more play; its time asked like Trakt does (Unknown keeps the last date).
  async function watchAgain() {
    const when = await ask({ title: entry.movie.title, subtitle: 'When did you watch it again?', releaseLabel: releaseDate ? formatDate(releaseDate) : null })
    if (!when) return
    const at = resolveWatchedAt(when, releaseDate, 'movie', new Date().toISOString())
    await withProgress(
      () => onPatch({ repeat_count: (entry.repeat_count ?? 0) + 1, ...(at ? { watched_at: at } : {}) }),
      { loading: 'Counting another play…', success: 'Play counted' },
    )
  }

  // Change when it was watched (the latest play); Trakt gets the new date too (migration 120).
  async function changeDate() {
    if (plays > 1 && !(await modal.confirm({
      title: `Watched ${plays} times`,
      message: 'The app keeps one watched date per title, so every play gets the new date — here and on Trakt.',
      confirmLabel: 'Change anyway',
    }))) return
    const when = await ask({ title: entry.movie.title, subtitle: 'Change when you watched it', releaseLabel: releaseDate ? formatDate(releaseDate) : null })
    if (!when) return
    const at = resolveWatchedAt(when, releaseDate, 'movie', new Date().toISOString())
    await withProgress(() => onPatch({ watched_at: at }), { loading: 'Changing the date…', success: 'Watched date changed' })
  }

  async function unwatch() {
    const ok = await modal.confirm({
      title: 'Mark as not watched?',
      message: `Removes the watched date and all ${plays === 1 ? 'plays' : `${plays} plays`} — here and on Trakt. It goes back to your Wishlist.`,
      confirmLabel: 'Mark not watched',
      destructive: true,
    })
    if (!ok) return
    await withProgress(() => onPatch({ status: 'wishlist', watched_at: null, repeat_count: 0 }), { loading: 'Removing watched…', success: 'Marked as not watched' })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {dialog}
      <p className="text-meta text-fg-muted tabular-nums">
        Watched {when}{plays > 1 && ` · ${plays} plays`}
      </p>
      <Button size="sm" variant="ghost" icon={<CalendarDays />} disabled={disabled} onClick={() => { void changeDate() }}>Change date</Button>
      <Button size="sm" icon={<RotateCcw />} disabled={disabled} onClick={() => { void watchAgain() }}>Watched again</Button>
      <Button size="sm" variant="ghost" icon={<Undo2 />} disabled={disabled} onClick={() => { void unwatch() }}>Not watched</Button>
    </div>
  )
}
