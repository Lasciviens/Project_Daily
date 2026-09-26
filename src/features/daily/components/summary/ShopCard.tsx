import { ShoppingCart, X } from 'lucide-react'
import { Cell, CellHeader, CellLink } from './cellKit'
import { Button, IconButton, SectionLabel } from '../../../../shared/ui'
import { useShopItems, useUpdateShopItem } from '../../../shop/hooks/useShop'
import type { ShopItem } from '../../../shop/types'
import { REGION_FLAG } from '../../../shop/shopMeta'

// Purchases planned for the viewed day (shop_items.planned_date) — mark
// bought or push by a day right here; plus a hint of the top wishlist items
// so an empty day still shows what could be planned.
export function ShopCard({ date }: { date: string }) {
  const { data: items = [] } = useShopItems()
  const update = useUpdateShopItem()

  const wishlist   = items.filter((i: ShopItem) => i.status === 'wishlist')
  const planned    = wishlist.filter((i: ShopItem) => i.planned_date === date)
  const unplanned  = wishlist
    .filter((i: ShopItem) => !i.planned_date)
    .sort((a: ShopItem, b: ShopItem) => (a.priority === 'high' ? 0 : a.priority === 'medium' ? 1 : 2) - (b.priority === 'high' ? 0 : b.priority === 'medium' ? 1 : 2))
    .slice(0, 2)

  return (
    <Cell>
      <CellHeader icon={<ShoppingCart />} title="Shopping" action={<CellLink to="/shop">Open</CellLink>} />

      {planned.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {planned.map((i: ShopItem) => (
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
                <p className="truncate text-body font-medium leading-snug text-fg">
                  {i.region && <span className="mr-1">{REGION_FLAG[i.region]}</span>}{i.title}
                </p>
                {i.price != null && <p className="text-meta tabular-nums text-fg-muted">{i.price}</p>}
              </div>
              <IconButton label="Remove from this day" onClick={() => update.mutate({ id: i.id, patch: { planned_date: null } })} className="shrink-0 hover:text-danger">
                <X />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-fg-muted">Nothing planned to buy this day.</p>
      )}

      {unplanned.length > 0 && (
        <div className="border-t border-line pt-2">
          <SectionLabel className="mb-1">Top wishlist</SectionLabel>
          <ul className="flex flex-col gap-1">
            {unplanned.map((i: ShopItem) => (
              <li key={i.id} className="flex items-center gap-2">
                <p className="flex-1 truncate text-body text-fg-2">
                  {i.region && <span className="mr-1">{REGION_FLAG[i.region]}</span>}{i.title}
                </p>
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
