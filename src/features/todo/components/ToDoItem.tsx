import { useState } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronRight, CornerDownRight, Dumbbell } from 'lucide-react'
import type { Task } from '../types'
import { useTaskById, useSubtasks } from '../hooks/useTodos'
import { doneByWorkout, useTaskActions } from '../hooks/useTaskActions'
import { ToneDot, TonePill, Truncate, cx } from '../../../shared/ui'
import { DOMAIN_LABEL } from '../domainColors'
import { DOMAIN_TONE, PRIORITY_LABEL, PRIORITY_TONE, STATUS_LABEL, STATUS_TONE, dueTone } from '../taskTones'
import { isOverdue, isTrainingTask, dueLabel } from '../taskRules'
import { todayStr, tomorrowStr } from '../../../shared/utils/dateUtils'
import { windowRangeLabel } from '../../../shared/components/windowChips'
import { useSwipeToReveal } from '../../../shared/hooks/useSwipeToReveal'
import { SetParentTaskSheet } from './SetParentTaskSheet'
import { MoveToListSheet } from './MoveToListSheet'
import { ToDoItemHoverActions, ToDoItemMenu } from './ToDoItemActions'

// A tick often moves the row to another list (Done), which mounts a NEW
// ToDoItem there — remember the tick for a moment so that one still pops.
const JUST_DONE = new Set<string>()
function markJustDone(id: string) {
  JUST_DONE.add(id)
  window.setTimeout(() => JUST_DONE.delete(id), 1500)
}

interface Props {
  task:         Task
  canMoveUp?:   boolean
  canMoveDown?: boolean
  onMoveUp?:    () => void
  onMoveDown?:  () => void
  /** Just added to its list (useNewIds): the row rises in with the motion set. */
  isNew?:       boolean
}

export function ToDoItem({ task, canMoveUp, canMoveDown, onMoveUp, onMoveDown, isNew }: Props) {
  const [hovered, setHovered] = useState(false)
  const [pickingParent, setPickingParent] = useState(false)
  const [pickingList, setPickingList] = useState(false)
  const [subtasksOpen, setSubtasksOpen] = useState(false)
  // Set by the user's own tick (never on load), so only a completion they just
  // made pops — the CSS only runs with the motion set.
  const [justDone, setJustDone] = useState(() => JUST_DONE.has(task.id))
  // THE task actions (useTaskActions) — the same as Work's cards and the
  // session popup: a planned training session's tick, Move, Skip and Delete
  // are the session's own (Skip asks why, Delete asks and offers Undo).
  const act = useTaskActions()
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

  const training         = isTrainingTask(task)
  const trainedByWorkout = doneByWorkout(task)
  const handleToggle = () => {
    if (!isDone) markJustDone(task.id)
    setJustDone(!isDone)
    void act.setDone(task, !isDone)
  }

  const actions = {
    onEdit: () => act.edit(task),
    onSetParent: () => setPickingParent(true),
    onMoveToList: () => setPickingList(true),
    onCancel: () => { void act.cancel(task) },
    onReopen: () => { void act.reopen(task) },
    onDelete: () => { void act.remove(task) },
    onMoveUp, onMoveDown, canMoveUp, canMoveDown,
    busy: act.busy,
    training: training ? {
      onMove: () => act.move(task),
      onSkip: () => act.skip(task),
      onUndoSkip: () => { void act.reopen(task) },
    } : undefined,
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
      <div className={cx('relative overflow-hidden rounded-row', isNew && 'motion-row-in')}>
        {/* Delete panel revealed behind the row on swipe-left (mobile only).
            Hidden (not unmounted) at rest: the row's overflow-hidden clip and
            this button's own corner radius are coincident, so a resting row
            leaked an antialiased arc at its top-right corner. Hiding it also
            stops screen readers announcing a Delete button per row. */}
        <button
          type="button"
          onClick={() => { void act.remove(task); swipe.close() }}
          disabled={act.busy}
          aria-hidden={!swipe.isOpen}
          tabIndex={swipe.isOpen ? undefined : -1}
          className={cx(
            'absolute inset-y-0 right-0 flex w-[76px] items-center justify-center rounded-r-row bg-danger text-ui font-semibold text-white press-feedback transition-opacity duration-150 lg:hidden',
            swipe.isOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
        >
          Delete
        </button>

        {/* Entire row opens the editor (a training session: the session); inline controls stopPropagation. */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => { if (!swipe.isOpen) act.open(task) }}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act.open(task) } }}
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
            // A session a Hevy workout completed stays done (the session popup
            // offers no Reopen either: the workout would close it again).
            disabled={act.busy || trainedByWorkout}
            title={trainedByWorkout ? 'Done by a Hevy workout' : undefined}
            aria-label={trainedByWorkout ? 'Done by a Hevy workout' : isDone ? 'Mark as open' : 'Mark as done'}
            aria-pressed={isDone}
            className="-ml-3 flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center lg:ml-0 lg:mt-0.5 lg:h-auto lg:min-h-0 lg:w-auto lg:min-w-0"
          >
            <span
              onAnimationEnd={e => { if (e.target === e.currentTarget) { setJustDone(false); JUST_DONE.delete(task.id) } }}
              className={cx(
                'flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors duration-150',
                isDone ? 'border-accent-500 bg-accent-500 text-on-accent' : 'border-line-strong hover:border-accent-500',
                isDone && justDone && 'motion-check-pop',
              )}
            >
              {isDone && <Check className="h-3 w-3" strokeWidth={3} aria-hidden />}
            </span>
          </button>

          <div className="min-w-0 flex-1 py-0.5">
            {/* items-start keeps the priority dot beside a wrapped title's FIRST line. */}
            <div className="flex items-start gap-2">
              <span className="mt-[6px] flex" title={`${PRIORITY_LABEL[task.priority]} priority`}>
                <ToneDot tone={PRIORITY_TONE[task.priority]} />
              </span>
              <span className={cx('text-body leading-snug', isDone || isCancelled ? 'text-fg-faint line-through' : 'text-fg', isDone && justDone && 'motion-strike-in')}>
                {task.title}
              </span>
            </div>
            <div className="ml-4 mt-1 flex flex-wrap items-center gap-1.5">
              {isCancelled && <TonePill tone="neutral">{training ? 'Skipped' : 'Cancelled'}</TonePill>}
              {/* Waiting and In progress (set on Work) show here too: a waiting
                  task counts as open everywhere (taskRules). */}
              {(task.status === 'waiting' || task.status === 'in_progress') && (
                <TonePill tone={STATUS_TONE[task.status]}>{STATUS_LABEL[task.status]}</TonePill>
              )}
              {training
                ? <TonePill tone={DOMAIN_TONE[task.domain]}><Dumbbell className="h-3 w-3" aria-hidden />Training</TonePill>
                : <TonePill tone={DOMAIN_TONE[task.domain]}>{DOMAIN_LABEL[task.domain]}</TonePill>}
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
              <Truncate as="p" className="ml-4 mt-0.5 text-meta text-fg-muted">{task.description}</Truncate>
            )}
            {parentTask && (
              <p className="ml-4 mt-0.5 flex min-w-0 items-center gap-1 text-meta text-fg-faint">
                <CornerDownRight className="h-3 w-3 shrink-0" aria-hidden />
                <span className="shrink-0">Subtask of</span> <Truncate className="text-fg-muted">{parentTask.title}</Truncate>
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
