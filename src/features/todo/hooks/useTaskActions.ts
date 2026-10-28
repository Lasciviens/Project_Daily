import { useEntityModal } from '../../../shared/modals'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useTrainingPlanActions } from '../../training/hooks/useTrainingPlanActions'
import { useRepeatDay } from '../../items/useItems'
import type { TrainingPlanRef } from '../../training/api/trainingPlanApi'
import { isOpenTask, isTrainingTask } from '../taskRules'
import { useDeleteTask, useToggleTask, useUpdateTask } from './useTodos'
import type { Task, TaskStatus } from '../types'

/** The training plan a task row stands for (the session popup's own target). */
export function planRefForTask(task: Task): TrainingPlanRef {
  return {
    target: { kind: 'task', taskId: task.id, blockId: null },
    info: {
      title: task.title, date: task.due_date ?? todayStr(), startHHMM: task.due_time?.slice(0, 5) ?? null,
      minutes: null, routineId: task.hevy_routine_id ?? null,
    },
  }
}

/** A repeat's day that is a task (156): ticked, skipped and undone as that
 *  day of its repeat (useRepeatDay — a skipped day comes off the series on
 *  Google, the result says so with Undo), never by a plain status write. */
function repeatDayOf(task: Task): { scheduleBlockId: string; date: string } | null {
  return task.schedule_block_id && task.occurrence_date ? { scheduleBlockId: task.schedule_block_id, date: task.occurrence_date } : null
}

/** Done by its Hevy workout: the workout would close it again, so it can't be reopened. */
export function doneByWorkout(task: Task): boolean {
  return isTrainingTask(task) && task.status === 'done' && !!task.hevy_workout_id
}

/**
 * THE actions on a task (owner, 12.10.2026: one action, one hook, the same on
 * every page). Daily, Home and Work rows used to do these their own way: Work
 * marked done with two writes and a toast, Daily with one silent write; Work
 * asked before a delete, Daily didn't; only Work's Done button took a task out
 * of the focus. Now every surface calls these.
 *
 * A training session is the session's own action (the same hook as its popup):
 * cancel = Skip (asks why), reopen a skip = Undo skip, delete asks and offers
 * Undo. Every action reports its result ("Task done", "Task deleted · Undo");
 * errors are toasted by the mutations; these never throw.
 */
export function useTaskActions() {
  const modal = useEntityModal()
  const toggle = useToggleTask()
  const update = useUpdateTask()
  const remove = useDeleteTask()
  const session = useTrainingPlanActions()
  const repeatDay = useRepeatDay()

  const quietly = (p: Promise<unknown>) => p.then(() => undefined, () => undefined)

  function setDone(task: Task, done: boolean): Promise<void> {
    if (done === (task.status === 'done')) return Promise.resolve()
    if (isTrainingTask(task)) {
      if (!done && doneByWorkout(task)) return Promise.resolve()
      const plan = planRefForTask(task)
      return quietly(done ? session.markDone(plan) : session.reopen(plan))
    }
    const day = repeatDayOf(task)
    if (day) return quietly(repeatDay.mutateAsync({ ...day, action: done ? 'done' : 'undo', title: task.title }))
    return quietly(toggle.mutateAsync({ id: task.id, isDone: done }))
  }

  /** Cancel keeps a record (unlike Delete) — a done task too; a training
   *  session is skipped with a reason (only while still to do). */
  function cancel(task: Task): Promise<void> {
    if (task.status === 'cancelled') return Promise.resolve()
    if (isTrainingTask(task)) {
      if (isOpenTask(task)) session.openSkip(planRefForTask(task))
      return Promise.resolve()
    }
    const day = repeatDayOf(task)
    if (day) return quietly(repeatDay.mutateAsync({ ...day, action: 'skip', title: task.title }))
    return quietly(update.mutateAsync({ id: task.id, patch: { status: 'cancelled' } }))
  }

  /** Back to open: a done one is unticked, a cancelled one restored (Undo skip for a session). */
  function reopen(task: Task): Promise<void> {
    if (task.status === 'done') return setDone(task, false)
    if (task.status !== 'cancelled') return Promise.resolve()
    if (isTrainingTask(task)) return quietly(session.undoSkip({ taskId: task.id }))
    const day = repeatDayOf(task)
    if (day) return quietly(repeatDay.mutateAsync({ ...day, action: 'undo', title: task.title }))
    return quietly(update.mutateAsync({ id: task.id, patch: { status: 'open' } }))
  }

  /** Any status (Work's columns, list and drag): done/cancelled/reopen go through the actions above. */
  function setStatus(task: Task, status: TaskStatus, opts?: { waitingFor?: string }): Promise<void> {
    if (status === 'done') return setDone(task, true)
    if (status === 'cancelled') return cancel(task)
    if (doneByWorkout(task)) return Promise.resolve()
    // A training session reopens through its own actions first; any other
    // closed task moves in one write (one message, not "reopened" + "started").
    if (!isOpenTask(task) && (status === 'open' || isTrainingTask(task))) {
      return reopen(task).then(() => status === 'open' ? undefined : setStatus({ ...task, status: 'open' }, status, opts))
    }
    if (status === task.status && opts?.waitingFor === undefined) return Promise.resolve()
    return quietly(update.mutateAsync({ id: task.id, patch: {
      status,
      ...(opts?.waitingFor !== undefined ? { waiting_for: opts.waitingFor || null } : {}),
    } }))
  }

  /** Work's focus: focusing an open task starts it. A closed task leaves the focus by itself (migration 143). */
  function toggleFocus(task: Task): Promise<void> {
    if (!task.is_focused && !isOpenTask(task)) return Promise.resolve()
    return quietly(update.mutateAsync({ id: task.id, patch: {
      is_focused: !task.is_focused,
      ...(!task.is_focused && task.status === 'open' ? { status: 'in_progress' as TaskStatus } : {}),
    } }))
  }

  /** Asks first, says what happened, offers Undo (the owner's rule for every delete). */
  async function removeTask(task: Task): Promise<void> {
    if (isTrainingTask(task)) return quietly(session.deleteSession(planRefForTask(task)))
    await remove.run([task.id], { title: 'Delete this task?', message: task.title, done: 'Task deleted' })
  }

  const edit = (task: Task) => modal.open({ kind: 'task', id: task.id, config: { heading: 'Edit task' } })
  /** A row tap: a training session opens as the session, anything else its editor. */
  const open = (task: Task) => (isTrainingTask(task) ? modal.open({ kind: 'training-session', taskId: task.id }) : edit(task))

  return {
    setDone, cancel, reopen, setStatus, toggleFocus, remove: removeTask, edit, open,
    /** A training session's own: Move (asks the day and time), Skip (asks why). */
    move: (task: Task) => session.openMove(planRefForTask(task)),
    skip: (task: Task) => session.openSkip(planRefForTask(task)),
    busy: toggle.isPending || update.isPending || remove.busy || session.busy || repeatDay.isPending,
  }
}
