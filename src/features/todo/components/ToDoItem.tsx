import { useState } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronRight, CornerDownRight } from 'lucide-react'
import type { Task } from '../types'
import { useToggleTask, useDeleteTask, useUpdateTask, useTaskById, useSubtasks } from '../hooks/useTodos'
import { useEntityModal } from '../../../shared/modals'
import { withProgress } from '../../../shared/hooks/useMutationWithFeedback'
import { ToneDot, TonePill, cx } from '../../../shared/ui'
import { DOMAIN_LABEL } from '../domainColors'
import { DOMAIN_TONE, PRIORITY_LABEL, PRIORITY_TONE, dueTone } from '../taskTones'
import { isOverdue, dueLabel } from '../taskRules'
import { todayStr, tomorrowStr } from '../../../shared/utils/dateUtils'
import { windowRangeLabel } from '../../../shared/components/windowChips'
import { useSwipeToReveal } from '../../../shared/hooks/useSwipeToReveal'
import { SetParentTaskSheet } from './SetParentTaskSheet'
import { MoveToListSheet } from './MoveToListSheet'
import { ToDoItemHoverActions, ToDoItemMenu } from './ToDoItemActions'

interface Props {
  task:         Task
  canMoveUp?:   boolean
  canMoveDown?: boolean
  onMoveUp?:    () => void
  onMoveDown?:  () => void
}

export function ToDoItem({ task, canMoveUp, canMoveDown, onMoveUp, onMoveDown }: Props) {
  const modal = useEntityModal()
  const [hovered, setHovered] = useState(false)
  const [pickingParent, setPickingParent] = useState(false)
  const [pickingList, setPickingList] = useState(false)
  const [subtasksOpen, setSubtasksOpen] = useState(false)
  const toggle = useToggleTask()
  const remove = useDeleteTask()
  const update = useUpdateTask()
  const isDone      = task.status === 'done'
  const isCancelled = task.status === 'cancelled'
  // Mobile-only affordance (lg:hidden on the reveal panel below) — desktop
  // already has hover-revealed action buttons including delete.
  const swipe = useSwipeToReveal()

  const { data: parentTask } = useTaskById(task.parent_task_id)
  // Always fetched (cheap, indexed by parent_task_id) rather than gated on
  // subtasksOpen — the count badge needs a number before the row is ever
  // expanded, and react-query dedupes this against the expanded view's key.
  const { data: subtasks = [] } = useSubtasks(task.id)

  // The hooks own error toasts + logging; only Delete gets per-call copy.
  const openEditor   = () => modal.open({ kind: 'task', id: task.id, config: { heading: 'Edit task' } })
  const handleDelete = () => withProgress(() => remove.mutateAsync(task.id), { loading: 'Deleting…', success: 'Deleted' })
  const handleToggle = () => toggle.mutate({ id: task.id, isDone: !isDone })
  const handleCancel = () => update.mutate({ id: task.id, patch: { status: 'cancelled' } })
  const handleReopen = () => update.mutate({ id: task.id, patch: { status: 'open' } })

  const actions = {
    onEdit: openEditor,
    onSetParent: () => setPickingParent(true),
    onMoveToList: () => setPickingList(true),
    onCancel: handleCancel,
    onReopen: handleReopen,
    onDelete: () => { void handleDelete() },
    onMoveUp, onMoveDown, canMoveUp, canMoveDown,
    busy: update.isPending || remove.isPending,
  }

  const today = todayStr()
  const tomorrow = tomorrowStr()
  const due = task.due_date
    ? {
        tone: dueTone(task.due_date, isDone, today, tomorrow),
        // A windowed task (start_date + due_date) shows ONE range chip INSTEAD
        // of the due chip — never both (a second chip starves the title on a
        // 393px screen). Colour and the overdue mark still come from due_date.
        text: task.start_date ? windowRangeLabel(task.start_date, task.due_date) : dueLabel(task)?.text,
      }
    : null

  return (
    <>
      <div className="relative overflow-hidden rounded-row">
        {/* Delete panel revealed behind the row on swipe-left (mobile only).
            Hidden (not unmounted) at rest: the row's overflow-hidden clip and
            this button's own corner radius are coincident, so a resting row
            leaked an antialiased arc at its top-right corner. Hiding it also
            stops screen readers announcing a Delete button per row. */}
        <button
          type="button"
          onClick={() => { void handleDelete(); swipe.close() }}
          disabled={remove.isPending}
          aria-hidden={!swipe.isOpen}
          tabIndex={swipe.isOpen ? undefined : -1}
          className={cx(
            'absolute inset-y-0 right-0 flex w-[76px] items-center justify-center rounded-r-row bg-danger text-ui font-semibold text-white press-feedback transition-opacity duration-150 lg:hidden',
            swipe.isOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
        >
          Delete
        </button>

        {/* Entire row opens the editor; inline controls stopPropagation. */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => { if (!swipe.isOpen) openEditor() }}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditor() } }}
          className={cx(
            'group relative flex min-h-[44px] cursor-pointer items-start gap-2.5 rounded-row bg-surface px-3 py-2 transition-colors duration-150 press-feedback',
            hovered && 'bg-surface-hover',
          )}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          {...swipe.rowProps}
        >
          {/* Circle checkbox — matches Google Tasks iPhone style */}
          <button
            type="button"
            onClick={e => { e.stopPropagation(); handleToggle() }}
            disabled={toggle.isPending}
            aria-label={isDone ? 'Mark as open' : 'Mark as done'}
            aria-pressed={isDone}
            className="-ml-3 flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center lg:ml-0 lg:mt-0.5 lg:h-auto lg:min-h-0 lg:w-auto lg:min-w-0"
          >
            <span className={cx(
              'flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors duration-150',
              isDone ? 'border-accent-500 bg-accent-500 text-on-accent' : 'border-line-strong hover:border-accent-500',
            )}>
              {isDone && <Check className="h-3 w-3" strokeWidth={3} aria-hidden />}
            </span>
          </button>

          <div className="min-w-0 flex-1 py-0.5">
            {/* items-start keeps the priority dot beside a wrapped title's FIRST line. */}
            <div className="flex items-start gap-2">
              <span className="mt-[6px] flex" title={`${PRIORITY_LABEL[task.priority]} priority`}>
                <ToneDot tone={PRIORITY_TONE[task.priority]} />
              </span>
              <span className={cx('text-body leading-snug', isDone || isCancelled ? 'text-fg-faint line-through' : 'text-fg')}>
                {task.title}
              </span>
            </div>
            <div className="ml-4 mt-1 flex flex-wrap items-center gap-1.5">
              {isCancelled && <TonePill tone="neutral">Cancelled</TonePill>}
              <TonePill tone={DOMAIN_TONE[task.domain]}>{DOMAIN_LABEL[task.domain]}</TonePill>
              {due?.text && (
                <TonePill tone={due.tone} className="tabular-nums">
                  {isOverdue(task) && <AlertTriangle className="h-3 w-3" aria-label="Overdue" />}
                  {due.text}
                </TonePill>
              )}
            </div>
            {/* Description gets its OWN line — sharing the chip row squeezed it
                to a 1px-wide slot that rendered nothing on a phone. */}
            {task.description && (
              <p className="ml-4 mt-0.5 line-clamp-1 w-full text-meta text-fg-muted">{task.description}</p>
            )}
            {parentTask && (
              <p className="ml-4 mt-0.5 flex items-center gap-1 truncate text-meta text-fg-faint">
                <CornerDownRight className="h-3 w-3 shrink-0" aria-hidden />
                Subtask of <span className="truncate text-fg-muted">{parentTask.title}</span>
              </p>
            )}
            {subtasks.length > 0 && (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); setSubtasksOpen(o => !o) }}
                aria-expanded={subtasksOpen}
                className="ml-4 mt-1 inline-flex items-center gap-0.5 text-meta font-semibold text-accent-600"
              >
                {subtasksOpen ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
                {subtasks.length} subtask{subtasks.length === 1 ? '' : 's'}
              </button>
            )}
          </div>

          <ToDoItemMenu task={task} {...actions} />
          {hovered && <ToDoItemHoverActions task={task} {...actions} />}
        </div>
      </div>

      {/* Google's own subtask depth cap (a subtask can't itself be a parent)
          means this never recurses more than one level. */}
      {subtasksOpen && subtasks.length > 0 && (
        <div className="ml-6 mt-1 flex flex-col gap-1 border-l border-line pl-2">
          {subtasks.map(st => <ToDoItem key={st.id} task={st} />)}
        </div>
      )}

      <SetParentTaskSheet
        open={pickingParent}
        onClose={() => setPickingParent(false)}
        task={task}
        hasSubtasks={subtasks.length > 0}
      />

      <MoveToListSheet
        open={pickingList}
        onClose={() => setPickingList(false)}
        task={task}
      />
    </>
  )
}
