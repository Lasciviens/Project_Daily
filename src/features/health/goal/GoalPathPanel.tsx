import { Check, Droplets, Dumbbell, Drumstick, Scale, Utensils, type LucideIcon } from 'lucide-react'
import { ToneDot } from '../../../shared/ui'
import type { GoalPath, StepKey } from './goalPath'

const STEP_ICON: Record<StepKey, LucideIcon> = {
  calories: Utensils, protein: Drumstick, training: Dumbbell, data: Scale, early: Droplets, keep: Check,
}

/** The headline: where the pace, fat vs muscle and protein add up to, and
 *  what to do next. */
export function GoalPathPanel({ path }: { path: GoalPath }) {
  return (
    <div className="rounded-row border border-line bg-surface-2 p-3" aria-live="polite">
      <p className="flex items-start gap-2 text-lead font-semibold text-fg">
        <ToneDot tone={path.tone} className="mt-2 shrink-0" />
        <span>{path.title}</span>
      </p>
      {path.summary.length > 0 && (
        <p className="mt-1 text-body text-fg-2">{path.summary.join(' ')}</p>
      )}
      {path.steps.length > 0 && (
        <>
          <p className="section-label mt-3">Your path</p>
          <ul className="mt-1.5 flex flex-col gap-2">
            {path.steps.map((s, i) => {
              const Icon = STEP_ICON[s.key]
              return (
                <li key={`${s.key}-${i}`} className="flex items-start gap-2 text-body text-fg-2">
                  <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" />
                  <span>{s.text}</span>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
