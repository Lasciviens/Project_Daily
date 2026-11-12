import { ShoppingCart } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Cell, CellHeader, CellLink } from './cellKit'
import { Truncate } from '../../../../shared/ui'
import { useEntityModal } from '../../../../shared/modals'
import { useBuyNow, useQuickToPickUp } from '../../../shop/hooks/useShop'
import { REGION_FLAG } from '../../../shop/shopMeta'
import { Tick } from '../../../shop/components/quick/Tick'

/** How many quick-list rows the cell lists before "+N more". */
const SHOWN = 6

// Only what you put on the quick list to pick up next time (owner, 16.10.2026:
// "this should only show something I have added as buy next time"; answer
// 18.10.2026: "Quick list items only"): quick-list rows (not No rush),
// wishlist errands and deals due at their store — the Shop page's own
// `quickDue` + `quickFromWishlist`, over a narrow read of just those rows
// (`useQuickToPickUp`). A tick buys it, with Undo (`useBuyNow`).
// Wishlist plans for the day and top-wishlist hints are no longer shown here.
export function ShopCard({ date }: { date: string }) {
  const { data: quick = [] } = useQuickToPickUp(date)
  const modal = useEntityModal()
  const buy = useBuyNow(id => modal.open({ kind: 'shop-item', id }))
  const more = quick.length - SHOWN

  return (
    <Cell>
      <CellHeader icon={<ShoppingCart />} title="Shopping" action={<CellLink to="/shop?view=quick">Quick list</CellLink>} />

      {quick.length > 0 ? (
        <ul className="flex flex-col">
          {quick.slice(0, SHOWN).map(i => (
            <li key={i.id} className="flex items-center gap-1">
              <Tick label={`Picked up ${i.title}`} hint="Picked up" onClick={() => buy(i)} />
              <Truncate as="p" fullText={i.title} className="min-w-0 flex-1 text-body text-fg">
                {i.region && <span className="mr-1">{REGION_FLAG[i.region]}</span>}{i.title}
              </Truncate>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-fg-muted">Nothing on the quick list.</p>
      )}

      {more > 0 && (
        <Link to="/shop?view=quick" className="flex min-h-[36px] items-center text-meta font-medium text-accent-600 hover:underline">
          +{more} more on the quick list
        </Link>
      )}
    </Cell>
  )
}
