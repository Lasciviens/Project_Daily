import React, { useState, useRef, useEffect } from 'react'
import type { Task, TaskStatus } from '../../todo/types'

interface Props {
  task: Task
  columnColor?: string
  onStatusChange: (id: string, status: TaskStatus, waitingFor?: string) => void
  onDelete: (id: string) => void
  onEdit: (task: Task) => void
  onFocus: (task: Task) => void
  isFocused: boolean
  isDragging?: boolean
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
  columnColor,
  onStatusChange,
  onDelete,
  onEdit,
  onFocus,
  isFocused,
  isDragging,
}: Props) {
  const isDone = task.status === 'done'
  const [editingWaiting, setEditingWaiting] = useState(false)
  const [waitingText,    setWaitingText]    = useState(task.waiting_for ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingWaiting) inputRef.current?.focus()
  }, [editingWaiting])

  function commitWaiting() {
    setEditingWaiting(false)
    onStatusChange(task.id, 'waiting', waitingText.trim() || undefined)
  }

  function handleDragStart(e: React.DragEvent<HTMLDivElement>) {
    e.dataTransfer.setData('taskId', task.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleToggleDone(e: React.MouseEvent) {
    e.stopPropagation()
    onStatusChange(task.id, isDone ? 'open' : 'done')
  }

  const cardStyle: React.CSSProperties = {
    borderLeftColor: columnColor ?? '#CBD5E1',
    background: columnColor
      ? `linear-gradient(to right, ${columnColor}1A 0%, white 65%)`
      : 'white',
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onClick={() => onEdit(task)}
      style={cardStyle}
      className={[
        'group relative rounded-lg border border-ink-200 border-l-4 p-2 cursor-pointer select-none transition-all hover:shadow-sm hover:border-ink-300',
        isDone     ? 'opacity-60' : '',
        isDragging ? 'opacity-40' : '',
      ].join(' ')}
    >
      {/* Status badge top-right */}
      <span
        className={[
          'absolute top-1.5 right-1.5 text-[9px] font-medium px-1 py-0.5 rounded-full',
          STATUS_BADGE[task.status] ?? 'bg-ink-100 text-ink-500',
        ].join(' ')}
      >
        {STATUS_LABEL[task.status] ?? task.status}
      </span>

      {/* Priority dot + title */}
      <div className="flex items-center gap-1 pr-14">
        <span className={['flex-shrink-0 w-1.5 h-1.5 rounded-full', PRIORITY_DOT[task.priority] ?? 'bg-ink-300'].join(' ')} />
        <span className={['text-xs font-semibold text-ink-900 truncate', isDone ? 'line-through text-ink-400' : ''].join(' ')}>
          {task.title}
        </span>
      </div>

      {/* Due date */}
      {task.due_date && !isDone && (
        <div className="mt-0.5 pl-2.5">
          <span className="text-[9px] text-ink-400">{task.due_date}</span>
        </div>
      )}

      {/* Waiting pill */}
      {task.status === 'waiting' && (
        <div className="mt-1 pl-2.5">
          {editingWaiting ? (
            <input
              ref={inputRef}
              value={waitingText}
              onChange={e => setWaitingText(e.target.value)}
              onBlur={commitWaiting}
              onKeyDown={e => {
                if (e.key === 'Enter') commitWaiting()
                if (e.key === 'Escape') setEditingWaiting(false)
              }}
              placeholder="Waiting for…"
              className="text-[10px] bg-sky-50 border border-sky-300 text-sky-800 rounded-full px-2 py-0.5 outline-none w-32"
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <button
              onClick={e => { e.stopPropagation(); setEditingWaiting(true) }}
              title="Click to set who/what you're waiting for"
              className="inline-flex items-center gap-1 text-[10px] bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded-full hover:bg-sky-200 transition-colors"
            >
              ⏳ {task.waiting_for || <span className="italic opacity-60">tap to add…</span>}
            </button>
          )}
        </div>
      )}

      {/* Action row */}
      <div
        className="flex items-center gap-0.5 mt-1.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={handleToggleDone}
          title={isDone ? 'Reopen' : 'Mark done'}
          className="min-h-[44px] min-w-[44px] md:min-h-[24px] md:min-w-[24px] flex items-center justify-center rounded text-[11px] text-green-600 hover:bg-green-50 hover:text-green-700 transition-colors"
        >
          {isDone ? '↩' : '✓'}
        </button>

        <button
          onClick={e => { e.stopPropagation(); onFocus(task) }}
          title={isFocused ? 'Remove focus' : 'Set as focus'}
          className={[
            'min-h-[44px] min-w-[44px] md:min-h-[24px] md:min-w-[24px] flex items-center justify-center rounded text-[11px] transition-colors',
            isFocused
              ? 'text-accent-500 bg-accent-50 hover:bg-accent-100'
              : 'text-ink-400 hover:bg-ink-100 hover:text-ink-600',
          ].join(' ')}
        >
          ⚡
        </button>

        <button
          onClick={e => { e.stopPropagation(); onEdit(task) }}
          title="Edit task"
          className="min-h-[44px] min-w-[44px] md:min-h-[24px] md:min-w-[24px] flex items-center justify-center rounded text-[11px] text-ink-400 hover:bg-ink-100 hover:text-ink-600 transition-colors"
        >
          ✎
        </button>

        <button
          onClick={e => { e.stopPropagation(); onDelete(task.id) }}
          title="Delete task"
          className="min-h-[44px] min-w-[44px] md:min-h-[24px] md:min-w-[24px] flex items-center justify-center rounded text-[11px] text-ink-400 hover:bg-red-50 hover:text-red-500 transition-colors"
        >
          ×
        </button>
      </div>
    </div>
  )
}
