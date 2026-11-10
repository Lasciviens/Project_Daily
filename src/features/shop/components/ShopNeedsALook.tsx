import { useEntityModal } from '../../../shared/modals'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useBuyNow } from '../hooks/useShop'
import { useNeedsALook } from '../hooks/useNeedsALook'
import { useClearSignalState, useDismissSignal, useSnoozeSignal } from '../hooks/useShopSignals'
import type { Look } from '../shopSuggestions'
import { NeedsALook, type LookActions } from './NeedsALook'
import { isShopSignal } from '../signalStates'
import type { ShopItem, ShopSignal } from '../types'

/**
 * Needs a look with its actions wired, the same on the Wishlist and on Owned
 * (where it took Coming up's place, so a deadline is never listed twice): a
 * row opens its thing (an old estimate at that fact), Bought buys in one tap,
 * Snooze hides it for a week (or until the day before its deadline) and Got
 * it until what it says changes — each with its own toast and Undo. `quiet`:
 * a phone shows no "Nothing needs a look" line (an empty wishlist).
 */
export function ShopNeedsALook({ items, isLoading, quiet = false }: { items: readonly ShopItem[]; isLoading: boolean; quiet?: boolean }) {
  const modal = useEntityModal()
  const data = useNeedsALook(items, isLoading)
  const buy = useBuyNow(id => modal.open({ kind: 'shop-just-bought', id }), { thenDetails: true })
  const snooze = useSnoozeSignal()
  const dismiss = useDismissSignal()
  const clear = useClearSignalState()
  const at = (look: Look, signal: ShopSignal) => ({ item_id: look.itemId, signal, subject: look.subject })

  const actions: LookActions = {
    onOpen: look => {
      if (look.itemId) modal.open(look.action === 'value' ? { kind: 'shop-item', id: look.itemId, fact: 'value' } : { kind: 'shop-item', id: look.itemId })
    },
    onBought: look => {
      const item = items.find(i => i.id === look.itemId)
      if (item) buy(item)
    },
    onClaim: look => { if (look.itemId) modal.open({ kind: 'shop-claim', id: look.itemId }) },
    onSnooze: look => { if (look.snoozeTo && isShopSignal(look.kind)) snooze.mutate({ ...at(look, look.kind), until: look.snoozeTo }) },
    onGotIt: look => { if (isShopSignal(look.kind)) dismiss.mutate({ ...at(look, look.kind), signature: look.signature }) },
    onShowAgain: look => { if (isShopSignal(look.kind)) clear.mutate(at(look, look.kind)) },
    onOpenThing: id => modal.open({ kind: 'shop-item', id }),
  }
  return <NeedsALook {...data} today={todayStr()} actions={actions} quiet={quiet} />
}
