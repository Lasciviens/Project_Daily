import { Check, X, Zap } from 'lucide-react'
import type { Task } from '../../todo/types'
import { Button, IconButton } from '../../../shared/ui'
import { DueChip, PriorityMark, WaitingChip } from './WorkTaskBits'

interface Props {
  tasks:        Task[]
  onMarkDone:   (id: string) => void
  onClearFocus: (id: string) => void
  onEdit:       (task: Task) => void
}

// The "what am I doing right now" zone — focused tasks as a horizontal
// snap-scroll strip of fixed-width cards (never stretched to the row width).
export default function FocusStrip({ tasks, onMarkDone, onClearFocus, onEdit }: Props) {
  if (tasks.length === 0) {
    return (
      <p className="flex w-fit items-center gap-2 rounded-row border border-dashed border-line px-3 py-2.5 text-meta text-fg-muted">
        <Zap aria-hidden className="h-3.5 w-3.5 text-fg-faint" />
        No focus yet — tap the bolt on any task to pin it here
      </p>
    )
  }

  return (
    <div className="scroll-x -mx-4 flex snap-x snap-mandatory gap-3 px-4 pb-1 sm:mx-0 sm:px-0">
      {tasks.map(task => (
        <article
          key={task.id}
          className="card flex w-[17.5rem] shrink-0 snap-start flex-col gap-2 border-accent-500/30 p-3.5 sm:w-[20rem]"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-micro font-semibold uppercase tracking-[0.09em] text-accent-600">
              <Zap aria-hidden className="h-3 w-3 fill-current" /> Focus
            </span>
            <IconButton label="Remove focus" onClick={() => onClearFocus(task.id)} className="-my-1.5 -mr-1.5">
              <X />
            </IconButton>
          </div>

          <button
            type="button"
            onClick={() => onEdit(task)}
            title={task.title}
            className="truncate text-left text-ui font-semibold text-fg transition-colors [@media(hover:hover)]:hover:text-accent-600"
          >
            {task.title}
          </button>

          <div className="flex flex-wrap items-center gap-1.5">
            <PriorityMark task={task} withLabel />
            <DueChip task={task} />
            {task.waiting_for && <WaitingChip text={task.waiting_for} />}
            <Button variant="primary" size="sm" icon={<Check />} onClick={() => onMarkDone(task.id)} className="ml-auto">
              Done
            </Button>
          </div>
        </article>
      ))}
    </div>
  )
}
