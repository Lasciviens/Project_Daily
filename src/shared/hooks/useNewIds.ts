import { useEffect, useState } from 'react'
import { FRESH_ROW_MS, nextNewIds, type NewIdsState } from '../ui/motionRules'

/**
 * The ids that appeared in a list since it was last rendered — the rows that
 * get the "arrive" animation (`motion-row-in`). The first load, and the first load in a new `scope` (another
 * day), marks nothing. Pass `ready = false` while the list is still loading.
 * A row stops being new once its animation has played, so a later remount
 * (it moves to another section, a collapsed card opens again) never replays it.
 */
export function useNewIds(ids: readonly string[], scope = '', ready = true): ReadonlySet<string> {
  const key = ids.join('|')
  const [state, setState] = useState<(NewIdsState & { key: string }) | null>(null)
  // Adjusting state while rendering (React's documented pattern): the new set
  // is ready in the same render that shows the new row.
  if (ready && (state == null || state.key !== key || state.scope !== scope)) {
    setState({ ...nextNewIds(state, ids, scope), key })
  }

  const fresh = state?.fresh ?? EMPTY
  useEffect(() => {
    if (fresh.size === 0) return
    const id = window.setTimeout(() => {
      setState(s => (s && s.fresh === fresh ? { ...s, fresh: EMPTY } : s))
    }, FRESH_ROW_MS)
    return () => window.clearTimeout(id)
  }, [fresh])

  return fresh
}

const EMPTY: ReadonlySet<string> = new Set()
