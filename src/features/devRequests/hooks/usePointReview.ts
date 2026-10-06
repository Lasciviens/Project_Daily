import { useQueryClient } from '@tanstack/react-query'
import { qk } from '../../../shared/query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { useDevRequestDrafts } from '../devRequestDraftStore'
import type { PointReview } from '../devRequestMarks'
import { collectForRecheck, findRecheck, markMoved, recheckTitle, setReview } from '../points'
import { draftFromRow, topSortOrder } from '../devRequestRules'
import { createDevRequest, fetchDevRequests, updateDevRequest } from '../api/devRequestsApi'
import { useSetDevRequestDescription, useUpdateDevRequest } from './useDevRequests'
import type { DevRequest } from '../types'

/**
 * An unsaved edit of `row` (if any) gets the same change, so saving that edit
 * later never undoes a review made on the card. `saved` is the row's new
 * description: an edit that becomes equal to it is dropped.
 */
function mirrorIntoDraft(row: DevRequest, saved: string | null, edit: (description: string) => string) {
  const s = useDevRequestDrafts.getState()
  const draft = s.editDrafts[row.id]
  if (!draft) return
  const next = edit(draft.description)
  if (next !== draft.description) s.patchEditDraft(row.id, { description: next }, draftFromRow({ ...row, description: saved }))
}

/**
 * Fixed / Not fixed (with a note) / cleared for one point of a saved request:
 * written at once (optimistic), like a status. The point is found by its key
 * — a hash of its text — in the saved row and in the unsaved edit alike.
 */
export function useReviewPoint() {
  const write = useSetDevRequestDescription()
  return (row: DevRequest, key: string, review: Omit<PointReview, 'key'> | null) => {
    const r = review ? { ...review, at: new Date().toISOString() } : null
    const before = row.description ?? ''
    const next = setReview(before, key, r)
    if (next !== before) write.mutate({ id: row.id, description: next })
    mirrorIntoDraft(row, next, d => setReview(d, key, r))
  }
}

/**
 * Moves Not fixed points of `original` into its re-check request: the open
 * one collecting this request's points, else a new "Re-check: <title>" with
 * the same page, category, priority and effort (on top of the list). The
 * re-check request is written first and remembers which points it holds, so
 * a retry after a failed second write never copies a point twice; then the
 * original's points read "Moved to re-check".
 */
export function useSendToRecheck() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'send_dev_request_points_to_recheck',
    successMessage: 'Sent to re-check',
    mutationFn: async ({ original, keys }: { original: DevRequest; keys: string[] }) => {
      const all = qc.getQueryData<DevRequest[]>(qk.devRequests.all) ?? await fetchDevRequests()
      const row = all.find(r => r.id === original.id) ?? original
      const target = findRecheck(all, row.id)
      const { description, added } = collectForRecheck(target?.description ?? null, row, keys)
      let toId: string
      if (target) {
        if (added.length) await updateDevRequest(target.id, { description })
        toId = target.id
      } else {
        const created = await createDevRequest({
          title: recheckTitle(row.title),
          description,
          page: row.page,
          category: row.category,
          priority: row.priority,
          effort: row.effort,
          sort_order: topSortOrder(all),
        })
        toId = created.id
      }
      const at = new Date().toISOString()
      const moved = markMoved(row.description ?? '', keys, toId, at)
      await updateDevRequest(row.id, { description: moved })
      mirrorIntoDraft(row, moved, d => markMoved(d, keys, toId, at))
      return { toId }
    },
    invalidates: [qk.devRequests.all],
  })
}

/** "Mark request done" once every point is Fixed or moved. */
export function useMarkRequestDone() {
  const update = useUpdateDevRequest()
  return (row: DevRequest) => update.mutate({ id: row.id, patch: { status: 'done' } })
}
