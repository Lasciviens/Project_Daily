import { useState } from 'react'
import type { Task } from '../../todo/types'

interface Props {
  tasks:        Task[]
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
  onMarkDone:   (id: string) => void
  onClearFocus: (id: string) => void
  onEdit:       (task: Task) => void
}) {
  return (
    <div className="flex-1 min-w-0 rounded-xl border-l-4 border-accent-400 bg-accent-50 border border-accent-200 px-4 py-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-accent-500">Focus</span>
        <button
          onClick={() => onClearFocus(task.id)}
          className="text-[10px] text-ink-400 hover:text-red-400 transition-colors min-h-[44px] px-2"
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

const VISIBLE = 2

export default function HeroTaskWidget({ tasks, onMarkDone, onClearFocus, onEdit }: Props) {
  const [offset, setOffset] = useState(0)

  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border border-ink-200 bg-cream-50 px-4 py-5 flex items-center gap-2 text-ink-400 text-sm">
        <span className="text-base">⚡</span>
        <span>No focus set — click ⚡ on any task to focus it</span>
      </div>
    )
  }

  const canPrev    = offset > 0
  const canNext    = offset + VISIBLE < tasks.length
  const visible    = tasks.slice(offset, offset + VISIBLE)
  const totalPages = Math.ceil(tasks.length / VISIBLE)
  const currentPage = Math.floor(offset / VISIBLE) + 1

  return (
    <div className="flex items-stretch gap-2">
      {/* ◀ prev */}
      <button
        onClick={() => setOffset(o => Math.max(0, o - VISIBLE))}
        disabled={!canPrev}
        className="flex-shrink-0 flex items-center justify-center w-9 rounded-xl border border-ink-200 text-ink-400 hover:bg-ink-100 hover:text-ink-700 disabled:opacity-20 disabled:cursor-not-allowed transition-colors min-h-[44px]"
        title="Previous"
      >
        ◀
      </button>

      {/* Focus cards */}
      <div className="flex-1 min-w-0 flex gap-2">
        {visible.map(t => (
          <FocusCard
            key={t.id}
            task={t}
            onMarkDone={onMarkDone}
            onClearFocus={onClearFocus}
            onEdit={onEdit}
          />
        ))}
      </div>

      {/* ▶ next + counter */}
      <div className="flex-shrink-0 flex flex-col items-center justify-center gap-1">
        <button
          onClick={() => setOffset(o => Math.min(tasks.length - VISIBLE, o + VISIBLE))}
          disabled={!canNext}
          className="flex items-center justify-center w-9 rounded-xl border border-ink-200 text-ink-400 hover:bg-ink-100 hover:text-ink-700 disabled:opacity-20 disabled:cursor-not-allowed transition-colors min-h-[44px] flex-1"
          title="Next"
        >
          ▶
        </button>
        {tasks.length > VISIBLE && (
          <span className="text-[10px] text-ink-400 tabular-nums">
            {currentPage}/{totalPages}
          </span>
        )}
      </div>
    </div>
  )
}
