import { useState } from 'react'
import { format } from 'date-fns'
import type { Task } from '../types'
import { useToggleTask, useDeleteTask } from '../hooks/useTodos'

const PRIORITY_DOT: Record<Task['priority'], string> = {
  low:    'bg-ink-300',
  medium: 'bg-amber-400',
  high:   'bg-red-400',
}

const DOMAIN_BADGE: Record<Task['domain'], string> = {
  personal: '',
  work:     'Work',
  media:    'Media',
}

interface Props { task: Task }

export function ToDoItem({ task }: Props) {
  const [hovered, setHovered] = useState(false)
  const toggle = useToggleTask()
  const remove = useDeleteTask()
  const isDone = task.status === 'done'

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
            ? 'bg-amber-500 border-amber-500 text-white'
            : 'border-ink-300 hover:border-amber-400'
        }`}
      >
        {isDone && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path
              d="M1 4L3.5 6.5L9 1"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${PRIORITY_DOT[task.priority]}`} />
          <span className={`text-sm leading-snug truncate ${isDone ? 'line-through text-ink-400' : 'text-ink-800'}`}>
            {task.title}
          </span>
        </div>
        {(task.due_date || DOMAIN_BADGE[task.domain]) && (
          <div className="flex items-center gap-2 mt-0.5 ml-3">
            {task.due_date && (
              <span className="text-[11px] text-ink-400">
                {format(new Date(task.due_date + 'T00:00:00'), 'MMM d')}
              </span>
            )}
            {DOMAIN_BADGE[task.domain] && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-ink-100 text-ink-500 font-medium">
                {DOMAIN_BADGE[task.domain]}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Delete (hover) */}
      {hovered && (
        <button
          onClick={() => remove.mutate(task.id)}
          disabled={remove.isPending}
          className="text-ink-300 hover:text-red-400 transition-colors duration-150 text-sm mt-0.5 flex-shrink-0"
        >
          ✕
        </button>
      )}
    </div>
  )
}
