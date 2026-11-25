import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { entityModal } from '../../../shared/modals'
import { qk, STALE } from '../../../shared/query'
import { logError } from '../../../shared/utils/logError'
import type { RowOverrides } from '../../../shared/utils/deletedRows'
import { applyUndo, fetchUndoPlan, type UndoPlan, type UndoResult } from '../api/undoSaveApi'
import { touchesTrakt, undoDoneMessage, undoneCount } from '../components/undoPlanText'
import { TASK_GOOGLE_RESET, syncGoogleTasksSoon } from '../../todo/hooks/useTodos'
import { BLOCK_EVENT_RESET, SERIES_EVENT_RESET } from '../../calendar/areas/restoreResets'
import { drainICloudSoon } from '../../calendar/areas/appleAreas'
import { scheduleTraktSync } from '../../media/trakt/traktAutoSync'

export type { UndoPlan } from '../api/undoSaveApi'

// "Undo this save" (Developer → Activity, migrations 150/151). The preview and
// the undo share the overrides the one delete flow's Undo uses (144): a row
// put back must not claim a Google Task or Apple Calendar event that was
// deleted with it — it gets a new one right after (the follow-ups below).
const UNDO_OVERRIDES: RowOverrides = { ...TASK_GOOGLE_RESET, ...BLOCK_EVENT_RESET, ...SERIES_EVENT_RESET }

/**
 * Opens the preview for one save, from any screen: an entity popup in the
 * app shell's host, so the result toast's Undo works after leaving Activity.
 */
export function openUndoSave(txId: number) {
  entityModal.open({ kind: 'undo-save', txId })
}

/** What undoing the save would do (the database's trial run). Read fresh each time the preview opens. */
export function useUndoPlan(txId: number, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.logs.undoPlan(txId),
    queryFn: () => fetchUndoPlan(txId, UNDO_OVERRIDES),
    enabled,
    staleTime: STALE.live,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })
}

/**
 * After an undo: the outside copies follow, the way they do after the one delete flow's Undo — Apple Calendar
 * through its queue (the database's triggers filled it; sent now), Google Tasks through its outbox. Best effort.
 */
async function followUndo(result: UndoResult, txId: number): Promise<string> {
  drainICloudSoon()
  const tasksTouched = [...result.reverted_rows, ...result.reinserted_rows].some(r => r.t === 'tasks')
    || result.deleted_rows.some(g => g.table === 'tasks')
  if (tasksTouched) syncGoogleTasksSoon({ undoTx: txId })
  return ''
}

/**
 * Undoes one save (a transaction of the activity log) as previewed: the
 * plan's fingerprint goes back with it, so the database refuses if anything
 * changed since the preview. An undo can touch any table, so every query
 * refreshes afterwards — after `onApplied` (the sheet closes) and with the
 * sheet's own plan dropped from the cache, so the refresh never runs the
 * trial again (nor flashes "Nothing to undo"). The result toast has an Undo
 * of its own: the same preview for the undo's own save.
 */
export function useUndoSave({ onApplied }: { onApplied?: () => void } = {}) {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'undo_save',
    silent: 'onSuccess below says the result, with an Undo toast',
    mutationFn: async ({ txId, confirm }: { txId: number; confirm: string }): Promise<UndoPlan> => {
      const done = await applyUndo(txId, confirm, UNDO_OVERRIDES)
      // The database's answer is the result; Apple Calendar and Google Tasks follow in the background.
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
    onSuccess: (done, { txId }) => {
      onApplied?.()
      qc.removeQueries({ queryKey: qk.logs.undoPlan(txId), exact: true })
      // Movies, shows and watches: Trakt hears it now, as after any media write.
      if (touchesTrakt(done)) scheduleTraktSync(qc)
      const back = done.result?.undo_tx
      if (undoneCount(done) > 0 && back) toast.undo(undoDoneMessage(done), () => openUndoSave(back))
      else toast.success(undoDoneMessage(done))
    },
    invalidates: ['saveUndone'],
  })
}
