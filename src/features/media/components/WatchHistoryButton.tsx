import { History } from 'lucide-react'
import { cx } from '../../../shared/ui'

/**
 * The way into an episode's or a movie's watch list (`WatchesSheet`): from 2
 * watches the ×N counter — every watch ever, as many as the list it opens; a
 * count, so neutral, never a status colour — and the History icon for one
 * watch. `counter` comes from `watchMark` (watches.ts), the one rule for it.
 */
export function WatchHistoryButton({ counter, of, onOpen, disabled, className }: {
  /** `watchMark(…).counter`: N from 2 watches, else null (the icon). */
  counter: number | null
  /** What the watches are of, for the accessible name ("episode 3"); left out on a title's own panel. */
  of?: string
  onOpen: () => void
  disabled?: boolean
  className?: string
}) {
  const label = counter != null
    ? `${counter} watches${of ? ` of ${of}` : ''} — show history`
    : `Watches${of ? ` of ${of}` : ''}`
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cx('grid min-h-[44px] min-w-[44px] shrink-0 place-items-center rounded-row text-fg-faint transition-colors hover:bg-surface-hover hover:text-fg-2 disabled:opacity-40', className)}
    >
      {counter != null
        ? <span aria-hidden className="count-badge">×{counter}</span>
        : <History aria-hidden className="h-4 w-4" />}
    </button>
  )
}
