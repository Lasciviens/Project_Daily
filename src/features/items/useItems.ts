// The item hooks every screen uses (contract: itemTypes.ts; rules:
// itemRules.ts; calls: itemApi.ts; Google after a save:
// calendar/api/itemCalendar.ts). Every write is one RPC — one transaction,
// one entry in Developer → Activity — and says its result. Google follows in
// the background: a save never waits for Google and a Google failure never
// undoes it (it is said once).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast, useCalendarStore } from '../../app/store'
import { useMutationWithFeedback } from '../../shared/hooks/useMutationWithFeedback'
import { confirmDelete } from '../../shared/modals/deleteFlow'
import { invalidate, qk, STALE } from '../../shared/query'
import { formatDate } from '../../shared/utils/dateFormat'
import { todayStr } from '../../shared/utils/dateUtils'
import { logError } from '../../shared/utils/logError'
import { ensureValidCalendarToken } from '../calendar/api/calendarTokenSync'
import { settleItemGoogle, settleRepeatDayGoogle } from '../calendar/api/itemCalendar'
import { useDeleteScheduleBlock, useDeleteTimeBlock } from '../daily/hooks/useSchedule'
import { resolveOrCreateGoogleTaskListId } from '../todo/api/googleTaskListsApi'
import { sectionForDay } from '../todo/taskRules'
import { useDeleteTask } from '../todo/hooks/useTodos'
import {
  convertOldItems, fetchCalendarReadbackState, fetchConvertPreview, repeatDay, saveItem, undoConversion,
  type RepeatDayAnswer,
} from './itemApi'
import {
  describeConverted, describeConvertUndone, describeRepeatDay, describeSaved, itemInputProblem,
} from './itemRules'
import type {
  CalendarReadbackState, ConvertPreview, ConvertResult, DeleteItemScope, DeleteItemTarget, ItemInput, RepeatDayInput, SavedItem,
} from './itemTypes'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const googleConnected = () => !!useCalendarStore.getState().accessToken

/** A list typed by name is found (or made on Google) first; an id is kept as it is. */
async function resolveTaskList(input: ItemInput): Promise<string | null> {
  const list = input.googleTaskList?.trim()
  if (!list) return null
  if (UUID.test(list)) return list
  if (!googleConnected() || (input.google !== 'tasks' && input.google !== 'both')) return null
  const token = await ensureValidCalendarToken()
  if (!token) return null
  try {
    return await resolveOrCreateGoogleTaskListId(token, list)
  } catch (err) {
    toast.warning(`Couldn't set up "${list}" on Google — saved in the default list: ${(err as Error).message}`)
    return null
  }
}

/**
 * THE item save — Add and edit, one-off or repeating, one day of a repeat
 * (scope 'day') or every day of it ('all'). "Added · 15.10.2026 17:30–18:30 ·
 * on Google Calendar".
 */
export function useSaveItem() {
  const qc = useQueryClient()
  return useMutationWithFeedback<SavedItem, ItemInput>({
    action: 'save_item',
    mutationFn: async input => {
      const problem = itemInputProblem(input)
      if (problem) throw new Error(problem)
      const today = todayStr()
      // The section follows the day; an edit with no day keeps its own (the database does).
      const section = input.section ?? (input.date ? sectionForDay(input.date, today) : input.taskId ? null : 'inbox')
      const googleTaskList = await resolveTaskList(input)
      const answer = await saveItem({ ...input, googleTaskList }, { section, today, googleConnected: googleConnected() })
      void settleItemGoogle(answer, input.google).then(() => invalidate(qc, 'taskGraph'))
      return {
        taskId: answer.taskId, blockId: answer.blockId, scheduleBlockId: answer.scheduleBlockId,
        created: answer.created, occurrenceDate: answer.occurrence ? answer.occurrenceDate : null,
      }
    },
    successMessage: (saved, input) => describeSaved(input, saved),
    invalidates: ['taskGraph', qk.items.all],
  })
}

/**
 * One day of ANY repeating item: done / skip (each says its result with
 * Undo: "Done for 15.10.2026 · Undo") and undo. The day becomes an item of
 * its own the first time (142); a double tap changes nothing.
 */
export function useRepeatDay() {
  const run = async (v: RepeatDayInput): Promise<RepeatDayAnswer> => {
    const answer = await repeatDay(v.scheduleBlockId, v.date, v.action, todayStr())
    settleRepeatDayGoogle(answer)
    return answer
  }
  const undo = useMutationWithFeedback<RepeatDayAnswer, RepeatDayInput>({
    action: 'repeat_day_undo',
    mutationFn: run,
    successMessage: (_a, v) => describeRepeatDay('undo', v.date),
    invalidates: ['taskGraph', qk.items.all],
  })
  return useMutationWithFeedback<RepeatDayAnswer, RepeatDayInput>({
    action: 'repeat_day',
    mutationFn: run,
    // done / skip say it with their Undo (onSuccess); undo says it plainly
    successMessage: (a, v) => (v.action === 'undo' ? describeRepeatDay('undo', v.date) : !a.changed ? `Already ${v.action === 'done' ? 'done' : 'skipped'}: ${formatDate(v.date)}` : undefined),
    onSuccess: (a, v) => {
      if (v.action === 'undo' || !a.changed) return
      toast.undo(describeRepeatDay(v.action, v.date), () => {
        void undo.mutateAsync({ ...v, action: 'undo' }).catch(() => { /* the mutation said why */ })
      })
    },
    invalidates: ['taskGraph', qk.items.all],
  })
}

/**
 * Deletes an item, with the question and Undo (useRowsDelete / confirmDelete):
 *   scope 'item' — a one-off item (its task, slot and Google copies);
 *   scope 'all'  — a repeating item, every day it repeats (its series);
 *   scope 'day'  — one day of a repeat ("Only 15.10.2026"): a day that is an
 *                  item of its own goes like an item (the day stays out of
 *                  the repeat); otherwise the day leaves the repeat.
 *   const del = useDeleteItem()
 *   del.run({ taskId, blockId, scheduleBlockId, date, title }, { scope: 'day' })
 */
export function useDeleteItem() {
  const qc = useQueryClient()
  const delTask = useDeleteTask()
  const delBlock = useDeleteTimeBlock()
  const delPlan = useDeleteScheduleBlock()
  const dayOff = useMutationWithFeedback<RepeatDayAnswer, { scheduleBlockId: string; date: string; action: 'remove' | 'restore' }>({
    action: 'repeat_day_remove',
    silent: 'the delete flow reports the result',
    mutationFn: async v => {
      const answer = await repeatDay(v.scheduleBlockId, v.date, v.action, todayStr())
      settleRepeatDayGoogle(answer)
      return answer
    },
    invalidates: ['taskGraph', qk.items.all],
  })

  function run(target: DeleteItemTarget, opts: { scope?: DeleteItemScope } = {}) {
    const scope = opts.scope ?? 'item'
    const title = target.title
    if (scope === 'all' || (!target.taskId && !target.blockId && target.scheduleBlockId && scope !== 'day')) {
      if (!target.scheduleBlockId) throw new Error('Delete every day: which repeating item?')
      return delPlan.run([target.scheduleBlockId], {
        title: 'Delete this repeating item?', message: `${title} — every day it repeats`, done: 'Repeating item deleted',
      })
    }
    if (scope === 'day') {
      if (!target.scheduleBlockId || !target.date) throw new Error('Delete one day: which day of the repeat?')
      const day = formatDate(target.date)
      if (target.taskId) {
        return delTask.run([target.taskId], { title: `Delete ${day} only?`, message: `${title} — the other days stay`, done: `${day} deleted` })
      }
      const planId = target.scheduleBlockId
      const date = target.date
      return confirmDelete<RepeatDayAnswer | null>({
        title: `Delete ${day} only?`,
        message: `${title} — the other days stay`,
        remove: async () => {
          const a = await dayOff.mutateAsync({ scheduleBlockId: planId, date, action: 'remove' })
          return a.changed ? a : null
        },
        restore: async () => {
          const a = await dayOff.mutateAsync({ scheduleBlockId: planId, date, action: 'restore' })
          void invalidate(qc, 'taskGraph')
          return a.changed ? undefined : { nothing: `${day} is an item of its own now — not put back` }
        },
        done: describeRepeatDay('remove', date),
        restored: describeRepeatDay('restore', date),
      })
    }
    if (target.taskId) return delTask.run([target.taskId], { title: 'Delete this item?', message: title, done: 'Item deleted' })
    if (target.blockId) return delBlock.run([target.blockId], { title: 'Delete this item?', message: title, done: 'Item deleted' })
    throw new Error('Delete: which item?')
  }

  return { run, busy: delTask.busy || delBlock.busy || delPlan.busy || dayOff.isPending }
}

/** Settings → Google: what "Convert old items" would do. Fetched when the button's preview opens. */
export function useConvertPreview(enabled = true) {
  return useQuery<ConvertPreview>({
    queryKey: qk.items.convertPreview(),
    queryFn: () => fetchConvertPreview(todayStr()),
    staleTime: STALE.short,
    enabled,
  })
}

/**
 * "Convert old items": every future standalone slot gets its task (its
 * event stays its one Google entry). Says the result with its own Undo,
 * which unlinks the slots first and never deletes one.
 */
export function useConvertOldItems() {
  const qc = useQueryClient()
  const undo = useMutationWithFeedback<{ undone: number; kept: number; already: boolean }, string>({
    action: 'convert_old_items_undo',
    mutationFn: id => undoConversion(id),
    successMessage: r => describeConvertUndone(r),
    invalidates: ['taskGraph', qk.items.all],
  })
  return useMutationWithFeedback<ConvertResult, void>({
    action: 'convert_old_items',
    mutationFn: () => convertOldItems(todayStr()),
    successMessage: r => (r.converted && r.conversionId ? undefined : describeConverted(r.converted)),
    onSuccess: r => {
      if (!r.converted || !r.conversionId) return
      const id = r.conversionId
      toast.undo(describeConverted(r.converted), () => {
        void undo.mutateAsync(id).catch(err => logError(`convert undo: ${(err as Error).message}`, { conversionId: id }))
      }, 10_000)
    },
    invalidates: ['taskGraph', qk.items.all],
    onSettled: () => { void qc.invalidateQueries({ queryKey: qk.items.convertPreview() }) },
  })
}

/** The Google card's line for the Google Calendar read-back (itemRules.readbackStateText words it). */
export function useCalendarReadbackState(enabled = true) {
  return useQuery<CalendarReadbackState>({
    queryKey: qk.items.calendarReadback(),
    queryFn: fetchCalendarReadbackState,
    staleTime: STALE.default,
    enabled,
  })
}
