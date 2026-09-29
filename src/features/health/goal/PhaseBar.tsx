import { SegmentedControl } from '../../../shared/ui'
import { GoalSummary } from '../../daily/components/GoalSummary'
import type { GoalWindow } from './useGoalReport'

const WINDOWS: { value: `${GoalWindow}`; label: string }[] = [
  { value: '14', label: '14 days' },
  { value: '28', label: '28 days' },
  { value: '56', label: '56 days' },
]

/** The goal this report judges against — read-only here; "Edit goal" opens
 *  the one goal editor shared with Food and Daily — and the report's own
 *  window, with its dates. */
export function PhaseBar({ win, onWin, windowLabel }: {
  win: `${GoalWindow}`; onWin: (w: `${GoalWindow}`) => void; windowLabel: string
}) {
  return (
    <div className="flex flex-col gap-2">
      <GoalSummary className="rounded-row border border-line bg-surface-2 px-3" />
      <div role="group" aria-label="Window" className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <SegmentedControl options={WINDOWS} value={win} onChange={onWin} size="sm" />
        <span className="text-meta tabular-nums text-fg-muted">{windowLabel} · today left out</span>
      </div>
    </div>
  )
}
