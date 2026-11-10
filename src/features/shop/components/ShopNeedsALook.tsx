import { useEntityModal } from '../../../shared/modals'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useBuyNow } from '../hooks/useShop'
import { useNeedsALook } from '../hooks/useNeedsALook'
import { useClearSignalState, useDismissSignal, useSnoozeSignal } from '../hooks/useShopSignals'
import { snoozeUntil, type Look } from '../shopSuggestions'
import { NeedsALook, type LookActions } from './NeedsALook'
import type { ShopItem } from '../types'

/**
 * Needs a look with its actions wired, the same on the Wishlist and on Owned
 * (where it took Coming up's place, so a deadline is never listed twice): a
 * row opens its thing (an old estimate at that fact), Bought buys in one tap,
 * Snooze hides it for a week and Got it until what it says changes — each
 * with its own toast and Undo.
 */
export function ShopNeedsALook({ items, isLoading }: { items: readonly ShopItem[]; isLoading: boolean }) {
  const modal = useEntityModal()
  const data = useNeedsALook(items, isLoading)
  const buy = useBuyNow(id => modal.open({ kind: 'shop-item', id }))
  const snooze = useSnoozeSignal()
  const dismiss = useDismissSignal()
  const clear = useClearSignalState()
  const at = (look: Look) => ({ item_id: look.itemId, signal: look.kind })

  const actions: LookActions = {
    onOpen: look => {
      if (look.itemId) modal.open(look.action === 'value' ? { kind: 'shop-item', id: look.itemId, fact: 'value' } : { kind: 'shop-item', id: look.itemId })
    },
    onBought: look => {
      const item = items.find(i => i.id === look.itemId)
      if (item) buy(item)
    },
    onSnooze: look => snooze.mutate({ ...at(look), until: snoozeUntil(todayStr()) }),
    onGotIt: look => dismiss.mutate({ ...at(look), signature: look.signature }),
    onShowAgain: look => clear.mutate(at(look)),
    onOpenThing: id => modal.open({ kind: 'shop-item', id }),
  }
  return <NeedsALook {...data} actions={actions} />
}
