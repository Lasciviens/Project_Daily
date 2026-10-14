import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { logError } from '../../../shared/utils/logError'
import type { DeletedRows, RowOverrides } from '../../../shared/utils/deletedRows'
import { applyUndo, fetchUndoPlan, type UndoPlan, type UndoResult } from '../api/undoSaveApi'
import { undoDoneMessage, undoneCount } from '../components/undoPlanText'
import { TASK_GOOGLE_RESET, syncGoogleTasksSoon } from '../../todo/hooks/useTodos'
import { BLOCK_EVENT_RESET, relinkRestoredBlockEvents, removeDeletedBlockEvents } from '../../calendar/api/deletedBlockEvents'
import {
  SERIES_EVENT_RESET, linkScheduleSeries, relinkRestoredSeriesEvents, removeDeletedSeriesEvents,
} from '../../calendar/api/scheduleSeriesCalendar'
import { updateTimeBlock } from '../../daily/api/scheduleApi'
import type { UpdateTimeBlockInput } from '../../daily/types'

export type { UndoPlan } from '../api/undoSaveApi'

// "Undo this save" (Developer → Activity, migration 150). The preview and the
// undo share the overrides the one delete flow's Undo uses (144): a row put
// back must not claim a Google Task or Calendar event that was deleted on
// Google with it — it gets a new one right after (the follow-ups below).
const UNDO_OVERRIDES: RowOverrides = { ...TASK_GOOGLE_RESET, ...BLOCK_EVENT_RESET, ...SERIES_EVENT_RESET }

/** What undoing the save would do. Read fresh each time the preview opens. */
export function useUndoPlan(txId: number | null) {
  return useQuery({
    queryKey: qk.logs.undoPlan(txId ?? 0),
    queryFn: () => fetchUndoPlan(txId as number, UNDO_OVERRIDES),
    enabled: txId !== null,
    staleTime: STALE.live,
    gcTime: 0,
    refetchOnWindowFocus: false,
    // keeps the last plan while the sheet closes (the sheet never shows it for another save)
    placeholderData: keepPreviousData,
  })
}

const snapshotOf = (groups: DeletedRows['groups']): DeletedRows =>
  ({ v: 1, root: '', deleted: 0, groups, links: [], touched: [], hidden: [] })

const CALENDAR_FIELDS = ['date', 'start_time', 'title', 'duration_minutes'] as const

/**
 * After an undo: Google follows, the way it does after the one delete flow's
 * Undo — slots and plans the undo deleted leave Google Calendar, those it put
 * back get an event again, slots whose time or title went back move their
 * event, and Google Tasks delivers what the outbox queued. Best effort; a
 * note says what didn't follow.
 */
async function followUndo(result: UndoResult, txId: number): Promise<string> {
  const notes: string[] = []
  const deleted = snapshotOf(result.deleted_rows)
  const byTable = new Map<string, Record<string, unknown>[]>()
  for (const r of result.reinserted_rows) byTable.set(r.t, [...(byTable.get(r.t) ?? []), r.row])
  const back = snapshotOf([...byTable].map(([table, rows]) => ({ table, pk: 'id', rows })))

  await removeDeletedBlockEvents(deleted)
  await removeDeletedSeriesEvents(deleted)
  const blockNote = await relinkRestoredBlockEvents(back)
  if (blockNote) notes.push(`a slot is ${blockNote}`)
  await relinkRestoredSeriesEvents(back)

  for (const r of result.reverted_rows) {
    if (!r.row.google_calendar_event_id) continue
    if (r.t === 'time_blocks') {
      const fields = CALENDAR_FIELDS.filter(f => r.columns.includes(f))
      if (!fields.length) continue
      const patch = Object.fromEntries(fields.map(f => [f, r.row[f]])) as UpdateTimeBlockInput
      const { calendarStatus } = await updateTimeBlock(String(r.row.id), patch)
      if (calendarStatus === 'unknown') notes.push('a slot\'s Google Calendar event is not moved back yet (open it and save)')
    } else if (r.t === 'schedule_blocks') {
      await linkScheduleSeries(String(r.row.id), { fromEditor: false })
    }
  }

  const tasksTouched = [...result.reverted_rows, ...result.reinserted_rows].some(r => r.t === 'tasks')
    || result.deleted_rows.some(g => g.table === 'tasks')
  if (tasksTouched) syncGoogleTasksSoon({ undoTx: txId })
  return [...new Set(notes)].join(' · ')
}

/**
 * Undoes one save (a transaction of the activity log) as previewed: the
 * plan's fingerprint goes back with it, so the database refuses if anything
 * changed since the preview. An undo can touch any table, so every query
 * refreshes afterwards. The result toast has an Undo of its own, which
 * `onUndoAgain` turns into the same preview for the undo's own save.
 */
export function useUndoSave(onUndoAgain: (txId: number) => void) {
  return useMutationWithFeedback({
    action: 'undo_save',
    silent: 'onSuccess below says the result, with an Undo toast',
    mutationFn: async ({ txId, confirm }: { txId: number; confirm: string }): Promise<UndoPlan> => {
      const done = await applyUndo(txId, confirm, UNDO_OVERRIDES)
      // The database's answer is the result; Google follows in the background.
      if (done.result) {
        void followUndo(done.result, txId)
          .then(note => { if (note) toast.warning(`Undone, but ${note}`) })
          .catch(err => {
            logError(`undo_save: undone, but a follow-up step failed: ${(err as Error).message}`, { txId })
            toast.warning(`Undone, but a follow-up step failed: ${(err as Error).message}`)
          })
      }
      return done
    },
    onSuccess: done => {
      const back = done.result?.undo_tx
      if (undoneCount(done) > 0 && back) toast.undo(undoDoneMessage(done), () => onUndoAgain(back))
      else toast.success(undoDoneMessage(done))
    },
    invalidates: ['saveUndone'],
  })
}
