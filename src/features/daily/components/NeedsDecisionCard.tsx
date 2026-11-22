import { useState } from 'react'
import { CircleHelp, Moon, Trash2 } from 'lucide-react'
import { DateInput } from '../../../shared/components/DateInput'
import { Button, Card, CardHeader, IconButton, Truncate } from '../../../shared/ui'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useDecisionActions } from '../../todo/hooks/useNeedsDecision'
import type { DecisionRow } from '../../todo/needsDecision'

const FIRST = 3

/**
 * Tasks nobody has settled: a week or more late, or undated for 30+ days. Each
 * row answers in one tap — pick a day, Someday, Delete (asks, with Undo). It
 * only adds a card; every task still shows in its usual groups.
 */
export function NeedsDecisionCard({ rows }: { rows: DecisionRow[] }) {
  const act = useDecisionActions()
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, FIRST)
  const today = todayStr()
  return (
    <Card className="@container">
      <CardHeader icon={<CircleHelp />} title="Needs a decision" action={<span className="count-badge">{rows.length}</span>} />
      <ul className="flex flex-col divide-y divide-line">
        {shown.map(({ task, text }) => (
          <li key={task.id} className="flex flex-col gap-1.5 py-2 first:pt-0 last:pb-0 @[30rem]:flex-row @[30rem]:items-center @[30rem]:gap-3">
            <button type="button" onClick={() => act.open(task)} className="flex min-w-0 flex-1 flex-col text-left">
              <Truncate as="span" className="text-body text-fg">{task.title}</Truncate>
              <span className="text-meta tabular-nums text-fg-muted">{text}</span>
            </button>
            <div className="flex shrink-0 items-center gap-2">
              <div className="w-[9.5rem]">
                <DateInput value="" min={today} placeholder="Pick a day" aria-label={`Pick a day for ${task.title}`} disabled={act.busy} compact
                  onChange={d => { if (d) void act.pickDay(task, d) }} className="input input-sm h-8 w-full tabular-nums" />
              </div>
              <Button size="sm" icon={<Moon />} disabled={act.busy} onClick={() => void act.someday(task)}>Someday</Button>
              <IconButton label={`Delete ${task.title}`} className="ml-auto text-danger" disabled={act.busy} onClick={() => void act.remove(task)}><Trash2 /></IconButton>
            </div>
          </li>
        ))}
      </ul>
      {rows.length > FIRST && (
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => setAll(a => !a)}>
          {all ? 'Show fewer' : `${rows.length - FIRST} more`}
        </Button>
      )}
    </Card>
  )
}
