import { ShoppingCart, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Cell, CellHeader, CellLink } from './cellKit'
import { Button, IconButton, SectionLabel, Truncate } from '../../../../shared/ui'
import { useShopItems, useUpdateShopItem } from '../../../shop/hooks/useShop'
import { PRIORITY_RANK as RANK, listOf, priceLabel, quickDue, quickFromWishlist } from '../../../shop/shopModel'
import type { ShopItem } from '../../../shop/types'
import { REGION_FLAG } from '../../../shop/shopMeta'

// Purchases planned for the viewed day (shop_items.planned_date, either list)
// — mark bought or take off the day right here; how much is on the quick
// list; and a hint of the top wishlist items so an empty day still shows what
// could be planned.
export function ShopCard({ date }: { date: string }) {
  const { data: items = [] } = useShopItems()
  const update = useUpdateShopItem()

  // A general wish is never bought itself (its model is), and a deal's day is when to check, not to buy.
  const toBuy     = items.filter((i: ShopItem) => i.status === 'wishlist' && i.kind !== 'general')
  const planned   = toBuy.filter((i: ShopItem) => i.planned_date === date && !i.wait_for_deal)
  const quick     = [...quickDue(items), ...quickFromWishlist(items, date)].filter(i => i.planned_date !== date || i.wait_for_deal)
  const unplanned = items
    .filter((i: ShopItem) => i.status === 'wishlist' && listOf(i) === 'wishlist' && !i.option_for && !i.planned_date)
    .sort((a: ShopItem, b: ShopItem) => RANK[a.priority] - RANK[b.priority])
    .slice(0, 2)

  return (
    <Cell>
      <CellHeader icon={<ShoppingCart />} title="Shopping" action={<CellLink to="/shop">Open</CellLink>} />

      {planned.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {planned.map((i: ShopItem) => {
            const price = priceLabel(i)
            return (
              <li key={i.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => update.mutate({ id: i.id, patch: { status: 'bought' } })}
                  aria-label={`Mark ${i.title} bought`}
                  className="group grid h-11 w-11 shrink-0 place-items-center rounded-control hover:bg-success-soft"
                >
                  <span className="h-4 w-4 rounded-[5px] border-2 border-line-strong transition-colors group-hover:border-success" />
                </button>
                <div className="min-w-0 flex-1">
                  <Truncate as="p" fullText={i.title} className="text-body font-medium leading-snug text-fg">
                    {i.region && <span className="mr-1">{REGION_FLAG[i.region]}</span>}{i.title}
                  </Truncate>
                  {price && <p className="text-meta tabular-nums text-fg-muted">{price}</p>}
                </div>
                <IconButton label="Remove from this day" onClick={() => update.mutate({ id: i.id, patch: { planned_date: null } })} className="shrink-0 hover:text-danger">
                  <X />
                </IconButton>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-body text-fg-muted">Nothing planned to buy this day.</p>
      )}

      {quick.length > 0 && (
        <Link to="/shop?view=quick" className="flex min-h-[44px] items-center text-body font-medium text-accent-600 hover:underline">
          Quick list · {quick.length} to pick up
        </Link>
      )}

      {unplanned.length > 0 && (
        <div className="border-t border-line pt-2">
          <SectionLabel className="mb-1">Top wishlist</SectionLabel>
          <ul className="flex flex-col gap-1">
            {unplanned.map((i: ShopItem) => (
              <li key={i.id} className="flex items-center gap-2">
                <Truncate as="p" fullText={i.title} className="flex-1 text-body text-fg-2">
                  {i.region && <span className="mr-1">{REGION_FLAG[i.region]}</span>}{i.title}
                </Truncate>
                <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: i.id, patch: { planned_date: date } })} className="shrink-0">
                  Plan this day
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Cell>
  )
}
