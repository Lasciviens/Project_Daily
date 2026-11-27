import { useMemo } from 'react'
import { toast } from '../../../app/store'
import { todayStr } from '../../../shared/utils/dateUtils'
import { needsDecision, reversePatch, somedayPatch, SOMEDAY_LABEL } from '../needsDecision'
import { useTaskActions } from './useTaskActions'
import { useUpdateTask } from './useTodos'
import type { Task, UpdateTaskInput } from '../types'

/** The tasks that need a decision, from the Tasks tab's own read (the list only adds rows). */
export function useNeedsDecision(tasks: readonly Task[]) {
  const today = todayStr()
  return useMemo(() => needsDecision(tasks, today), [tasks, today])
}

/** The one-tap answers: pick a day, put it under Someday, delete (asks, with Undo). Each says its result with Undo. */
export function useDecisionActions() {
  const update = useUpdateTask({ report: false })
  const back = useUpdateTask({ report: false })
  const actions = useTaskActions()

  async function apply(task: Task, patch: UpdateTaskInput, words: string) {
    try { await update.mutateAsync({ id: task.id, patch }) } catch { return }
    toast.undo(words, () => { back.mutate({ id: task.id, patch: reversePatch(task, patch) }) })
  }

  return {
    // Same job as Move to today: the item moves, task and slot together (useTaskActions.moveToDay → useMoveItemToDay).
    pickDay: (task: Task, day: string) => actions.moveToDay(task, day),
    someday: (task: Task) => apply(task, somedayPatch(task), `Parked under ${SOMEDAY_LABEL} · ${task.title}`),
    remove: (task: Task) => actions.remove(task),
    open: (task: Task) => actions.open(task),
    busy: update.isPending || back.isPending || actions.busy,
  }
}
