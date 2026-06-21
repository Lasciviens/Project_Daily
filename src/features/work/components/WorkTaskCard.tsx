import React from 'react'
import type { Task, TaskStatus } from '../../todo/types'

interface Props {
  task: Task
  onStatusChange: (id: string, status: TaskStatus, waitingFor?: string) => void
  onDelete: (id: string) => void
  onEdit: (task: Task) => void
  onFocus: (task: Task) => void
  isFocused: boolean
  isDragging?: boolean
}

const PRIORITY_BORDER: Record<string, string> = {
  high:   'border-l-red-500',
  medium: 'border-l-accent-400',
  low:    'border-l-ink-200',
}

const PRIORITY_DOT: Record<string, string> = {
  high:   'bg-red-500',
  medium: 'bg-accent-400',
  low:    'bg-ink-300',
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

export default function WorkTaskCard({
  task,
  onStatusChange,
  onDelete,
  onEdit,
  onFocus,
  isFocused,
  isDragging,
}: Props) {
  const isDone = task.status === 'done'

  function handleDragStart(e: React.DragEvent<HTMLDivElement>) {
    e.dataTransfer.setData('taskId', task.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleToggleDone() {
    if (isDone) {
      onStatusChange(task.id, 'open')
    } else {
      onStatusChange(task.id, 'done')
    }
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className={[
        'group relative bg-white rounded-lg border border-ink-200 border-l-4 p-3 cursor-grab active:cursor-grabbing select-none transition-opacity',
        PRIORITY_BORDER[task.priority] ?? 'border-l-ink-200',
        isDone ? 'opacity-60' : '',
        isDragging ? 'opacity-40' : '',
      ].join(' ')}
    >
      {/* Status badge top-right */}
      <span
        className={[
          'absolute top-2 right-2 text-[10px] font-medium px-1.5 py-0.5 rounded-full',
          STATUS_BADGE[task.status] ?? 'bg-ink-100 text-ink-500',
        ].join(' ')}
      >
        {STATUS_LABEL[task.status] ?? task.status}
      </span>

      {/* Top row: priority dot + title */}
      <div className="flex items-center gap-1.5 pr-16">
        <span
          className={[
            'flex-shrink-0 w-2 h-2 rounded-full',
            PRIORITY_DOT[task.priority] ?? 'bg-ink-300',
          ].join(' ')}
        />
        <span
          className={[
            'text-sm font-semibold text-ink-900 truncate',
            isDone ? 'line-through text-ink-400' : '',
          ].join(' ')}
        >
          {task.title}
        </span>
      </div>

      {/* Waiting pill */}
      {task.status === 'waiting' && (
        <div className="mt-1.5 pl-3.5">
          <span className="inline-flex items-center gap-1 text-[11px] bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full">
            Waiting: {task.waiting_for || '…'}
          </span>
        </div>
      )}

      {/* Action row — always visible on mobile, hover on desktop */}
      <div
        className={[
          'flex items-center gap-1 mt-2 transition-opacity',
          'md:opacity-0 md:group-hover:opacity-100',
        ].join(' ')}
      >
        {/* Toggle done */}
        <button
          onClick={handleToggleDone}
          title={isDone ? 'Reopen' : 'Mark done'}
          className="min-h-[44px] min-w-[44px] md:min-h-[28px] md:min-w-[28px] flex items-center justify-center rounded text-xs text-green-600 hover:bg-green-50 transition-colors"
        >
          {isDone ? '↩' : '✓'}
        </button>

        {/* Focus/unfocus */}
        <button
          onClick={() => onFocus(task)}
          title={isFocused ? 'Clear focus' : 'Set as focus'}
          className={[
            'min-h-[44px] min-w-[44px] md:min-h-[28px] md:min-w-[28px] flex items-center justify-center rounded text-xs transition-colors',
            isFocused
              ? 'text-accent-500 hover:bg-accent-50'
              : 'text-ink-400 hover:bg-ink-50',
          ].join(' ')}
        >
          ⚡
        </button>

        {/* Edit */}
        <button
          onClick={() => onEdit(task)}
          title="Edit task"
          className="min-h-[44px] min-w-[44px] md:min-h-[28px] md:min-w-[28px] flex items-center justify-center rounded text-xs text-ink-400 hover:bg-ink-50 transition-colors"
        >
          ✎
        </button>

        {/* Delete */}
        <button
          onClick={() => onDelete(task.id)}
          title="Delete task"
          className="min-h-[44px] min-w-[44px] md:min-h-[28px] md:min-w-[28px] flex items-center justify-center rounded text-xs text-ink-400 hover:bg-red-50 hover:text-red-500 transition-colors"
        >
          ×
        </button>
      </div>
    </div>
  )
}
