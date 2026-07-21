import { Cell, CellHeader, CellLink } from './cellKit'
import { useShopItems, useUpdateShopItem } from '../../../shop/hooks/useShop'
import type { ShopItem } from '../../../shop/types'

const REGION_FLAG: Record<string, string> = { TR: '🇹🇷', NO: '🇳🇴' }

// 🛒 Purchases planned for the viewed day (shop_items.planned_date) — mark
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
      <CellHeader icon="🛒" title="Shopping" action={<CellLink to="/shop">Open →</CellLink>} />

      {planned.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {planned.map((i: ShopItem) => (
            <li key={i.id} className="flex items-center gap-2">
              <button
                onClick={() => update.mutate({ id: i.id, patch: { status: 'bought' } })}
                title="Mark bought"
                className="w-7 h-7 grid place-items-center shrink-0 rounded-md hover:bg-green-50 transition-colors group"
              ><span className="w-4 h-4 rounded border-2 border-ink-300 group-hover:border-green-500 group-hover:bg-green-100 transition-colors" /></button>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-ink-800 truncate leading-snug">
                  {i.region && <span className="mr-1">{REGION_FLAG[i.region]}</span>}{i.title}
                </p>
                {i.price != null && <p className="text-[10px] text-ink-400">{i.price}</p>}
              </div>
              <button
                onClick={() => update.mutate({ id: i.id, patch: { planned_date: null } })}
                title="Remove from this day"
                className="text-ink-300 hover:text-red-500 text-[11px] min-w-[24px] min-h-[24px] shrink-0"
              >✕</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-ink-400">Nothing planned to buy this day.</p>
      )}

      {unplanned.length > 0 && (
        <div className="border-t border-ink-100 pt-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-300 mb-1">Top wishlist</p>
          <ul className="flex flex-col gap-1">
            {unplanned.map((i: ShopItem) => (
              <li key={i.id} className="flex items-center gap-2">
                <p className="text-xs text-ink-600 truncate flex-1">
                  {i.region && <span className="mr-1">{REGION_FLAG[i.region]}</span>}{i.title}
                </p>
                <button
                  onClick={() => update.mutate({ id: i.id, patch: { planned_date: date } })}
                  className="text-[10px] px-1.5 py-0.5 rounded border border-ink-200 text-ink-500 hover:border-accent-300 hover:text-accent-700 transition-colors shrink-0 min-h-[24px]"
                  title="Plan to buy this day"
                >
                  → this day
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Cell>
  )
}
