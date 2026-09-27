import { useState } from 'react'
import { ListChecks } from 'lucide-react'
import { Button, Card, CardHeader } from '../../../../shared/ui'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { CurrentProgramPicker } from '../CurrentProgramPicker'
import { daysBetween } from '../../plan/nextSession'
import type { HevyRoutine } from '../../types.hevy'

function lastDone(last: string | undefined, today: string): string {
  if (!last) return 'not trained in 6 months'
  const d = daysBetween(last, today)
  return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`
}

/** Which routines are the current program, and when each was last done. The
 *  picker opens by itself while nothing is chosen. */
export function CurrentProgramCard({ routines, lastTrained, today }: {
  routines: HevyRoutine[]
  lastTrained: ReadonlyMap<string, string>
  today: string
}) {
  const [editing, setEditing] = useState(false)
  const showPicker = editing || routines.length === 0
  return (
    <Card className="max-w-2xl">
      <CardHeader
        wrap
        icon={<ListChecks />}
        title={<span className="inline-flex items-center gap-1.5">Current program <InfoBubble>Everything on Next, Program and Progress is scoped to these routines. Old routines stay in your history but no longer decide targets or verdicts.</InfoBubble></span>}
        subtitle={routines.length > 0 ? `${routines.length} ${routines.length === 1 ? 'routine' : 'routines'}` : 'Not chosen yet'}
        action={routines.length > 0 && <Button size="sm" variant="ghost" onClick={() => setEditing(v => !v)}>{editing ? 'Done' : 'Change'}</Button>}
      />
      {showPicker ? (
        <CurrentProgramPicker onSaved={() => setEditing(false)} />
      ) : (
        // Rows, not chips: a chip never wraps (.chip is nowrap), so a long
        // routine name ran off the card on a phone.
        <ul className="flex flex-col divide-y divide-line">
          {routines.map(r => (
            <li key={r.id} className="flex min-w-0 flex-col py-2 first:pt-0 last:pb-0 sm:flex-row sm:items-baseline sm:gap-2">
              <span className="min-w-0 break-words text-body font-semibold text-fg">{r.title}</span>
              <span className="text-meta text-fg-muted">{r.exercises?.length ?? 0} exercises · last done {lastDone(lastTrained.get(r.id), today)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
