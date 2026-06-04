import { useState } from 'react'
import { format } from 'date-fns'
import type { Task } from '../types'
import { useToggleTask, useDeleteTask } from '../hooks/useTodos'

const PRIORITY_DOT: Record<Task['priority'], string> = {
  low:    'bg-ink-300',
  medium: 'bg-accent-400',
  high:   'bg-red-400 ring-1 ring-red-300',
}

const DOMAIN_TAG: Record<Task['domain'], { label: string; cls: string }> = {
  personal: { label: 'Personal', cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  work:     { label: 'Work',     cls: 'bg-blue-50 text-blue-700 border border-blue-200'         },
  media:    { label: 'Media',    cls: 'bg-purple-50 text-purple-700 border border-purple-200'   },
}

interface Props {
  task:         Task
  canMoveUp?:   boolean
  canMoveDown?: boolean
  onMoveUp?:    () => void
  onMoveDown?:  () => void
}

export function ToDoItem({ task, canMoveUp, canMoveDown, onMoveUp, onMoveDown }: Props) {
  const [hovered, setHovered] = useState(false)
  const toggle = useToggleTask()
  const remove = useDeleteTask()
  const isDone = task.status === 'done'
  const tag    = DOMAIN_TAG[task.domain]

  return (
    <div
      className={`group flex items-start gap-2.5 px-3 py-2 rounded-lg transition-colors duration-150 ${
        hovered ? 'bg-cream-100' : ''
      }`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Checkbox */}
      <button
        onClick={() => toggle.mutate({ id: task.id, isDone: !isDone })}
        disabled={toggle.isPending}
        className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors duration-150 ${
          isDone
            ? 'bg-accent-500 border-accent-500 text-white'
            : 'border-ink-300 hover:border-accent-400'
        }`}
      >
        {isDone && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path d="M1 4L3.5 6.5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${PRIORITY_DOT[task.priority]}`} />
          <span className={`text-sm leading-snug truncate ${isDone ? 'line-through text-ink-400' : 'text-ink-800'}`}>
            {task.title}
          </span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 ml-3">
          {task.due_date && (
            <span className="text-[11px] text-ink-400">
              {format(new Date(task.due_date + 'T00:00:00'), 'MMM d')}
            </span>
          )}
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${tag.cls}`}>
            {tag.label}
          </span>
        </div>
      </div>

      {/* Hover actions */}
      {hovered && (
        <div className="flex items-center gap-0.5 flex-shrink-0 mt-0.5">
          {onMoveUp && (
            <button
              onClick={onMoveUp}
              disabled={!canMoveUp}
              className="w-5 h-5 flex items-center justify-center text-ink-300 hover:text-ink-600 disabled:opacity-20 transition-colors duration-150 text-xs"
              title="Move up"
            >
              ↑
            </button>
          )}
          {onMoveDown && (
            <button
              onClick={onMoveDown}
              disabled={!canMoveDown}
              className="w-5 h-5 flex items-center justify-center text-ink-300 hover:text-ink-600 disabled:opacity-20 transition-colors duration-150 text-xs"
              title="Move down"
            >
              ↓
            </button>
          )}
          <button
            onClick={() => remove.mutate(task.id)}
            disabled={remove.isPending}
            className="w-5 h-5 flex items-center justify-center text-ink-300 hover:text-red-400 transition-colors duration-150 text-xs"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
