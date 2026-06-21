import type { Task } from '../../todo/types'

interface Props {
  tasks: Task[]
}

const TODAY = new Date().toISOString().slice(0, 10)

function isOverdue(task: Task): boolean {
  if (!task.due_date) return false
  if (task.status === 'done' || task.status === 'cancelled') return false
  return task.due_date < TODAY
}

interface StatRowProps {
  icon: string
  label: string
  count: number
  colorClass: string
}

function StatRow({ icon, label, count, colorClass }: StatRowProps) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="text-base w-5 text-center">{icon}</span>
      <span className="flex-1 text-sm text-ink-600">{label}</span>
      <span className={['text-sm font-bold tabular-nums', colorClass].join(' ')}>
        {count}
      </span>
    </div>
  )
}

export default function EODSummaryWidget({ tasks }: Props) {
  const done       = tasks.filter(t => t.status === 'done').length
  const inProgress = tasks.filter(t => t.status === 'in_progress').length
  const open       = tasks.filter(t => t.status === 'open').length
  const waiting    = tasks.filter(t => t.status === 'waiting').length
  const overdue    = tasks.filter(isOverdue).length

  const allClear = done > 0 && inProgress === 0 && open === 0 && waiting === 0 && overdue === 0

  return (
    <div className="rounded-xl border border-ink-200 bg-white px-4 py-4">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-ink-400 mb-3">
        Today's Summary
      </h3>

      {allClear ? (
        <div className="py-3 text-center text-sm text-green-600 font-medium">
          All clear! 🎉
        </div>
      ) : (
        <div className="divide-y divide-ink-100">
          <StatRow icon="✓"  label="Done today"  count={done}       colorClass="text-green-600" />
          <StatRow icon="⚡" label="In progress"  count={inProgress} colorClass="text-accent-500" />
          <StatRow icon="○"  label="Open"         count={open}       colorClass="text-ink-600" />
          <StatRow icon="⏳" label="Waiting"      count={waiting}    colorClass="text-sky-600" />
          <StatRow icon="⚠" label="Overdue"      count={overdue}    colorClass="text-red-500" />
        </div>
      )}
    </div>
  )
}
