// The Add sheet's delete — every one asks first (or the sheet's own question
// did), says what happened and offers Undo (docs/features/delete-undo.md).
//
// Stands in for the items contract's useDeleteItem ({ scope: 'item' | 'day' |
// 'all' }) until the data layer builds it: swap the body, keep the call.
//   item — the task (its slot goes with it, 077) or a slot of its own
//   all  — a repeating item: the rule, "Every day it repeats"
//   day  — one day of it, "Only 15.10.2026": that day is taken out of the
//          repeat (useRepeatDay 'skip'), Undo puts it back ('undo')
import { confirmDelete } from '../../shared/modals/deleteFlow'
import { useDeleteTask } from '../todo/hooks/useTodos'
import { useDeleteScheduleBlock, useDeleteTimeBlock } from '../daily/hooks/useSchedule'
import { useRepeatDay } from './useItems'
import { formatDate } from '../../shared/utils/dateFormat'

export interface ItemRef {
  taskId?: string | null
  blockId?: string | null
  scheduleBlockId?: string | null
}
export type DeleteScope = 'item' | 'day' | 'all'

export interface SheetDeleteQuestion {
  title: string
  message?: string
  /** false: the sheet's own question asked (This day / Every day it repeats). */
  ask?: boolean
  /** The day, for scope 'day'. */
  occurrenceDate?: string | null
}

type Outcome = 'deleted' | 'kept' | 'gone' | 'failed'

export function useSheetDelete() {
  const delTask = useDeleteTask()
  const delBlock = useDeleteTimeBlock()
  const delPlan = useDeleteScheduleBlock()
  const repeatDay = useRepeatDay()

  function run(ref: ItemRef, scope: DeleteScope, q: SheetDeleteQuestion): Promise<Outcome> {
    const question = { title: q.title, message: q.message, ask: q.ask }
    if (scope === 'day' && ref.scheduleBlockId && q.occurrenceDate) {
      const scheduleBlockId = ref.scheduleBlockId
      const date = q.occurrenceDate
      return confirmDelete({
        ...question,
        confirmLabel: `Delete ${formatDate(date)}`,
        remove: async () => { await repeatDay.mutateAsync({ scheduleBlockId, date, action: 'skip' }); return date },
        restore: async () => { await repeatDay.mutateAsync({ scheduleBlockId, date, action: 'undo' }) },
        done: `${formatDate(date)} deleted`,
      })
    }
    if (ref.scheduleBlockId) return delPlan.run([ref.scheduleBlockId], { ...question, done: 'Repeating plan deleted' })
    if (ref.taskId) return delTask.run([ref.taskId], { ...question, done: 'Task deleted' })
    if (ref.blockId) return delBlock.run([ref.blockId], { ...question, done: 'Slot deleted' })
    return Promise.resolve('kept')
  }

  return { run, busy: delTask.busy || delBlock.busy || delPlan.busy || repeatDay.isPending }
}
