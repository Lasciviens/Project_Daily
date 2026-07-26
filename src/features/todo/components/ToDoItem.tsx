import { useState } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { isToday, isTomorrow, isPast } from 'date-fns'
import type { Task } from '../types'
import { useToggleTask, useDeleteTask, useUpdateTask } from '../hooks/useTodos'
import { UnifiedPlanModal } from '../../../shared/components/plan-modal'
import { DOMAIN_LABEL, DOMAIN_TAG_CLASS } from '../domainColors'
import { PRIORITY_DOT_CLASS as PRIORITY_DOT } from '../../../shared/utils/priorityColors'
import { isOverdue, dueLabel } from '../taskRules'
import { useSwipeToReveal } from '../../../shared/hooks/useSwipeToReveal'

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
  const update = useUpdateTask()
  const isDone      = task.status === 'done'
  const isCancelled = task.status === 'cancelled'
  // Mobile-only affordance (lg:hidden on the reveal panel below) — desktop
  // already has hover-revealed action buttons including delete, so the
  // swipe gesture would just be redundant clutter there.
  const swipe = useSwipeToReveal()

  return (
    <>
      <div className="relative overflow-hidden rounded-lg">
        {/* Delete panel revealed behind the row on swipe-left (mobile only).
            Hidden (not unmounted) at rest: the row's overflow-hidden clip and
            this button's own corner radius are coincident, so a resting row
            leaked a pink antialiased arc at its top-right corner. Hiding it
            also stops screen readers announcing a Delete button per row. */}
        <button
          onClick={() => { remove.mutate(task.id); swipe.close() }}
          disabled={remove.isPending}
          aria-hidden={!swipe.isOpen}
          tabIndex={swipe.isOpen ? undefined : -1}
          className={`lg:hidden absolute inset-y-0 right-0 w-[76px] flex items-center justify-center bg-red-500 text-white text-sm font-semibold press-feedback rounded-r-lg transition-opacity duration-150 ${
            swipe.isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          Delete
        </button>

        {/* Entire row is a click target that opens the edit modal.
            Inline controls (checkbox / action buttons) stopPropagation so they act independently. */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => { if (!swipe.isOpen) setEditing(true) }}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditing(true) } }}
          className={`relative bg-cream-50 group flex items-start gap-2.5 px-3 py-2 min-h-[44px] rounded-lg cursor-pointer transition-colors duration-150 press-feedback ${
            hovered ? 'bg-cream-100' : ''
          }`}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          {...swipe.rowProps}
        >
        {/* Circle checkbox — matches Google Tasks iPhone style */}
        <button
          onClick={e => { e.stopPropagation(); toggle.mutate({ id: task.id, isDone: !isDone }) }}
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
          {/* Title row with priority dot — items-start (not items-center) so a
              wrapped title keeps the dot beside its FIRST line instead of
              floating down to the middle of the block. */}
          <div className="flex items-start gap-1.5">
            <span className={`w-2 h-2 mt-[5px] rounded-full flex-shrink-0 ${PRIORITY_DOT[task.priority]}`} />
            <span className={`text-sm leading-snug ${(isDone || isCancelled) ? 'line-through text-ink-400' : 'text-ink-800'}`}>
              {task.title}
            </span>
          </div>
          {/* Domain tag + due date chip */}
          <div className="flex flex-wrap items-center gap-1.5 mt-1 ml-3">
            {isCancelled && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-ink-100 text-ink-400">
                Cancelled
              </span>
            )}
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${DOMAIN_TAG_CLASS[task.domain]}`}>
              {DOMAIN_LABEL[task.domain]}
            </span>
            {task.due_date && (
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${dueDateCls(task.due_date, isDone)}`}>
                {isOverdue(task) && <span title="Overdue">⚠ </span>}
                {dueLabel(task)?.text}
              </span>
            )}
          </div>
          {/* Description gets its OWN line — sharing the chip row squeezed it
              to a 1px-wide slot that rendered nothing on a phone. */}
          {task.description && (
            <p className="text-[11px] text-ink-500 line-clamp-1 w-full mt-0.5 ml-3">{task.description}</p>
          )}
        </div>

        {/* Mobile: ONE 44px ⋯ menu instead of up to five side-by-side icon
            buttons — those held ~136px of a 393px row and starved the title
            down to ~101px (a normal title wrapped to six lines). Same pattern
            ItemRow.tsx already uses; every action stays reachable, and the
            row tap itself is still the fast path to edit. Hover actions below
            keep the icon strip on desktop. */}
        <Menu as="div" className="flex-shrink-0 lg:hidden" onClick={e => e.stopPropagation()}>
          <MenuButton
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 active:text-ink-700 text-lg leading-none rounded press-feedback"
            title="More actions"
            aria-label="More actions"
          >
            ⋯
          </MenuButton>
          <MenuItems
            anchor="bottom end"
            transition
            className="z-[60] w-44 bg-cream-50 border border-ink-200 rounded-xl shadow-card-hover overflow-hidden [--anchor-gap:4px] transition duration-150 data-[closed]:opacity-0 data-[closed]:scale-95"
          >
            <MenuItem>
              <button
                onClick={() => setEditing(true)}
                className="w-full text-left px-3 min-h-[44px] text-sm text-ink-700 data-[focus]:bg-ink-100"
              >✎ Edit</button>
            </MenuItem>
            {onMoveUp && (
              <MenuItem>
                <button
                  onClick={onMoveUp}
                  disabled={!canMoveUp}
                  className="w-full text-left px-3 min-h-[44px] text-sm text-ink-700 disabled:opacity-30 data-[focus]:bg-ink-100"
                >↑ Move up</button>
              </MenuItem>
            )}
            {onMoveDown && (
              <MenuItem>
                <button
                  onClick={onMoveDown}
                  disabled={!canMoveDown}
                  className="w-full text-left px-3 min-h-[44px] text-sm text-ink-700 disabled:opacity-30 data-[focus]:bg-ink-100"
                >↓ Move down</button>
              </MenuItem>
            )}
            {!isCancelled && (
              <MenuItem>
                <button
                  onClick={() => update.mutate({ id: task.id, patch: { status: 'cancelled' } })}
                  disabled={update.isPending}
                  className="w-full text-left px-3 min-h-[44px] text-sm text-orange-600 data-[focus]:bg-ink-100"
                  title="Cancel keeps a record, unlike Delete"
                >⊘ Cancel</button>
              </MenuItem>
            )}
            <MenuItem>
              <button
                onClick={() => remove.mutate(task.id)}
                disabled={remove.isPending}
                className="w-full text-left px-3 min-h-[44px] text-sm text-red-600 data-[focus]:bg-ink-100"
              >✕ Delete</button>
            </MenuItem>
          </MenuItems>
        </Menu>
        {hovered && (
          <div className="hidden lg:flex items-center gap-0.5 flex-shrink-0 mt-0.5">
            {onMoveUp && (
              <button
                onClick={e => { e.stopPropagation(); onMoveUp() }}
                disabled={!canMoveUp}
                className="w-5 h-5 flex items-center justify-center text-ink-300 hover:text-ink-600 disabled:opacity-20 transition-colors duration-150 text-xs"
                title="Move up"
              >↑</button>
            )}
            {onMoveDown && (
              <button
                onClick={e => { e.stopPropagation(); onMoveDown() }}
                disabled={!canMoveDown}
                className="w-5 h-5 flex items-center justify-center text-ink-300 hover:text-ink-600 disabled:opacity-20 transition-colors duration-150 text-xs"
                title="Move down"
              >↓</button>
            )}
            <button
              onClick={e => { e.stopPropagation(); setEditing(true) }}
              className="w-5 h-5 flex items-center justify-center text-ink-300 hover:text-accent-500 transition-colors duration-150 text-[11px]"
              title="Edit"
            >✎</button>
            {!isCancelled && (
              <button
                onClick={e => { e.stopPropagation(); update.mutate({ id: task.id, patch: { status: 'cancelled' } }) }}
                disabled={update.isPending}
                className="w-5 h-5 flex items-center justify-center text-ink-300 hover:text-orange-500 transition-colors duration-150 text-xs"
                title="Cancel (keeps a record, unlike Delete)"
              >⊘</button>
            )}
            <button
              onClick={e => { e.stopPropagation(); remove.mutate(task.id) }}
              disabled={remove.isPending}
              className="w-5 h-5 flex items-center justify-center text-ink-300 hover:text-red-400 transition-colors duration-150 text-xs"
              title="Delete"
            >✕</button>
          </div>
        )}
        </div>
      </div>

      <UnifiedPlanModal
        open={editing}
        onClose={() => setEditing(false)}
        config={{ tabs: ['task', 'schedule'], heading: 'Edit Task' }}
        task={task}
      />
    </>
  )
}
