import { Target } from 'lucide-react'
import { cx } from '../../../shared/ui'
import { useEntityModal } from '../../../shared/modals/useEntityModal'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useDayTargets } from '../hooks/useDayTargets'
import { goalSummaryParts } from '../goalSummary'

/** "Your goal · Cut since 1 Sep · 1,950 kcal · 180 g protein · → 78 kg — Edit
 *  goal". The same line on Food, Daily and Health, so the numbers read as one
 *  goal saved in one place; Edit opens the one goal editor. */
export function GoalSummary({ date, className }: { date?: string; className?: string }) {
  const { targets, isLoaded } = useDayTargets()
  const modal = useEntityModal()
  const parts = goalSummaryParts(targets, todayStr())
  return (
    <div className={cx('flex items-center gap-2 text-meta', className)}>
      <Target className="h-3.5 w-3.5 shrink-0 text-accent-600" aria-hidden />
      <p className={cx('min-w-0 flex-1 py-1 tabular-nums text-fg-2', !isLoaded && 'opacity-60')}>
        <span className="font-semibold text-fg">Your goal</span>
        {parts.map((p, i) => (
          <span key={i}><span aria-hidden className="text-fg-faint"> · </span><span className="whitespace-nowrap">{p}</span></span>
        ))}
      </p>
      <button type="button" onClick={() => modal.open({ kind: 'day-targets', date })}
        className="inline-flex min-h-[44px] shrink-0 items-center font-semibold text-accent-600 transition-colors hover:text-accent-700">
        Edit goal
      </button>
    </div>
  )
}
