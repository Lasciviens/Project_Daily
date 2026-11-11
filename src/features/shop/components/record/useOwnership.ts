import { useMemo } from 'react'
import { categoryScope, ownershipCost, ownershipPrices, worthShowing, type OwnershipCost, type OwnershipKind } from '../../ownershipCost'
import { money, num } from '../shopFormat'
import type { ShopCategory, ShopItem, ShopPriceWatch } from '../../types'
import type { MoneyCtx } from '../../ownModel'

export const KIND_LABEL: Record<OwnershipKind, string> = { new: 'New', used: 'Used', refurbished: 'Refurbished' }

export interface Ownership { cost: OwnershipCost; newFrom: ReturnType<typeof ownershipPrices>['newFrom'] }

/**
 * New vs used vs refurbished for a wish (step C), or null when it has nothing to say (`worthShowing`: two prices,
 * or one with its net cost) or `on` is false. New is the clean read of the wish's link or your own price — so a
 * wish without a link has it too, from its own price and your kept % (cleanup, 11.11.2026: it showed only with a
 * link); used and refurbished are Prisjakt's cheapest offers on that link.
 */
export function useOwnership(item: ShopItem, { items, categories, watch, ctx, on }: {
  items: readonly ShopItem[]; categories: readonly ShopCategory[]; watch: ShopPriceWatch | null; ctx: MoneyCtx; on: boolean
}): Ownership | null {
  return useMemo(() => {
    if (!on) return null
    const { prices, currency, newFrom } = ownershipPrices(item, watch)
    const cost = ownershipCost({ items, categoryIds: categoryScope(item.category_id, categories), prices, currency, rates: ctx.rates })
    return worthShowing(cost) ? { cost, newFrom } : null
  }, [on, item, watch, items, categories, ctx.rates])
}

/** The comparison folded (a wish without a link, whose Price section holds only it): its cheapest way, "Used ≈ 1 900 net". */
export function ownershipSummary({ cost }: Ownership): string {
  const o = cost.options.find(x => x.kind === cost.cheapest) ?? cost.options[0]
  return o.net !== null && o.net >= 0 ? `${KIND_LABEL[o.kind]} ≈ ${num(o.net)} net` : `${KIND_LABEL[o.kind]} ${money(o.price, o.currency)}`
}
