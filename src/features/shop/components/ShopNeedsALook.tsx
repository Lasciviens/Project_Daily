import { useEntityModal } from '../../../shared/modals'
import { useBoardStep } from '../../../shared/ui'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useBuyNow } from '../hooks/useShop'
import { useNeedsALook } from '../hooks/useNeedsALook'
import { useClearSignalState, useDismissSignal, useSnoozeSignal } from '../hooks/useShopSignals'
import type { Look } from '../shopSuggestions'
import { NeedsALook, type LookActions } from './NeedsALook'
import type { ShopItem } from '../types'

/**
 * Needs a look with its actions wired, the same on the Wishlist and on Owned
 * (where it took Coming up's place, so a deadline is never listed twice): a
 * row opens its thing (an old estimate at that fact), Bought buys in one tap,
 * Snooze hides it for a week (or until the day before its deadline) and Got
 * it until what it says changes — each with its own toast and Undo. `quiet`:
 * a phone shows no "Nothing needs a look" line (an empty wishlist).
 * `paneOpen`: on a wide board a row opens its record there (Owned's side
 * pane) instead of in a popup.
 */
export function ShopNeedsALook({ items, isLoading, quiet = false, paneOpen }: {
  items: readonly ShopItem[]
  isLoading: boolean
  quiet?: boolean
  paneOpen?: (id: string, fact?: 'value') => void
}) {
  const modal = useEntityModal()
  const wide = useBoardStep() >= 2
  const data = useNeedsALook(items, isLoading)
  const buy = useBuyNow(id => modal.open({ kind: 'shop-just-bought', id }), { thenDetails: true })
  const snooze = useSnoozeSignal()
  const dismiss = useDismissSignal()
  const clear = useClearSignalState()
  const at = (look: Look) => ({ item_id: look.itemId, signal: look.kind, subject: look.subject })

  const actions: LookActions = {
    onOpen: look => {
      if (!look.itemId) return
      const fact = look.action === 'value' ? 'value' as const : undefined
      if (paneOpen && wide) paneOpen(look.itemId, fact)
      else modal.open(fact ? { kind: 'shop-item', id: look.itemId, fact } : { kind: 'shop-item', id: look.itemId })
    },
    onBought: look => {
      const item = items.find(i => i.id === look.itemId)
      if (item) buy(item)
    },
    onClaim: look => { if (look.itemId) modal.open({ kind: 'shop-claim', id: look.itemId }) },
    onSnooze: look => { if (look.snoozeTo) snooze.mutate({ ...at(look), until: look.snoozeTo }) },
    onGotIt: look => dismiss.mutate({ ...at(look), signature: look.signature }),
    onShowAgain: look => clear.mutate(at(look)),
    onOpenThing: id => modal.open({ kind: 'shop-item', id }),
  }
  return <NeedsALook {...data} today={todayStr()} actions={actions} quiet={quiet} />
}
