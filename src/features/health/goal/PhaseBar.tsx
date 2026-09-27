import { SegmentedControl } from '../../../shared/ui'
import { useEntityModal } from '../../../shared/modals/useEntityModal'
import type { NutritionGoal } from '../../daily/hooks/useDayTargets'
import type { GoalWindow } from './useGoalReport'
import { PHASE_LABEL, kcal } from './goalCopy'
import type { usePhase } from './useBodyGoals'

const PHASES: { value: NutritionGoal; label: string }[] = (['cut', 'maintain', 'gain'] as const).map(p => ({ value: p, label: PHASE_LABEL[p] }))
const WINDOWS: { value: `${GoalWindow}`; label: string }[] = [
  { value: '14', label: '14 days' },
  { value: '28', label: '28 days' },
  { value: '56', label: '56 days' },
]

/** The phase (your nutrition goal — the same setting as Food → Goals) and the
 *  window the report reads. */
export function PhaseBar({ phase, win, onWin }: {
  phase: ReturnType<typeof usePhase>; win: `${GoalWindow}`; onWin: (w: `${GoalWindow}`) => void
}) {
  const modal = useEntityModal()
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div role="group" aria-label="Phase">
          <p className="field-label mb-1">Phase</p>
          <SegmentedControl options={PHASES} value={phase.phase} onChange={phase.setPhase} size="sm" />
        </div>
        <div role="group" aria-label="Window">
          <p className="field-label mb-1">Window</p>
          <SegmentedControl options={WINDOWS} value={win} onChange={onWin} size="sm" />
        </div>
      </div>
      <p className="text-meta text-fg-muted">
        The phase is your nutrition goal — changing it here changes it in Food too. Target{' '}
        <span className="tabular-nums text-fg-2">{kcal(phase.targetKcal)} kcal</span> ·{' '}
        <span className="tabular-nums text-fg-2">{phase.targetProtein} g protein</span>{' '}
        <button type="button" onClick={() => modal.open({ kind: 'day-targets' })}
          className="inline-flex min-h-[44px] items-center font-semibold text-accent-600 sm:min-h-0">Adjust targets</button>
      </p>
    </div>
  )
}
