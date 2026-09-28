import { useDevRequestDrafts } from '../devRequestDraftStore'
import { appendBlock, formatPageContext, type PageContext } from '../devRequestContext'
import { draftFromRow, isDraftEmpty, topSortOrder, type DraftFields } from '../devRequestRules'
import { useCreateDevRequest, useDevRequests, useUpdateDevRequest } from './useDevRequests'
import type { DevRequest, DevRequestStatus } from '../types'
import { toast } from '../../../app/store'

const toRow = (f: DraftFields) => ({
  title: f.title.trim(),
  description: f.description.trim() || null,
  page: f.page,
  category: f.category,
  priority: f.priority,
  effort: f.effort || null,
})

/**
 * Saving a draft: the new request (with the automatic page context appended
 * when asked) or an edit. The draft is cleared only once the write succeeded,
 * so a failed save keeps every word.
 */
export function useSaveDevRequestDraft() {
  const create = useCreateDevRequest()
  const update = useUpdateDevRequest()
  const { data: requests = [] } = useDevRequests()

  function saveNew(now: PageContext, onDone?: () => void) {
    const draft = useDevRequestDrafts.getState().newDraft
    if (!draft.title.trim()) return
    const row = toRow(draft)
    if (draft.attachContext) {
      row.description = appendBlock(row.description ?? '', formatPageContext(draft.start ?? now, now))
    }
    create.mutate(
      { ...row, sort_order: topSortOrder(requests) },
      { onSuccess: () => { useDevRequestDrafts.getState().resetNewDraft(); onDone?.() } },
    )
  }

  function saveEdit(id: string, fields: DraftFields, status?: DevRequestStatus, onDone?: () => void) {
    if (!fields.title.trim()) return
    update.mutate(
      { id, patch: { ...toRow(fields), ...(status ? { status } : {}) } },
      { onSuccess: () => { useDevRequestDrafts.getState().clearEditDraft(id); onDone?.() } },
    )
  }

  return { saveNew, saveEdit, pending: create.isPending || update.isPending }
}

/** Throws the new draft away with an Undo — typed text is never lost by one tap. */
export function discardNewDraft() {
  const s = useDevRequestDrafts.getState()
  const prev = s.newDraft
  s.resetNewDraft()
  if (!isDraftEmpty(prev)) toast.undo('Draft discarded', () => useDevRequestDrafts.getState().restoreNewDraft(prev))
}

/** Throws an unsaved edit away with an Undo. */
export function discardEditDraft(request: DevRequest) {
  const s = useDevRequestDrafts.getState()
  const prev = s.editDrafts[request.id]
  if (!prev) return
  s.clearEditDraft(request.id)
  toast.undo('Changes discarded', () => useDevRequestDrafts.getState().patchEditDraft(request.id, prev, draftFromRow(request)))
}

