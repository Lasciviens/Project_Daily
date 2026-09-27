import { Info } from 'lucide-react'
import { ToneDot } from '../../../../shared/ui'
import {
  leanLabel, leanTone, ratioText, sidesText, type BalanceComparison, type RatioRead,
} from '../../plan/muscleBalance'

// The pieces both balance cards share (Program tab = planned, Muscles body
// map on Progress = done), so the two read the same words for the same
// numbers — and each names the other's value.

/** "1.92 : 1" with its tone dot and verdict word. */
export function RatioValue({ read, size = 'kpi' }: { read: RatioRead; size?: 'kpi' | 'body' }) {
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <span className={size === 'kpi' ? 'flex items-center gap-2 text-kpi font-bold tabular-nums text-fg' : 'flex items-center gap-1.5 text-body font-semibold tabular-nums text-fg'}>
        <ToneDot tone={leanTone(read)} className={size === 'kpi' ? '' : 'shrink-0'} />
        {ratioText(read)}
      </span>
      <span data-tone={leanTone(read)} className={read.lean === 'a' ? 'tone-text text-meta font-semibold' : 'text-meta text-fg-muted'}>{leanLabel(read)}</span>
    </span>
  )
}

/** The other card's number for the same ratio, e.g. "Done in the last 30
 *  days: 1.54 : 1 · push-heavy · 35.5 push vs 23 pull sets/week". */
export function CounterpartLine({ label, read }: { label: string; read: RatioRead }) {
  return (
    <p className="text-meta text-fg-muted">
      <span className="font-medium text-fg-2">{label}:</span>{' '}
      <span className="tabular-nums font-semibold text-fg">{ratioText(read)}</span>
      {' · '}{leanLabel(read)}
      {read.lean !== 'none' && <span className="tabular-nums"> · {sidesText(read)}</span>}
    </p>
  )
}

/** The one-line reason planned and done differ (only when they do). */
export function WhyLine({ comparison }: { comparison: BalanceComparison | null | undefined }) {
  if (!comparison?.why) return null
  return (
    <p className="flex items-start gap-1.5 rounded-row bg-surface-2 px-2.5 py-2 text-meta text-fg-2">
      <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-muted" />
      <span><span className="font-semibold">Why they differ:</span> {comparison.why}</span>
    </p>
  )
}
