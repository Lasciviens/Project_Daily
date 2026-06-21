import type { Task } from '../../todo/types'

interface Props {
  task: Task | null
  onMarkDone: (id: string) => void
  onClearFocus: () => void
}

const PRIORITY_LABEL: Record<string, string> = {
  high:   'High',
  medium: 'Medium',
  low:    'Low',
}

const PRIORITY_BADGE: Record<string, string> = {
  high:   'bg-red-100 text-red-600',
  medium: 'bg-accent-100 text-accent-600',
  low:    'bg-ink-100 text-ink-500',
}

const STATUS_BADGE: Record<string, string> = {
  open:        'bg-ink-100 text-ink-600',
  in_progress: 'bg-accent-100 text-accent-600',
  waiting:     'bg-sky-100 text-sky-700',
  done:        'bg-green-100 text-green-700',
  cancelled:   'bg-ink-100 text-ink-400',
}

const STATUS_LABEL: Record<string, string> = {
  open:        'Open',
  in_progress: 'In Progress',
  waiting:     'Waiting',
  done:        'Done',
  cancelled:   'Cancelled',
}

export default function HeroTaskWidget({ task, onMarkDone, onClearFocus }: Props) {
  if (!task) {
    return (
      <div className="rounded-xl border border-ink-200 bg-cream-50 px-4 py-5 flex items-center gap-2 text-ink-400 text-sm">
        <span className="text-base">⚡</span>
        <span>No focus set — click ⚡ on any task to start</span>
      </div>
    )
  }

  return (
    <div className="rounded-xl border-l-4 border-accent-400 bg-accent-50 border border-accent-200 px-4 py-4 flex flex-col gap-3">
      {/* Label */}
      <span className="text-[10px] font-bold uppercase tracking-widest text-accent-500">
        Focus
      </span>

      {/* Title */}
      <p className="text-lg font-bold text-ink-900 leading-snug">
        {task.title}
      </p>

      {/* Badges row */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={[
            'text-[11px] font-medium px-2 py-0.5 rounded-full',
            PRIORITY_BADGE[task.priority] ?? 'bg-ink-100 text-ink-500',
          ].join(' ')}
        >
          {PRIORITY_LABEL[task.priority] ?? task.priority} priority
        </span>
        <span
          className={[
            'text-[11px] font-medium px-2 py-0.5 rounded-full',
            STATUS_BADGE[task.status] ?? 'bg-ink-100 text-ink-500',
          ].join(' ')}
        >
          {STATUS_LABEL[task.status] ?? task.status}
        </span>
      </div>

      {/* Waiting for */}
      {task.waiting_for && (
        <p className="text-sm text-sky-600">
          Waiting for: <span className="font-medium">{task.waiting_for}</span>
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => onMarkDone(task.id)}
          className="min-h-[44px] flex-1 sm:flex-none sm:px-4 flex items-center justify-center gap-1.5 rounded-lg bg-accent-500 text-white text-sm font-medium hover:bg-accent-600 transition-colors"
        >
          ✓ Mark done
        </button>
        <button
          onClick={onClearFocus}
          className="min-h-[44px] px-3 flex items-center justify-center text-sm text-ink-500 hover:text-ink-700 transition-colors"
        >
          Clear focus
        </button>
      </div>
    </div>
  )
}
