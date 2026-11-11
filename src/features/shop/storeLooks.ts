// What the stores' rules add to Needs a look (migration 191): a price protection that still holds for a thing you
// have (its row is cheaper_returnable's: "Claim 500 NOK"), the money already got back on it, and a store that
// matches a cheaper offer on Prisjakt's list for a wish ("Elkjøp matches Power: 2 990 there, read 05:23"). It
// loads in its own chunk with storeRules (useStoreLooks), so the Shop page's first download stays small. Pure —
// scripts/verify-shop-purchase.cjs.
import { formatMoney } from '../settings/subscriptionRules'
import { isMine } from './ownModel'
import { currencyOf, listOf, SHOP_CURRENCIES } from './shopModel'
import { bestMatchOf, gotBackOf, protectedPrice, protectionOf, storeOfItem, watchOffers, type StoreCtx } from './purchaseModel'
import { isShownLink } from './storeRows'
import { claimedBy } from './storeRules'
import { signalSignature } from './signalStates'
import { snoozeUntil, type Look, type LookProtection, type StoreLookInputs } from './shopSuggestions'
import type { ShopCurrency, ShopItem, ShopItemCost, ShopPriceWatch } from './types'

const asCurrency = (c: string): ShopCurrency | null => (SHOP_CURRENCIES.includes(c as ShopCurrency) ? c as ShopCurrency : null)

export interface StoreLookData {
  items:   readonly ShopItem[]
  watches: ReadonlyMap<string, ShopPriceWatch>
  costs:   readonly ShopItemCost[]
  ctx:     StoreCtx
  /** ISO instant: "read 05:23" when today. */
  now:     string
  today:   string
}

/** The stores' part of Needs a look, from the rows already read. */
export function storeLooks(d: StoreLookData): StoreLookInputs {
  const protections = new Map<string, LookProtection>()
  const gotBack = new Map<string, number>()
  const extra: Look[] = []
  const costsBy = new Map<string, ShopItemCost[]>()
  for (const c of d.costs) costsBy.set(c.item_id, [...(costsBy.get(c.item_id) ?? []), c])

  for (const i of d.items) {
    const watch = d.watches.get(i.id) ?? null
    if (isMine(i)) {
      const back = gotBackOf(costsBy.get(i.id) ?? [], currencyOf(i))
      if (back > 0) gotBack.set(i.id, back)
      const store = storeOfItem(i, d.ctx.stores)
      const p = store ? protectionOf(i, store, d.ctx.rules, d.today) : null
      if (store && p) {
        const price = protectedPrice(p, store, watch, watchOffers(watch, d.ctx.stores), d.ctx.stores)
        const currency = price ? asCurrency(price.currency) : null
        protections.set(i.id, {
          until: p.until, name: p.name,
          price: price && currency ? { amount: price.amount, currency } : null,
          where: price?.where ?? null,
        })
      }
      continue
    }
    // A store that matches a cheaper offer, for a wish still to buy (a general wish's models count through it).
    if (listOf(i) !== 'wishlist' || i.status !== 'wishlist' || i.kind === 'general' || i.option_for) continue
    const m = bestMatchOf(watch, d.ctx, d.now)
    if (!m) continue
    extra.push({
      key: `price_match:${i.id}`, kind: 'price_match', tone: m.unsure ? 'info' : 'success', itemId: i.id, subject: null, title: i.title,
      // Short pieces, so the row wraps between them on a phone (a MetaLine piece never breaks); the whole sentence
      // and every caveat are the rule's words (m.words, m.caveats) — a match nobody checked says so here.
      facts: [`${m.store.name} matches ${m.matches}`, `${formatMoney(m.price, m.currency)} there`, `read ${m.read}`,
        ...(m.saves != null && m.saves > 0 ? [`saves ${formatMoney(Math.round(m.saves), m.currency)}`] : []),
        ...(m.unsure ? [`from ${claimedBy(m.rule)} — check it`] : [])],
      where: null, action: 'open', claim: null, daysLeft: null, order: 0, things: [],
      signature: signalSignature('price_match', m.store.id, m.currency, m.price), snoozeTo: snoozeUntil(d.today),
      link: watch?.url && isShownLink(watch.url) ? watch.url : null,
    })
  }
  return { protections, gotBack, extra }
}
