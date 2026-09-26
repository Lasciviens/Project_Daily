import { useState } from 'react'
import { AlertTriangle, ChevronDown } from 'lucide-react'
import type { Task, TaskStatus } from '../../todo/types'
import { cx } from '../../../shared/ui'
import WorkTaskCard from './WorkTaskCard'
import { OVERDUE_TONE } from './workMeta'

interface Props {
  tasks: Task[]
  onStatusChange: (id: string, status: TaskStatus, waitingFor?: string) => void
  onDelete: (id: string) => void
  onEdit: (task: Task) => void
  onFocus: (task: Task) => void
}

// Overdue is a property, not a board column: these tasks surface here above
// the board (in-progress ones stay on the board — see WorkBoard). The strip
// is sized to its cards, never a full-width band round a single card.
export default function OverdueStrip({ tasks, onStatusChange, onDelete, onEdit, onFocus }: Props) {
  const [open, setOpen] = useState(true)
  if (tasks.length === 0) return null

  return (
    <section data-tone={OVERDUE_TONE} className="max-w-full rounded-card border border-danger/30 bg-danger-soft/50 sm:w-fit sm:min-w-[22rem]">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="tone-text flex min-h-[44px] w-full items-center gap-2 px-4 py-2 text-left"
      >
        <AlertTriangle aria-hidden className="h-4 w-4" />
        <span className="flex-1 text-micro font-semibold uppercase tracking-[0.09em]">Overdue · {tasks.length}</span>
        <ChevronDown aria-hidden className={cx('h-4 w-4 transition-transform', !open && '-rotate-90')} />
      </button>
      {open && (
        <div className="flex flex-col gap-2 px-2 pb-2 sm:flex-row sm:flex-wrap sm:items-start">
          {tasks.map(task => (
            <div key={task.id} className="sm:w-[21rem]">
            <WorkTaskCard
              task={task}
              accentTone={OVERDUE_TONE}
              onStatusChange={onStatusChange}
              onDelete={onDelete}
              onEdit={onEdit}
              onFocus={onFocus}
              isFocused={task.is_focused}
            />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
