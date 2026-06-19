import { useState } from 'react'
import { format, isToday, isTomorrow, isPast } from 'date-fns'
import type { Task } from '../types'
import { useToggleTask, useDeleteTask } from '../hooks/useTodos'
import { AddTaskModal } from '../../../shared/components/AddTaskModal'

const PRIORITY_DOT: Record<Task['priority'], string> = {
  low:    'bg-ink-300',
  medium: 'bg-accent-400',
  high:   'bg-red-400 ring-1 ring-red-300',
}

function dueDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  if (isToday(d))    return 'Today'
  if (isTomorrow(d)) return 'Tomorrow'
  return format(d, 'd MMM')
}

function dueDateCls(dateStr: string, isDone: boolean): string {
  if (isDone) return 'bg-ink-100 text-ink-400'
  const d = new Date(dateStr + 'T23:59:59')
  if (isPast(d)) return 'bg-red-50 text-red-500'
  const d0 = new Date(dateStr + 'T00:00:00')
  if (isToday(d0) || isTomorrow(d0)) return 'bg-accent-50 text-accent-600'
  return 'bg-ink-100 text-ink-500'
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
  const [editing, setEditing] = useState(false)
  const toggle = useToggleTask()
  const remove = useDeleteTask()
  const isDone = task.status === 'done'

  return (
    <>
      <div
        className={`group flex items-start gap-2.5 px-3 py-2 rounded-lg transition-colors duration-150 ${
          hovered ? 'bg-cream-100' : ''
        }`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Circle checkbox — matches Google Tasks iPhone style */}
        <button
          onClick={() => toggle.mutate({ id: task.id, isDone: !isDone })}
          disabled={toggle.isPending}
          aria-label={isDone ? 'Mark as open' : 'Mark as done'}
          className="flex-shrink-0 flex items-center justify-center min-w-[44px] min-h-[44px] lg:min-w-0 lg:min-h-0 lg:w-auto lg:h-auto -ml-3 lg:ml-0 lg:mt-0.5"
        >
          <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all duration-150 ${
            isDone
              ? 'bg-accent-500 border-accent-500'
              : 'border-ink-300 hover:border-accent-400'
          }`}>
            {isDone && (
              <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
        </button>

        <div className="flex-1 min-w-0 py-0.5">
          {/* Title row with priority dot */}
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${PRIORITY_DOT[task.priority]}`} />
            <span className={`text-sm leading-snug ${isDone ? 'line-through text-ink-400' : 'text-ink-800'}`}>
              {task.title}
            </span>
          </div>
          {/* Due date chip + description */}
          {(task.due_date || task.description) && (
            <div className="flex items-center gap-1.5 mt-1 ml-3">
              {task.due_date && (
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${dueDateCls(task.due_date, isDone)}`}>
                  {dueDateLabel(task.due_date)}
                </span>
              )}
              {task.description && (
                <span className="text-[11px] text-ink-400 truncate max-w-[150px]">{task.description}</span>
              )}
            </div>
          )}
        </div>

        {/* Actions — always visible on mobile, hover on desktop */}
        <div className="flex items-center gap-0.5 flex-shrink-0 lg:hidden">
          {onMoveUp && (
            <button
              onClick={onMoveUp}
              disabled={!canMoveUp}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-300 hover:text-ink-600 disabled:opacity-20 transition-colors duration-150 text-xs"
              title="Move up"
            >↑</button>
          )}
          {onMoveDown && (
            <button
              onClick={onMoveDown}
              disabled={!canMoveDown}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-300 hover:text-ink-600 disabled:opacity-20 transition-colors duration-150 text-xs"
              title="Move down"
            >↓</button>
          )}
          <button
            onClick={() => setEditing(true)}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-300 hover:text-accent-500 transition-colors duration-150 text-[11px]"
            title="Edit"
          >✎</button>
          <button
            onClick={() => remove.mutate(task.id)}
            disabled={remove.isPending}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-300 hover:text-red-400 transition-colors duration-150 text-xs"
            title="Delete"
          >✕</button>
        </div>
        {hovered && (
          <div className="hidden lg:flex items-center gap-0.5 flex-shrink-0 mt-0.5">
            {onMoveUp && (
              <button
                onClick={onMoveUp}
                disabled={!canMoveUp}
                className="w-5 h-5 flex items-center justify-center text-ink-300 hover:text-ink-600 disabled:opacity-20 transition-colors duration-150 text-xs"
                title="Move up"
              >↑</button>
            )}
            {onMoveDown && (
              <button
                onClick={onMoveDown}
                disabled={!canMoveDown}
                className="w-5 h-5 flex items-center justify-center text-ink-300 hover:text-ink-600 disabled:opacity-20 transition-colors duration-150 text-xs"
                title="Move down"
              >↓</button>
            )}
            <button
              onClick={() => setEditing(true)}
              className="w-5 h-5 flex items-center justify-center text-ink-300 hover:text-accent-500 transition-colors duration-150 text-[11px]"
              title="Edit"
            >✎</button>
            <button
              onClick={() => remove.mutate(task.id)}
              disabled={remove.isPending}
              className="w-5 h-5 flex items-center justify-center text-ink-300 hover:text-red-400 transition-colors duration-150 text-xs"
              title="Delete"
            >✕</button>
          </div>
        )}
      </div>

      <AddTaskModal
        isOpen={editing}
        onClose={() => setEditing(false)}
        task={task}
      />
    </>
  )
}
