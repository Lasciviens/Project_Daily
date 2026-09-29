import { useDevRequestDrafts } from '../devRequestDraftStore'
import { findCheckpoint, occurrenceOf, setDone, type Checkpoint } from '../checkpoints'
import { parseDescription, withCheckpoints } from '../devRequestMarks'
import { draftFromRow } from '../devRequestRules'
import { useSetDevRequestDescription } from './useDevRequests'
import type { DevRequest } from '../types'

/**
 * Ticks a checkpoint of a saved request: the row is written at once, and an
 * unsaved edit of it (if any) gets the same tick, so saving that edit later
 * never undoes it. `from` is the list the tick was made on (the card's row,
 * or the composer's draft); the same checkpoint is found in the other by
 * its text.
 */
export function useTickCheckpoint() {
  const write = useSetDevRequestDescription()
  return (row: DevRequest, from: readonly Checkpoint[], index: number, done: boolean) => {
    const target = from[index]
    if (!target) return
    const nth = occurrenceOf(from, index)
    const saved = parseDescription(row.description).checkpoints
    const at = findCheckpoint(saved, target.text, nth)
    const next = at >= 0 ? withCheckpoints(row.description ?? '', setDone(saved, at, done)) : row.description
    if (at >= 0 && next !== null) write.mutate({ id: row.id, description: next })
    const s = useDevRequestDrafts.getState()
    const draft = s.editDrafts[row.id]
    if (draft) {
      const list = parseDescription(draft.description).checkpoints
      const j = findCheckpoint(list, target.text, nth)
      if (j >= 0) s.patchEditDraft(row.id, { description: withCheckpoints(draft.description, setDone(list, j, done)) }, draftFromRow({ ...row, description: next }))
    }
  }
}
