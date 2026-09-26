import { AlertTriangle, Check, Circle, Hourglass, Zap } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Task } from '../../todo/types'
import type { Tone } from '../../../shared/ui'
import { STATUS_TONE } from '../../todo/taskTones'
import { OVERDUE_TONE, isOverdue, isCompletedToday } from './workMeta'

function StatRow({ icon, label, count, tone }: { icon: ReactNode; label: string; count: number; tone: Tone }) {
  return (
    <li data-tone={tone} className="flex min-h-[36px] items-center gap-3">
      <span aria-hidden className="tone-text [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      <span className="flex-1 text-body text-fg-2">{label}</span>
      <span className={count > 0 ? 'tone-text text-ui font-bold tabular-nums' : 'text-ui font-semibold tabular-nums text-fg-faint'}>{count}</span>
    </li>
  )
}

// Rendered inside WorkSidebar's rail card (no chrome of its own).
export default function EODSummaryWidget({ tasks }: { tasks: Task[] }) {
  const done       = tasks.filter(t => t.status === 'done' && isCompletedToday(t)).length
  const inProgress = tasks.filter(t => t.status === 'in_progress').length
  const open       = tasks.filter(t => t.status === 'open').length
  const waiting    = tasks.filter(t => t.status === 'waiting').length
  const overdue    = tasks.filter(isOverdue).length

  if (done > 0 && inProgress === 0 && open === 0 && waiting === 0 && overdue === 0) {
    return (
      <p data-tone="success" className="tone-text flex items-center gap-2 py-2 text-body font-semibold">
        <Check aria-hidden className="h-4 w-4" /> All clear for today
      </p>
    )
  }

  return (
    <ul className="divide-y divide-line">
      <StatRow icon={<Check />}         label="Done today"  count={done}       tone={STATUS_TONE.done} />
      <StatRow icon={<Zap />}           label="In progress" count={inProgress} tone={STATUS_TONE.in_progress} />
      <StatRow icon={<Circle />}        label="Open"        count={open}       tone={STATUS_TONE.open} />
      <StatRow icon={<Hourglass />}     label="Waiting"     count={waiting}    tone={STATUS_TONE.waiting} />
      <StatRow icon={<AlertTriangle />} label="Overdue"     count={overdue}    tone={OVERDUE_TONE} />
    </ul>
  )
}
