import type { RecordFact } from '../shopSuggestions'
import { useEntityModal } from '../../../shared/modals'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useBuyNow } from '../hooks/useShop'
import { useNeedsALook } from '../hooks/useNeedsALook'
import { useClearSignalState, useDismissSignal, useSnoozeSignal } from '../hooks/useShopSignals'
import type { Look } from '../shopSuggestions'
import { NeedsALookButton, type LookActions } from './NeedsALook'
import type { ShopItem } from '../types'

/**
 * Needs a look's header button with its actions wired, the same on every Shop view (owner, 23.11.2026): a row opens
 * its thing (an old estimate or a tidy-up's problem at that fact — `openThing` decides where: Owned's side pane on a
 * wide board, else a popup), Bought buys in one tap, Snooze hides it for a week (or until the day before its
 * deadline) and Got it until what it says changes — each with its own toast and Undo.
 */
export function ShopNeedsALook({ items, isLoading, openThing }: {
  items: readonly ShopItem[]
  isLoading: boolean
  openThing: (id: string, fact?: RecordFact) => void
}) {
  const modal = useEntityModal()
  const data = useNeedsALook(items, isLoading)
  const buy = useBuyNow(id => modal.open({ kind: 'shop-just-bought', id }), { thenDetails: true })
  const snooze = useSnoozeSignal()
  const dismiss = useDismissSignal()
  const clear = useClearSignalState()
  const at = (look: Look) => ({ item_id: look.itemId, signal: look.kind, subject: look.subject })

  const actions: LookActions = {
    onOpen: look => {
      if (look.itemId) openThing(look.itemId, look.action === 'value' ? 'value' : undefined)
    },
    onBought: look => {
      const item = items.find(i => i.id === look.itemId)
      if (item) buy(item)
    },
    onClaim: look => { if (look.itemId) modal.open({ kind: 'shop-claim', id: look.itemId }) },
    onSnooze: look => { if (look.snoozeTo) snooze.mutate({ ...at(look), until: look.snoozeTo }) },
    onGotIt: look => dismiss.mutate({ ...at(look), signature: look.signature }),
    onShowAgain: look => clear.mutate(at(look)),
    onOpenThing: (id, fact) => openThing(id, fact),
  }
  return <NeedsALookButton {...data} today={todayStr()} actions={actions} />
}
