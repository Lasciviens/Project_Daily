import { useEntityModal } from '../../../shared/modals'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useBuyNow } from '../hooks/useShop'
import { useNeedsALook } from '../hooks/useNeedsALook'
import { useClearSignalState, useDismissSignal, useSnoozeSignal } from '../hooks/useShopSignals'
import type { Look, RecordFact } from '../shopSuggestions'
import { NeedsALookButton, type LookActions } from './NeedsALook'
import type { ShopItem, ShopSignal } from '../types'
import { usePutNoticeAway } from '../hooks/useShopNotices'

/**
 * Needs a look's header button with its actions wired, the same on every Shop view (owner, 23.11.2026): a row opens
 * its thing's popup (an old estimate or a tidy-up's problem at that fact), Bought buys in one tap, Snooze hides it for a week (or until the day before its
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
  const putAway = usePutNoticeAway()
  // A server notice (211) is not a signal: it is read, never snoozed or remembered by 190's states.
  const at = (look: Look) => ({ item_id: look.itemId, signal: look.kind as ShopSignal, subject: look.subject })
  const signal = (look: Look) => look.kind !== 'bought_draft'

  const actions: LookActions = {
    onOpen: look => {
      // A purchase a plan bought: its record at the purchase, to check what the draft left for the owner.
      if (look.kind === 'bought_draft' && look.itemId) modal.open({ kind: 'shop-item', id: look.itemId, section: 'purchase' })
      else if (look.itemId) openThing(look.itemId, look.action === 'value' ? 'value' : undefined)
    },
    onBought: look => {
      const item = items.find(i => i.id === look.itemId)
      if (item) buy(item)
    },
    onClaim: look => { if (look.itemId) modal.open({ kind: 'shop-claim', id: look.itemId }) },
    onSnooze: look => { if (look.snoozeTo && signal(look)) snooze.mutate({ ...at(look), until: look.snoozeTo }) },
    onGotIt: look => (signal(look) ? dismiss.mutate({ ...at(look), signature: look.signature }) : look.subject && putAway.mutate(look.subject)),
    onShowAgain: look => { if (signal(look)) clear.mutate(at(look)) },
    onOpenThing: (id, fact) => openThing(id, fact),
  }
  return <NeedsALookButton {...data} today={todayStr()} actions={actions} />
}
