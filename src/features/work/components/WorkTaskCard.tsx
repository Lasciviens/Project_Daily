import { useState, useRef, useEffect } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type { Task, TaskStatus } from '../../todo/types'
import { PRIORITY_META, dueLabel } from './workMeta'

interface Props {
  task: Task
  accentColor?: string
  onStatusChange: (id: string, status: TaskStatus, waitingFor?: string) => void
  onDelete: (id: string) => void
  onEdit: (task: Task) => void
  onFocus: (task: Task) => void
  isFocused: boolean
  isDragging?: boolean
}

export default function WorkTaskCard({
  task, accentColor, onStatusChange, onDelete, onEdit, onFocus,
  isFocused, isDragging,
}: Props) {
  const isDone = task.status === 'done'
  const due    = dueLabel(task)
  const prio   = PRIORITY_META[task.priority]

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

  // dnd-kit (not native HTML5 draggable) — see WorkBoard.tsx for why. The
  // whole card is the drag source (matches the old behavior); a plain tap
  // still opens the edit modal since PointerSensor only arms a drag once
  // the pointer has actually moved past its activation distance.
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: task.id })
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onEdit(task)}
      className={[
        // touch-none (not touch-manipulation): dnd-kit's own docs flag this —
        // `manipulation` still lets the browser start its own pan/scroll on
        // touchstart, which can beat TouchSensor's activation delay and
        // silently prevent a drag from ever starting on a real device (a tap
        // to open the edit modal still works fine either way, since that
        // fires from the click event, not from touch-action).
        'group relative rounded-xl border bg-white p-2.5 cursor-pointer select-none transition-all touch-none',
        'hover:shadow-md hover:-translate-y-px',
        isFocused  ? 'border-accent-300 ring-1 ring-accent-200' : 'border-ink-200 hover:border-ink-300',
        isDone     ? 'opacity-60' : '',
        isDragging ? 'opacity-30 scale-95 shadow-lg z-10 relative' : '',
      ].join(' ')}
    >
      {/* Focus bolt — always visible when focused */}
      {isFocused && (
        <span className="absolute top-2 right-2 text-[11px] text-accent-500" title="Focused">⚡</span>
      )}

      {/* Title */}
      <p className={[
        'text-sm font-medium leading-snug pr-5',
        isDone ? 'line-through text-ink-400' : 'text-ink-900',
      ].join(' ')} style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {task.title}
      </p>

      {/* Meta chips */}
      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
        <span className={`text-[10px] leading-none ${prio.cls}`} title={`${prio.label} priority`}>{prio.icon}</span>
        {due && !isDone && (
          <span className={[
            'text-[10px] font-medium px-1.5 py-0.5 rounded-full leading-none',
            due.urgent ? 'bg-red-50 text-red-600' : 'bg-ink-100 text-ink-500',
          ].join(' ')}>
            {due.text}
          </span>
        )}
        {task.description && (
          <span className="text-[10px] text-ink-300" title="Has notes">≡</span>
        )}
        {task.status === 'waiting' && !editingWaiting && (
          <button
            onClick={e => { e.stopPropagation(); setEditingWaiting(true) }}
            title="Who/what are you waiting for?"
            className="inline-flex items-center gap-1 text-[10px] bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded-full leading-none hover:bg-sky-100 transition-colors"
          >
            ⏳ {task.waiting_for || <span className="italic opacity-60">add…</span>}
          </button>
        )}
        {editingWaiting && (
          <input
            ref={inputRef}
            value={waitingText}
            onChange={e => setWaitingText(e.target.value)}
            onBlur={commitWaiting}
            onKeyDown={e => {
              if (e.key === 'Enter') commitWaiting()
              if (e.key === 'Escape') { setWaitingText(task.waiting_for ?? ''); setEditingWaiting(false) }
            }}
            placeholder="Waiting for…"
            className="text-[10px] bg-sky-50 border border-sky-300 text-sky-800 rounded-full px-2 py-0.5 outline-none w-28"
            onClick={e => e.stopPropagation()}
          />
        )}
      </div>

      {/* Action row — always visible on mobile, hover-reveal on desktop */}
      <div
        className="flex items-center gap-0.5 mt-1.5 -mb-1 -ml-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={() => onStatusChange(task.id, isDone ? 'open' : 'done')}
          title={isDone ? 'Reopen' : 'Mark done'}
          className="min-h-[44px] min-w-[44px] md:min-h-[26px] md:min-w-[26px] flex items-center justify-center rounded-md text-[11px] text-emerald-600 hover:bg-emerald-50 transition-colors"
        >
          {isDone ? '↩' : '✓'}
        </button>
        <button
          onClick={() => onFocus(task)}
          title={isFocused ? 'Remove focus' : 'Focus this task'}
          className={[
            'min-h-[44px] min-w-[44px] md:min-h-[26px] md:min-w-[26px] flex items-center justify-center rounded-md text-[11px] transition-colors',
            isFocused ? 'text-accent-500 bg-accent-50 hover:bg-accent-100' : 'text-ink-400 hover:bg-ink-100 hover:text-ink-600',
          ].join(' ')}
        >
          ⚡
        </button>
        <button
          onClick={() => onEdit(task)}
          title="Edit"
          className="min-h-[44px] min-w-[44px] md:min-h-[26px] md:min-w-[26px] flex items-center justify-center rounded-md text-[11px] text-ink-400 hover:bg-ink-100 hover:text-ink-600 transition-colors"
        >
          ✎
        </button>
        {task.status !== 'cancelled' && (
          <button
            onClick={() => onStatusChange(task.id, 'cancelled')}
            title="Cancel (keeps a record, unlike Delete)"
            className="min-h-[44px] min-w-[44px] md:min-h-[26px] md:min-w-[26px] flex items-center justify-center rounded-md text-[11px] text-ink-300 hover:bg-orange-50 hover:text-orange-500 transition-colors"
          >
            ⊘
          </button>
        )}
        <button
          onClick={() => onDelete(task.id)}
          title="Delete"
          className="min-h-[44px] min-w-[44px] md:min-h-[26px] md:min-w-[26px] flex items-center justify-center rounded-md text-[11px] text-ink-300 hover:bg-red-50 hover:text-red-500 transition-colors"
        >
          ×
        </button>
      </div>

      {/* Slim colored footer accent (column color) */}
      {accentColor && (
        <span
          className="absolute left-2.5 right-2.5 bottom-0 h-0.5 rounded-full opacity-40"
          style={{ backgroundColor: accentColor }}
        />
      )}
    </div>
  )
}
