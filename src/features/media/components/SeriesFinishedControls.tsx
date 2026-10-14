import { CalendarDays, Repeat } from 'lucide-react'
import { withProgress } from '../../../shared/hooks/useMutationWithFeedback'
import { Button } from '../../../shared/ui'
import { formatDate } from '../../../shared/utils/dateFormat'
import { useWatchedWhenPrompt } from '../hooks/useWatchedWhenPrompt'
import type { UserTVEntry } from '../types'
import { resolveWatchedAt } from '../watchedWhen'

/**
 * A completed series' finished date — shown and changeable (Release date =
 * the last episode's air date) — and "Watch again" (a rewatch round,
 * migration 149; the Watching status stays plain Watching). The episode dates
 * themselves change in the episode list ("Dates").
 */
export function SeriesFinishedControls({ entry, lastAirDate, disabled, onPatch, onWatchAgain }: {
  entry: UserTVEntry
  lastAirDate: string | null
  disabled?: boolean
  onPatch: (patch: Partial<Pick<UserTVEntry, 'finished_at'>>) => Promise<unknown>
  onWatchAgain: () => void
}) {
  const { ask, dialog } = useWatchedWhenPrompt()
  async function change() {
    const when = await ask({ title: entry.tv_series.title, subtitle: 'When did you finish it?', releaseLabel: lastAirDate ? formatDate(lastAirDate) : null })
    if (!when) return
    const at = resolveWatchedAt(when, lastAirDate, 'movie', new Date().toISOString())
    await withProgress(() => onPatch({ finished_at: at }), { loading: 'Changing the date…', success: 'Finished date changed' })
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {dialog}
      <p className="text-meta text-fg-muted tabular-nums">Finished {entry.finished_at ? formatDate(entry.finished_at) : 'date unknown'}</p>
      {/* Icon-only on phones so the date, its change and Watch again share one row. */}
      <Button size="sm" variant="ghost" icon={<CalendarDays />} disabled={disabled} onClick={() => { void change() }} aria-label="Change date" title="Change date" className="max-sm:px-2.5">
        <span className="max-sm:sr-only">Change date</span>
      </Button>
      <Button size="sm" variant="ghost" icon={<Repeat />} disabled={disabled} onClick={onWatchAgain} title="Watch it again from the start: it stays Watching until every episode is watched again">Watch again</Button>
    </div>
  )
}
