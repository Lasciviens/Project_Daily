import { useState } from 'react'
import { CircleHelp, Moon, Trash2 } from 'lucide-react'
import { DateInput } from '../../../shared/components/DateInput'
import { Button, Card, CardHeader, IconButton, Truncate } from '../../../shared/ui'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useDecisionActions } from '../../todo/hooks/useNeedsDecision'
import type { DecisionRow } from '../../todo/needsDecision'

const FIRST = 4

/**
 * Tasks nobody has settled: a week or more late, or undated for 30+ days. Each
 * row answers in one tap — pick a day, Someday, Delete (asks, with Undo). It
 * only adds a list; every task still shows in its usual groups below.
 */
export function NeedsDecisionCard({ rows }: { rows: DecisionRow[] }) {
  const act = useDecisionActions()
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, FIRST)
  const today = todayStr()
  return (
    <Card className="max-w-2xl">
      <CardHeader icon={<CircleHelp />} title="Needs a decision" subtitle={`${rows.length} ${rows.length === 1 ? 'task is' : 'tasks are'} stuck or undated for a long time`} />
      <ul className="flex flex-col divide-y divide-line">
        {shown.map(({ task, text }) => (
          <li key={task.id} className="flex flex-col gap-1.5 py-2 first:pt-0 last:pb-0">
            <button type="button" onClick={() => act.open(task)} className="flex min-w-0 flex-col text-left">
              <Truncate as="span" className="text-body text-fg">{task.title}</Truncate>
              <span className="text-meta tabular-nums text-fg-muted">{text}</span>
            </button>
            <div className="flex items-center gap-2">
              <DateInput value="" min={today} placeholder="Pick a day" aria-label={`Pick a day for ${task.title}`}
                onChange={d => { if (d) void act.pickDay(task, d) }} className="input input-sm h-8 w-[8.5rem] tabular-nums" />
              <Button size="sm" icon={<Moon />} disabled={act.busy} onClick={() => void act.someday(task)}>Someday</Button>
              <IconButton label={`Delete ${task.title}`} className="ml-auto text-danger" disabled={act.busy} onClick={() => void act.remove(task)}><Trash2 /></IconButton>
            </div>
          </li>
        ))}
      </ul>
      {rows.length > FIRST && (
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => setAll(a => !a)}>{all ? 'Show fewer' : `Show all ${rows.length}`}</Button>
      )}
    </Card>
  )
}
