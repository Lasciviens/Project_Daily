import { useState } from 'react'
import type { Task } from '../../todo/types'

interface Props {
  tasks:        Task[]         // all focused tasks
  onMarkDone:   (id: string) => void
  onClearFocus: (id: string) => void
  onEdit:       (task: Task) => void
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
  open: 'Open', in_progress: 'In Progress', waiting: 'Waiting',
  done: 'Done', cancelled: 'Cancelled',
}

function FocusCard({ task, onMarkDone, onClearFocus, onEdit }: {
  task: Task
  onMarkDone: (id: string) => void
  onClearFocus: (id: string) => void
  onEdit: (task: Task) => void
}) {
  return (
    <div className="flex-1 min-w-0 rounded-xl border-l-4 border-accent-400 bg-accent-50 border border-accent-200 px-4 py-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-accent-500">Focus</span>
        <button
          onClick={() => onClearFocus(task.id)}
          className="text-[10px] text-ink-400 hover:text-red-400 transition-colors min-h-[28px] px-1"
        >
          ✕ Remove
        </button>
      </div>

      <p
        className="text-base font-bold text-ink-900 leading-snug cursor-pointer hover:text-accent-700 transition-colors"
        onClick={() => onEdit(task)}
      >
        {task.title}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${PRIORITY_BADGE[task.priority] ?? 'bg-ink-100 text-ink-500'}`}>
          {task.priority} priority
        </span>
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[task.status] ?? 'bg-ink-100 text-ink-500'}`}>
          {STATUS_LABEL[task.status] ?? task.status}
        </span>
        {task.due_date && (
          <span className="text-[11px] text-ink-400 bg-ink-100 px-2 py-0.5 rounded-full">
            {task.due_date}
          </span>
        )}
      </div>

      {task.waiting_for && (
        <p className="text-xs text-sky-600">
          Waiting for: <span className="font-medium">{task.waiting_for}</span>
        </p>
      )}

      <button
        onClick={() => onMarkDone(task.id)}
        className="min-h-[44px] flex items-center justify-center gap-1.5 rounded-lg bg-accent-500 text-white text-sm font-medium hover:bg-accent-600 transition-colors w-full sm:w-auto sm:px-4"
      >
        ✓ Mark done
      </button>
    </div>
  )
}

export default function HeroTaskWidget({ tasks, onMarkDone, onClearFocus, onEdit }: Props) {
  const [extraOffset, setExtraOffset] = useState(0)

  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border border-ink-200 bg-cream-50 px-4 py-5 flex items-center gap-2 text-ink-400 text-sm">
        <span className="text-base">⚡</span>
        <span>No focus set — click ⚡ on any task to focus it</span>
      </div>
    )
  }

  // Show 2 primary cards; rest navigable via up/down
  const primaryPair = tasks.slice(0, 2)
  const extras      = tasks.slice(2)
  const hasExtras   = extras.length > 0
  const extraTask   = extras[extraOffset] ?? null

  return (
    <div className="flex gap-2">
      {/* Main focus cards */}
      <div className="flex-1 min-w-0 flex flex-col sm:flex-row gap-2">
        {primaryPair.map(t => (
          <FocusCard
            key={t.id}
            task={t}
            onMarkDone={onMarkDone}
            onClearFocus={onClearFocus}
            onEdit={onEdit}
          />
        ))}
        {extraTask && (
          <FocusCard
            key={extraTask.id}
            task={extraTask}
            onMarkDone={onMarkDone}
            onClearFocus={onClearFocus}
            onEdit={onEdit}
          />
        )}
      </div>

      {/* Vertical navigation for extras */}
      {hasExtras && (
        <div className="flex flex-col items-center justify-center gap-1 flex-shrink-0">
          <button
            onClick={() => setExtraOffset(o => Math.max(0, o - 1))}
            disabled={extraOffset === 0}
            className="flex items-center justify-center w-8 h-10 rounded-lg border border-ink-200 text-ink-400 hover:bg-ink-100 hover:text-ink-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors min-h-[44px]"
            title="Previous"
          >
            ▲
          </button>
          <span className="text-[10px] text-ink-400 tabular-nums text-center leading-tight">
            {extraOffset + 1}/{extras.length}
          </span>
          <button
            onClick={() => setExtraOffset(o => Math.min(extras.length - 1, o + 1))}
            disabled={extraOffset >= extras.length - 1}
            className="flex items-center justify-center w-8 h-10 rounded-lg border border-ink-200 text-ink-400 hover:bg-ink-100 hover:text-ink-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors min-h-[44px]"
            title="Next"
          >
            ▼
          </button>
        </div>
      )}
    </div>
  )
}
