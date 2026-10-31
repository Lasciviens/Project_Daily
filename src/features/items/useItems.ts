// The item hooks every screen uses (contract: itemTypes.ts; rules:
// itemRules.ts; calls: itemApi.ts; Google after a save:
// calendar/api/itemCalendar.ts). Every write is one RPC — one transaction,
// one entry in Developer → Activity — and says its result. Google follows in
// the background: a save never waits for Google and a Google failure never
// undoes it (it is said once).
import { useEffect } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
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
import { syncGoogleTasksSoon, useDeleteTask } from '../todo/hooks/useTodos'
import {
  convertOldItems, fetchCalendarReadbackState, fetchConvertPreview, fetchRepeatDayTaskId, repeatDay, runRepeatDaysToday, saveItem,
  undoConversion,
  type RepeatDayAnswer, type SaveItemAnswer, type SaveItemContext,
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
 * The item save's steps around its one RPC: the checks, the section and the
 * Google Tasks list before, Google after (in the background). `send` is
 * app_save_item (useSaveItem) or a save that wraps it in its own transaction
 * (163's app_football_plan) — null when that save changed nothing. Quiet: the
 * caller says the result.
 */
export async function saveItemVia<A extends SaveItemAnswer>(
  qc: QueryClient, input: ItemInput, send: (input: ItemInput, ctx: SaveItemContext) => Promise<A | null>,
): Promise<A | null> {
  const problem = itemInputProblem(input)
  if (problem) throw new Error(problem)
  const today = todayStr()
  // The section follows the day; an edit with no day keeps its own (the database does).
  const section = input.section ?? (input.date ? sectionForDay(input.date, today) : input.taskId ? null : 'inbox')
  const googleTaskList = await resolveTaskList(input)
  const answer = await send({ ...input, googleTaskList }, { section, today, googleConnected: googleConnected() })
  // Labels need migration 180: a database before it answers without them and keeps none — said, never silent.
  if (answer?.taskId && input.labels?.length && answer.labels === null) {
    toast.warning('Saved without its labels — they need the latest database update (migration 180)')
  }
  if (answer) void settleItemGoogle(answer, input.google).then(() => invalidate(qc, 'taskGraph'))
  return answer
}

/**
 * THE item save — Add and edit, one-off or repeating, one day of a repeat
 * (scope 'day') or every day of it ('all'). "Added · 15.10.2026 17:30–18:30 ·
 * on Google Calendar". A caller whose save means more than that (a training
 * session moved out of its week, 167/169) reads back what happened (`after`,
 * once the database answered) and says it (`describe` — undefined keeps the
 * usual line).
 */
export function useSaveItem(own?: {
  after?: (input: ItemInput, saved: SavedItem) => Promise<unknown>
  describe?: (input: ItemInput, after: unknown) => string | undefined
}) {
  const qc = useQueryClient()
  return useMutationWithFeedback<SavedItem, ItemInput>({
    action: 'save_item',
    mutationFn: async input => {
      const answer = (await saveItemVia(qc, input, saveItem))!
      const saved: SavedItem = {
        taskId: answer.taskId, blockId: answer.blockId, scheduleBlockId: answer.scheduleBlockId,
        created: answer.created, occurrenceDate: answer.occurrence ? answer.occurrenceDate : null,
      }
      return own?.after ? { ...saved, after: await own.after(input, saved).catch(() => null) } : saved
    },
    successMessage: (saved, input) => own?.describe?.(input, saved.after) ?? describeSaved(input, saved),
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
    // A day on Google Tasks (the iPhone widget) follows now, not at the next sync.
    if (answer.changed && answer.taskId) syncGoogleTasksSoon({ taskId: answer.taskId })
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

export type DeleteOutcome = 'deleted' | 'kept' | 'gone' | 'failed'
export interface DeleteQuestionWords {
  title?: string
  message?: string
  confirmLabel?: string
  /** false: the screen's own dialog already asked. */
  ask?: boolean
}

/**
 * Deletes an item, with the question and Undo (useRowsDelete / confirmDelete):
 *   scope 'item' — a one-off item (its task, slot and Google copies);
 *   scope 'all'  — a repeating item, every day it repeats (its series);
 *   scope 'day'  — one day of a repeat ("Only 15.10.2026"): a day that is a
 *                  task — split off (142) or made on its day (156), open,
 *                  ticked, skipped or missed — goes as that task, with its
 *                  own Undo (the same row back; the day leaves the repeat and
 *                  comes back with it); otherwise the day leaves the repeat.
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

  /** Deletes; resolves what happened ('kept' = the owner said no). `question`
   *  replaces the words of the question (or `ask: false` when the screen's
   *  own dialog asked — the sheet's "This day / Every day it repeats"). */
  function run(target: DeleteItemTarget, opts: { scope?: DeleteItemScope } & DeleteQuestionWords = {}): Promise<DeleteOutcome> {
    const scope = opts.scope ?? 'item'
    const title = target.title ?? ''
    const words = (title0: string, message0: string) => ({
      title: opts.title ?? title0, message: opts.message ?? message0, ask: opts.ask,
      ...(opts.confirmLabel ? { confirmLabel: opts.confirmLabel } : {}),
    })
    if (scope === 'all' || (!target.taskId && !target.blockId && target.scheduleBlockId && scope !== 'day')) {
      if (!target.scheduleBlockId) return Promise.reject(new Error('Delete every day: which repeating item?'))
      return delPlan.run([target.scheduleBlockId], {
        ...words('Delete this repeating item?', `${title} — every day it repeats`), done: 'Repeating item deleted',
      })
    }
    if (scope === 'day') {
      if (!target.scheduleBlockId || !target.date) return Promise.reject(new Error('Delete one day: which day of the repeat?'))
      const day = formatDate(target.date)
      const asTask = (taskId: string) =>
        delTask.run([taskId], { ...words(`Delete ${day} only?`, `${title} — the other days stay`), done: `${day} deleted` })
      if (target.taskId) return asTask(target.taskId)
      const planId = target.scheduleBlockId
      const date = target.date
      // The day is a task already (156: made on its day; ticked, skipped or
      // missed too): it goes as that task — the database takes the day out
      // of the repeat, and Undo puts back the same row and the day.
      return fetchRepeatDayTaskId(planId, date).then(
        taskId => (taskId ? asTask(taskId) : removeDay(planId, date, day)),
        (err: Error) => { toast.error(`Couldn't delete ${day}: ${err.message}`); return 'failed' as const },
      )
    }
    if (target.taskId) return delTask.run([target.taskId], { ...words('Delete this item?', title), done: 'Item deleted' })
    if (target.blockId) return delBlock.run([target.blockId], { ...words('Delete this item?', title), done: 'Item deleted' })
    return Promise.reject(new Error('Delete: which item?'))

    /** A day with no task of its own leaves the repeat; Undo puts it back. */
    function removeDay(planId: string, date: string, day: string): Promise<DeleteOutcome> {
      return confirmDelete<RepeatDayAnswer | null>({
        ...words(`Delete ${day} only?`, `${title} — the other days stay`),
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

// The last day this device ran app_repeat_days_today, and when (one run per
// day and half hour is plenty: the hourly job does the same on the server).
let repeatDaysRan: { day: string; at: number } | null = null
let repeatDaysRunning: Promise<void> | null = null
let repeatDaysLogged = false
const REPEAT_DAYS_EVERY_MS = 30 * 60_000

/**
 * A repeat's day is a real task on its day (156): the hourly job makes today's
 * and closes yesterday's unticked ones as missed; this is its fallback when
 * the app opens or comes back to the front — the same call for this account,
 * on this device's day. Quiet: it refreshes the lists when it changed
 * something; a failure goes to Developer → Errors once (never a toast on every
 * open). A database without 156 does nothing.
 */
export function useRepeatDaysOnOpen() {
  const qc = useQueryClient()
  useEffect(() => {
    const run = () => {
      if (document.visibilityState !== 'visible' || repeatDaysRunning) return
      const day = todayStr()
      if (repeatDaysRan && repeatDaysRan.day === day && Date.now() - repeatDaysRan.at < REPEAT_DAYS_EVERY_MS) return
      repeatDaysRunning = runRepeatDaysToday(day)
        .then(r => {
          repeatDaysRan = { day, at: Date.now() }
          if (r && (r.created > 0 || r.missed > 0 || r.skipped > 0)) void invalidate(qc, 'taskGraph')
        })
        .catch(err => {
          if (repeatDaysLogged) return
          repeatDaysLogged = true
          logError(`Repeat days not made on open: ${(err as Error).message}`, { action: 'repeat_days_today' })
        })
        .finally(() => { repeatDaysRunning = null })
    }
    run()
    document.addEventListener('visibilitychange', run)
    return () => document.removeEventListener('visibilitychange', run)
  }, [qc])
}
