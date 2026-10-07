import { useDevRequestDrafts } from '../devRequestDraftStore'
import type { PageContext } from '../devRequestContext'
import { appendMark, descriptionForSave } from '../devRequestMarks'
import { draftFromRow, isDraftEmpty, sameFields, topSortOrder, type DraftFields } from '../devRequestRules'
import { useCreateDevRequest, useDevRequests, useMarkDevRequestsPrompted, useUpdateDevRequest } from './useDevRequests'
import type { DevRequest, DevRequestStatus } from '../types'
import { toast } from '../../../app/store'

const toRow = (f: DraftFields) => ({
  title: f.title.trim(),
  description: descriptionForSave(f.description) || null,
  page: f.page,
  category: f.category,
  priority: f.priority,
  effort: f.effort || null,
})

const KEPT_NEWER = 'Saved — what you typed after pressing save is still in the draft'

/**
 * Saving a draft: the new request (with the automatic page context appended
 * when asked) or an edit. The draft is cleared only once the write succeeded,
 * so a failed save keeps every word — and only when it still holds what was
 * sent, so text typed while the save was on its way is kept.
 *
 * mutateAsync, not mutate's per-call callbacks: those never run when the
 * form unmounts first (closing the drawer or minimising the composer right
 * after pressing save), which left the saved text behind as a draft and a
 * second tap made a duplicate. `onDone` runs only when the draft was cleared.
 */
export function useSaveDevRequestDraft() {
  const create = useCreateDevRequest()
  const update = useUpdateDevRequest()
  const markPrompted = useMarkDevRequestsPrompted()
  const { data: requests = [] } = useDevRequests()

  async function saveNew(now: PageContext, onDone?: () => void) {
    const draft = useDevRequestDrafts.getState().newDraft
    if (!draft.title.trim()) return
    const row = toRow(draft)
    if (draft.attachContext) {
      row.description = appendMark(row.description ?? '', { type: 'page', start: draft.start ?? now, savedOn: now })
    }
    let created: DevRequest
    try {
      created = await create.mutateAsync({ ...row, sort_order: topSortOrder(requests) })
    } catch {
      return // toasted by the mutation; the draft stays
    }
    const s = useDevRequestDrafts.getState()
    // A prompt was built for this request before it was added (the window's
    // Prompt button): it is Prompted from the start, and the prompt now
    // belongs to the saved row.
    if (s.prompt.from?.kind === 'new') {
      markPrompted.mutate([created.id])
      s.setPromptSource([created.id], { kind: 'edit', id: created.id })
    }
    if (!sameFields(s.newDraft, draft)) { toast.warning(KEPT_NEWER); return }
    s.resetNewDraft()
    onDone?.()
  }

  async function saveEdit(id: string, fields: DraftFields, status?: DevRequestStatus, onDone?: () => void) {
    if (!fields.title.trim()) return
    try {
      await update.mutateAsync({ id, patch: { ...toRow(fields), ...(status ? { status } : {}) } })
    } catch {
      return
    }
    const s = useDevRequestDrafts.getState()
    const now = s.editDrafts[id]
    if (now && !sameFields(now, fields)) { toast.warning(KEPT_NEWER); return }
    s.clearEditDraft(id)
    onDone?.()
  }

  return { saveNew, saveEdit, pending: create.isPending || update.isPending }
}

/**
 * Throws the new draft away with an Undo — typed text is never lost by one
 * tap. `restart` keeps a still-open form tied to the page it is on.
 */
export function discardNewDraft(restart?: { start: PageContext; page: string }) {
  const s = useDevRequestDrafts.getState()
  const prev = s.newDraft
  s.resetNewDraft(restart)
  // A prompt built from the thrown-away draft no longer belongs to the next one.
  const prompted = s.prompt.from?.kind === 'new'
  if (prompted) s.setPromptSource([], null)
  if (!isDraftEmpty(prev)) toast.undo('Draft discarded', () => {
    const now = useDevRequestDrafts.getState()
    now.restoreNewDraft(prev)
    if (prompted && !now.prompt.from) now.setPromptSource([], { kind: 'new' })
  })
}

/** Throws an unsaved edit away with an Undo. */
export function discardEditDraft(request: DevRequest) {
  const s = useDevRequestDrafts.getState()
  const prev = s.editDrafts[request.id]
  if (!prev) return
  s.clearEditDraft(request.id)
  toast.undo('Changes discarded', () => useDevRequestDrafts.getState().patchEditDraft(request.id, prev, draftFromRow(request)))
}

