import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { cx } from '../../../shared/ui'
import type { FigureChange } from '../claude/reportTiles'

/**
 * A figure's change, as code wrote it, on the tile's number line: an arrow and the short difference ("+55 %",
 * "+47 min") in a tone (better success, worse warn, neither neutral; never the accent). What it is set against is
 * named once in the section's header (`base`); a change against something else says so beside it. Screen readers get
 * the whole change and its basis. The arrow is decoration: the sign says the direction in words.
 */
export function ReportChange({ change, base, className }: { change: FigureChange; base?: string | null; className?: string }) {
  const Icon = change.dir === 'up' ? ArrowUpRight : change.dir === 'down' ? ArrowDownRight : Minus
  return (
    <span className={cx('whitespace-nowrap text-meta tabular-nums', className)} title={`${change.text} ${change.against}`}>
      <span aria-hidden data-tone={change.tone} className="tone-text font-semibold">
        <Icon className="-mt-0.5 mr-px inline h-3.5 w-3.5 align-middle" strokeWidth={2.25} />
        {change.short}
      </span>
      {change.against !== base && <span aria-hidden className="text-fg-muted"> {change.against}</span>}
      <span className="sr-only">{`${change.text} ${change.against}`}</span>
    </span>
  )
}
