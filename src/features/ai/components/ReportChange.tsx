import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { cx } from '../../../shared/ui'
import type { FigureChange } from '../claude/reportTiles'

/**
 * A figure's change, as code wrote it: an arrow and the signed difference in a tone (better success, worse warn,
 * neither neutral; never the accent), then what it is set against. `short` is Home's card: the percent only, the
 * rest in the tooltip. `base` is what the section's header already names ("vs last week"): a change against it leaves
 * it out. The arrow is decoration: the sign says the direction in words.
 */
export function ReportChange({ change, short = false, base, className }: { change: FigureChange; short?: boolean; base?: string | null; className?: string }) {
  const Icon = change.dir === 'up' ? ArrowUpRight : change.dir === 'down' ? ArrowDownRight : Minus
  return (
    <span className={cx('flex min-w-0 flex-wrap items-baseline gap-x-1 text-meta tabular-nums', className)} title={short ? `${change.text} ${change.against}` : undefined}>
      <span data-tone={change.tone} className="tone-text font-semibold">
        <Icon aria-hidden className="-mt-0.5 mr-0.5 inline h-3.5 w-3.5 align-middle" strokeWidth={2.25} />
        {short ? change.short : change.text}
      </span>
      {!short && <span className={change.against === base ? 'sr-only' : 'text-fg-muted'}>{change.against}</span>}
    </span>
  )
}
