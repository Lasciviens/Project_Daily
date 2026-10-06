import { Target } from 'lucide-react'
import { MetaLine, cx } from '../../../shared/ui'
import { useEntityModal } from '../../../shared/modals/useEntityModal'
import { useDayTargets } from '../hooks/useDayTargets'
import { goalSummaryParts } from '../goalSummary'

/** "Your goal · Cut since 01.09.2026 — Edit goal", then "1,950 kcal · 180 g
 *  protein · → 78 kg". The same line on Food, Daily and Health, so the numbers read as one
 *  goal saved in one place; Edit opens the one goal editor. */
export function GoalSummary({ date, className }: { date?: string; className?: string }) {
  const { targets, isLoaded } = useDayTargets()
  const modal = useEntityModal()
  const parts = goalSummaryParts(targets)
  // Two deliberate lines: the heading + phase beside Edit goal, then the
  // numbers — wrapping only between whole facts, never mid "180 g protein".
  const [phase, ...rest] = parts
  const numbers = rest.flatMap(p => p.split(' · '))   // "→ 78 kg · 15 % body fat" → two facts
  return (
    <div className={cx('text-meta tabular-nums', !isLoaded && 'opacity-60', className)}>
      <div className="flex items-center gap-2">
        <Target className="h-3.5 w-3.5 shrink-0 text-accent-600" aria-hidden />
        <p className="min-w-0 flex-1 text-fg-2">
          <span className="font-semibold text-fg">Your goal</span>
          {phase && <><span aria-hidden className="text-fg-faint"> · </span><span className="whitespace-nowrap">{phase}</span></>}
        </p>
        <button type="button" onClick={() => modal.open({ kind: 'day-targets', date })}
          className="-my-2 inline-flex min-h-[44px] shrink-0 items-center font-semibold text-accent-600 transition-colors hover:text-accent-700">
          Edit goal
        </button>
      </div>
      <MetaLine items={numbers} className="pl-[1.375rem] text-fg-2" />
    </div>
  )
}
