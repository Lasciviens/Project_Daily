// The item screen inside another popup (step 3 of docs/features/item-screen-plan.md; owner's answer 2: a training
// session's popup has the item screen as a tab). Under this context UnifiedPlanModal draws no chrome of its own: its
// save line and header controls go in a strip at the top of its body, and the host popup closes it through the handle
// (what waits is saved first; a failed save asks), so the item's one save, autosave and delete stay the screen's.
import { createContext, type MutableRefObject } from 'react'
import type { FlushResult } from './useItemAutosave'

export interface ItemScreenHandle {
  /** The host popup is closing: what waits is saved first (a failed save asks). Resolves false when it stayed open. */
  requestClose: () => Promise<boolean>
  /** The host switches away from the screen: what waits is saved now. */
  flush: () => Promise<FlushResult>
}

export const ItemScreenEmbedContext = createContext<MutableRefObject<ItemScreenHandle | null> | null>(null)
