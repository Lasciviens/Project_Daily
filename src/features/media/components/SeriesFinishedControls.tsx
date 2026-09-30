import { CalendarDays } from 'lucide-react'
import { withProgress } from '../../../shared/hooks/useMutationWithFeedback'
import { Button } from '../../../shared/ui'
import { formatDate } from '../../../shared/utils/dateFormat'
import { useWatchedWhenPrompt } from '../hooks/useWatchedWhenPrompt'
import type { UserTVEntry } from '../types'
import { resolveWatchedAt } from '../watchedWhen'

/**
 * A completed series' finished date — shown and changeable (Release date =
 * the last episode's air date). The episode dates themselves change in the
 * episode list ("Dates").
 */
export function SeriesFinishedControls({ entry, lastAirDate, disabled, onPatch }: {
  entry: UserTVEntry
  lastAirDate: string | null
  disabled?: boolean
  onPatch: (patch: Partial<Pick<UserTVEntry, 'finished_at'>>) => Promise<unknown>
}) {
  const { ask, dialog } = useWatchedWhenPrompt()
  async function change() {
    const when = await ask({ title: entry.tv_series.title, subtitle: 'When did you finish it?', releaseLabel: lastAirDate ? formatDate(lastAirDate) : null })
    if (!when) return
    const at = resolveWatchedAt(when, lastAirDate, 'movie', new Date().toISOString())
    await withProgress(() => onPatch({ finished_at: at }), { loading: 'Changing the date…', success: 'Finished date changed' })
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {dialog}
      <p className="text-meta text-fg-muted tabular-nums">Finished {entry.finished_at ? formatDate(entry.finished_at) : 'date unknown'}</p>
      <Button size="sm" variant="ghost" icon={<CalendarDays />} disabled={disabled} onClick={() => { void change() }}>Change date</Button>
    </div>
  )
}
