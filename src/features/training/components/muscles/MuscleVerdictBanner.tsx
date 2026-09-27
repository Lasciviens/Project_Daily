import { ArrowDown, ArrowUp, Plus, Scale, Target } from 'lucide-react'
import { Card } from '../../../../shared/ui'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import type { Verdict } from './muscleVolumeModel'

const BULLET_ICON = { down: ArrowDown, add: Plus, up: ArrowUp, balance: Scale } as const

/** The plain-language "am I OK?" answer, first. */
export function MuscleVerdictBanner({ verdict }: { verdict: Verdict }) {
  return (
    <Card className="flex flex-col gap-2">
      <p className="flex items-center gap-1.5 text-ui font-semibold text-fg">
        <Target className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />{verdict.headline}
        <InfoBubble>
          <p className="mb-1 font-semibold text-fg">How this is judged</p>
          <p>Each muscle's weekly hard working sets are compared to typical growth landmarks (MEV–MAV–MRV). This measures <strong>volume only</strong> — not how hard you pushed each set, nor recovery. Landmarks are population guidance (±several sets), not personalised targets.</p>
        </InfoBubble>
      </p>
      {verdict.bullets.length > 0 && (
        <ul className="flex flex-col gap-1">
          {verdict.bullets.map((b, i) => {
            const Icon = BULLET_ICON[b.icon]
            return (
              <li key={i} className="flex items-start gap-1.5 text-body text-fg-2">
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden />
                <span>{b.text}</span>
              </li>
            )
          })}
          {verdict.extra > 0 && <li className="text-meta text-fg-muted">+{verdict.extra} more below</li>}
        </ul>
      )}
    </Card>
  )
}
