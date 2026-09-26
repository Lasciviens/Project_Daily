import { useState, useRef, useEffect } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Menu, MenuButton, MenuItems, MenuItem } from '@headlessui/react'
import { AlignLeft, Ban, Check, Hourglass, MoreHorizontal, Pencil, RotateCcw, Trash2, Zap } from 'lucide-react'
import type { Task, TaskStatus } from '../../todo/types'
import type { Tone } from '../../../shared/ui'
import { cx } from '../../../shared/ui'
import { haptic } from '../../../shared/utils/haptics'
import { DueChip, PriorityMark } from './WorkTaskBits'

interface Props {
  task: Task
  accentTone?: Tone
  onStatusChange: (id: string, status: TaskStatus, waitingFor?: string) => void
  onDelete: (id: string) => void
  onEdit: (task: Task) => void
  onFocus: (task: Task) => void
  isFocused: boolean
  isDragging?: boolean
}

// 44px on touch, 28px with a mouse: the card's own action row.
const ACTION = 'grid place-items-center rounded-control min-h-[44px] min-w-[44px] md:min-h-[28px] md:min-w-[28px] transition-colors [&_svg]:h-3.5 [&_svg]:w-3.5'

export default function WorkTaskCard({
  task, accentTone, onStatusChange, onDelete, onEdit, onFocus,
  isFocused, isDragging,
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

  // dnd-kit (not native HTML5 draggable) — see WorkBoard.tsx for why. The
  // whole card is the drag source; a plain tap still opens the editor since
  // PointerSensor only arms a drag once the pointer moves past its distance.
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: task.id })
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onEdit(task)}
      className={cx(
        // touch-pan-y (not touch-none): the TouchSensor arms drag on a 200ms
        // press-hold, so vertical panning stays intact under a finger.
        'group relative cursor-pointer select-none touch-pan-y rounded-row border bg-surface p-3 transition-[box-shadow,border-color,opacity]',
        '[@media(hover:hover)]:hover:shadow-card-hover',
        isFocused ? 'border-accent-500/40 ring-1 ring-accent-500/25' : 'border-line [@media(hover:hover)]:hover:border-line-strong',
        isDone && 'opacity-60',
        isDragging && 'relative z-10 scale-95 opacity-30 shadow-menu',
      )}
    >
      {accentTone && (
        <span data-tone={accentTone} aria-hidden className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-[rgb(var(--tone))]" />
      )}

      {isFocused && (
        <Zap aria-label="Focused" className="absolute right-2.5 top-3 h-3.5 w-3.5 fill-current text-accent-600" />
      )}

      <p className={cx('line-clamp-2 pr-5 text-body font-medium', isDone ? 'text-fg-faint line-through' : 'text-fg')}>
        {task.title}
      </p>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <PriorityMark task={task} />
        <DueChip task={task} />
        {task.description && <AlignLeft aria-label="Has notes" className="h-3 w-3 text-fg-faint" />}
        {task.status === 'waiting' && !editingWaiting && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); setEditingWaiting(true) }}
            title="Who or what are you waiting for?"
            data-tone="warn"
            className="tone-pill max-w-[10rem] [@media(hover:hover)]:hover:brightness-95"
          >
            <Hourglass aria-hidden className="h-3 w-3 shrink-0" />
            <span className="truncate">{task.waiting_for || <span className="italic opacity-70">add…</span>}</span>
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
            aria-label="Waiting for"
            className="input w-40 rounded-full text-meta"
            onClick={e => e.stopPropagation()}
          />
        )}
      </div>

      {/* Primary actions inline, the rest in an overflow menu.
          Always visible on touch, hover-reveal with a mouse. */}
      <div
        className="-mb-1 -ml-1 mt-1.5 flex items-center gap-0.5 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
        onClick={e => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => { haptic('light'); onStatusChange(task.id, isDone ? 'open' : 'done') }}
          aria-label={isDone ? 'Reopen' : 'Mark done'}
          title={isDone ? 'Reopen' : 'Mark done'}
          data-tone="success"
          className={cx(ACTION, 'tone-text [@media(hover:hover)]:hover:bg-success-soft')}
        >
          {isDone ? <RotateCcw /> : <Check />}
        </button>
        <button
          type="button"
          onClick={() => { haptic('light'); onFocus(task) }}
          aria-label={isFocused ? 'Remove focus' : 'Focus this task'}
          aria-pressed={isFocused}
          title={isFocused ? 'Remove focus' : 'Focus this task'}
          className={cx(ACTION, isFocused ? 'bg-accent-50 text-accent-600' : 'text-fg-faint [@media(hover:hover)]:hover:bg-surface-hover [@media(hover:hover)]:hover:text-fg-2')}
        >
          <Zap />
        </button>

        {/* onPointerDown stopPropagation so a press-hold opens the menu
            instead of arming the card's drag sensor. */}
        <Menu>
          <MenuButton
            aria-label="More actions"
            onPointerDown={e => e.stopPropagation()}
            className={cx(ACTION, 'text-fg-faint [@media(hover:hover)]:hover:bg-surface-hover [@media(hover:hover)]:hover:text-fg-2 data-[open]:bg-surface-hover data-[open]:text-fg')}
          >
            <MoreHorizontal />
          </MenuButton>
          <MenuItems
            anchor="bottom end"
            transition
            className="menu min-w-[10rem] [--anchor-gap:4px] transition duration-150 data-[closed]:scale-95 data-[closed]:opacity-0"
          >
            <MenuItem>
              <button type="button" onClick={() => onEdit(task)} className="menu-item">
                <Pencil aria-hidden className="h-4 w-4" /> Edit
              </button>
            </MenuItem>
            {task.status !== 'cancelled' && (
              <MenuItem>
                <button
                  type="button"
                  onClick={() => onStatusChange(task.id, 'cancelled')}
                  title="Cancel (keeps a record, unlike Delete)"
                  className="menu-item"
                >
                  <Ban aria-hidden className="h-4 w-4" /> Cancel task
                </button>
              </MenuItem>
            )}
            <div className="menu-sep" />
            <MenuItem>
              <button type="button" onClick={() => onDelete(task.id)} className="menu-item is-danger">
                <Trash2 aria-hidden className="h-4 w-4" /> Delete
              </button>
            </MenuItem>
          </MenuItems>
        </Menu>
      </div>
    </div>
  )
}
