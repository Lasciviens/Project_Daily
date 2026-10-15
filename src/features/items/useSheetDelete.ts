// The Add sheet's delete — every one asks first (or the sheet's own question
// did), says what happened and offers Undo (docs/features/delete-undo.md).
// A thin adapter over the data layer's useDeleteItem (one delete for every
// screen), keeping the sheet's call:
//   item — the task (its slot goes with it, 077) or a slot of its own
//   all  — a repeating item: the rule, "Every day it repeats"
//   day  — one day of it, "Only 15.10.2026": that day leaves the repeat
//          (app_repeat_day 'remove' — never a skipped day); Undo puts it back
import { formatDate } from '../../shared/utils/dateFormat'
import { useDeleteItem, type DeleteOutcome } from './useItems'

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

export function useSheetDelete() {
  const del = useDeleteItem()

  function run(ref: ItemRef, scope: DeleteScope, q: SheetDeleteQuestion): Promise<DeleteOutcome> {
    const day = scope === 'day' && q.occurrenceDate ? q.occurrenceDate : null
    return del.run(
      { ...ref, date: day },
      {
        scope: day ? 'day' : ref.scheduleBlockId && !ref.taskId && !ref.blockId ? 'all' : scope === 'day' ? 'item' : scope,
        title: q.title, message: q.message, ask: q.ask,
        ...(day ? { confirmLabel: `Delete ${formatDate(day)}` } : {}),
      },
    )
  }

  return { run, busy: del.busy }
}
