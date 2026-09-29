import { useState } from 'react'
import { nextNewIds, type NewIdsState } from '../ui/motionRules'

/**
 * The ids that appeared in a list since it was last rendered — the rows that
 * get the "arrive" animation (`motion-row-in`, only with the "More"
 * animations). The first load, and the first load in a new `scope` (another
 * day), marks nothing. Pass `ready = false` while the list is still loading.
 */
export function useNewIds(ids: readonly string[], scope = '', ready = true): ReadonlySet<string> {
  const key = ids.join('|')
  const [state, setState] = useState<(NewIdsState & { key: string }) | null>(null)
  // Adjusting state while rendering (React's documented pattern): the new set
  // is ready in the same render that shows the new row.
  if (ready && (state == null || state.key !== key || state.scope !== scope)) {
    setState({ ...nextNewIds(state, ids, scope), key })
  }
  return state?.fresh ?? EMPTY
}

const EMPTY: ReadonlySet<string> = new Set()
