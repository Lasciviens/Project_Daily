import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { Hourglass, MoreHorizontal, Pencil, Search, Trash2, Zap } from 'lucide-react'
import { MetaLine, Skeleton, TonePill, Truncate, cx } from '../../../../shared/ui'
import { useEntityModal } from '../../../../shared/modals'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { formatMoney } from '../../../settings/subscriptionRules'
import { useDeleteShopItems, useUpdateShopItem } from '../../hooks/useShop'
import { chainName, chainPrices, cheapestStore, type GroceryPrice } from '../../groceryModel'
import { currencyOf, isNoRush, priceLabel } from '../../shopModel'
import type { ShopItem } from '../../types'

/** A matched row's price: still loading, unavailable (the basket says why), or read (none = no chain sells it now). */
export type RowPrice = { state: 'loading' } | { state: 'error' } | { state: 'ok'; price: GroceryPrice | undefined }

const TITLE = 'block text-body font-medium leading-5'
// pt-3 centres the first line on the 44px tick and ⋯ beside it.
const OPEN = 'min-h-[44px] min-w-0 flex-1 pb-2 pt-3 text-left'
const FACTS = 'mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1'
const MENU_ICON = 'h-4 w-4'

/** The 44px tick that leads every row. */
function Tick({ label, hint, onClick }: { label: string; hint: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={hint}
      className="group grid h-11 w-11 shrink-0 place-items-center rounded-control">
      <span className="h-5 w-5 rounded-[6px] border-2 border-line-strong transition-colors group-hover:border-success" />
    </button>
  )
}

/** The cheapest chain's price as a quiet chip; every chain on hover. */
function PriceFact({ price }: { price: RowPrice }) {
  if (price.state === 'loading') return <Skeleton rounded="rounded-full" className="h-[18px] w-28" />
  if (price.state === 'error') return null
  const best = cheapestStore(price.price)
  if (!best) return <span className="text-meta text-fg-muted" title="No chain Kassalapp follows has a price for this product now">No chain price</span>
  const all = chainPrices(price.price).map(c => `${c.chain} ${formatMoney(c.price, 'NOK')}`).join(' · ')
  return <span className="chip tabular-nums" title={`Cheapest now — ${all}`}>{formatMoney(best.price, 'NOK')} · {chainName(best)}</span>
}

/** A quick-list row: tick it off in the shop; ⋯ holds No rush, the price lookup, Edit and Delete. */
export function QuickRow({ item, price, onFindPrice }: { item: ShopItem; price: RowPrice | null; onFindPrice: (id: string) => void }) {
  const modal = useEntityModal()
  const update = useUpdateShopItem()
  const remove = useDeleteShopItems()
  const noRush = isNoRush(item)
  const showPrice = price != null && price.state !== 'error'
  const open = () => modal.open({ kind: 'shop-item', id: item.id })

  return (
    <li className="flex items-start gap-1 pr-1">
      <Tick label={`Picked up ${item.title}`} hint="Picked up" onClick={() => update.mutate({ id: item.id, patch: { status: 'bought' }, quiet: true })} />
      <button type="button" onClick={open} className={OPEN}>
        <Truncate as="span" className={cx(TITLE, noRush ? 'text-fg-2' : 'text-fg')}>{item.title}</Truncate>
        {(noRush || showPrice || item.notes) && (
          <span className={FACTS}>
            {noRush && (
              <span className="inline-flex shrink-0 items-center gap-1 text-meta font-medium text-fg-muted">
                <Hourglass aria-hidden className="h-3 w-3" /> No rush
              </span>
            )}
            {showPrice && <PriceFact price={price} />}
            {item.notes && <Truncate as="span" className="min-w-0 text-meta text-fg-muted">{item.notes}</Truncate>}
          </span>
        )}
      </button>
      <Menu as="div" className="shrink-0">
        <MenuButton className="icon-btn text-fg-muted" aria-label={`More for ${item.title}`} title="More">
          <MoreHorizontal aria-hidden className="h-[18px] w-[18px]" />
        </MenuButton>
        <MenuItems anchor="bottom end" transition
          className="menu w-52 [--anchor-gap:4px] transition duration-150 data-[closed]:scale-95 data-[closed]:opacity-0">
          <MenuItem>
            <button type="button" className="menu-item" onClick={() => update.mutate({ id: item.id, patch: { priority: noRush ? 'medium' : 'low' }, quiet: true })}>
              {noRush ? <><Zap aria-hidden className={MENU_ICON} /> Needed soon</> : <><Hourglass aria-hidden className={MENU_ICON} /> No rush</>}
            </button>
          </MenuItem>
          <MenuItem>
            <button type="button" className="menu-item" onClick={() => onFindPrice(item.id)}>
              <Search aria-hidden className={MENU_ICON} /> {item.ean ? 'Change product' : 'Find a price'}
            </button>
          </MenuItem>
          <MenuItem>
            <button type="button" className="menu-item" onClick={open}><Pencil aria-hidden className={MENU_ICON} /> Edit</button>
          </MenuItem>
          <div className="menu-sep" />
          <MenuItem>
            <button type="button" className="menu-item is-danger" onClick={() => remove.mutate({ ids: [item.id], label: item.title })}>
              <Trash2 aria-hidden className={MENU_ICON} /> Delete
            </button>
          </MenuItem>
        </MenuItems>
      </Menu>
    </li>
  )
}

/**
 * A wishlist row shown on the quick list too (an errand, or a deal from its
 * day): it never changes list, and ticking it buys it — it becomes one of
 * your things (`onBuy` is the page's one-tap Bought with Add details + Undo).
 */
export function WishlistRow({ item, onBuy }: { item: ShopItem; onBuy: (item: ShopItem) => void }) {
  const modal = useEntityModal()
  const deal = !!item.wait_for_deal
  const target = item.target_price != null ? `Target ${formatMoney(item.target_price, currencyOf(item))}` : null
  return (
    <li className="flex items-start gap-1 pr-3">
      <Tick label={`Bought ${item.title}`} hint="Bought — it becomes one of your things" onClick={() => onBuy(item)} />
      <button type="button" onClick={() => modal.open({ kind: 'shop-item', id: item.id })} className={OPEN}>
        <Truncate as="span" className={cx(TITLE, 'text-fg')}>{item.title}</Truncate>
        <span className={FACTS}>
          <TonePill tone="highlight" className="shrink-0">From the wishlist</TonePill>
          <MetaLine as="span" className="text-meta text-fg-muted tabular-nums"
            items={deal ? [item.planned_date && `Deal from ${formatDate(item.planned_date)}`, target] : [priceLabel(item)]} />
        </span>
        {deal && item.deal_note && <Truncate as="span" className="mt-1 block text-meta text-fg-muted">{item.deal_note}</Truncate>}
      </button>
    </li>
  )
}
