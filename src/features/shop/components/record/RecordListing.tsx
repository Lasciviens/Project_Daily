import { Suspense, useMemo, useState } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { HandCoins, MoreHorizontal, PenLine, Send, TrendingDown } from 'lucide-react'
import { Button, CardHeader, TonePill, Truncate } from '../../../../shared/ui'
import { useEntityModal } from '../../../../shared/modals'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { lazyPart } from '../../../../shared/utils/lazyPage'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { DecimalInput } from '../../../recipes/components/foodLogKit'
import { priceChangePatch, priceChangeWords, useChangeListing, useListings } from '../../hooks/useShopResale'
import { listingNudge, priceNow } from '../../listingNudge'
import { categoryPath } from '../../shopModel'
import { isPrice, normalizeAdUrl, twoDecimals } from '../../resaleRows'
import { endedListingsOf, listingTag, listingWords, openListingOf, priceCuts } from '../../sellingModel'
import { money, num } from '../shopFormat'
import { AddressLink } from './AddressLink'
import type { ShopRecordModel } from './useShopRecord'
import type { ShopListing } from '../../resaleTypes'

const AdSheet = lazyPart('shop-ad-sheet', () => import('./AdSheet').then(m => m.AdSheet))

/**
 * Selling, in the record's Resale section: the ad (written from the marketplace's template, copied by hand — never
 * posted), then Listed → For sale with its price changes and the nudge ("12 days, no sale; yours usually go in 9 —
 * lower it?"), then Sold through the sell flow (which closes the listing). Every change says its result with Undo.
 */
export function RecordListing({ r }: { r: ShopRecordModel }) {
  const { item, today, items, categories } = r
  const modal = useEntityModal()
  const { data: listings = [], isLoading } = useListings()
  const change = useChangeListing()
  const [writing, setWriting] = useState(false)
  const [pricing, setPricing] = useState(false)
  const [linking, setLinking] = useState(false)
  const open = openListingOf(listings, item.id)
  const ended = endedListingsOf(listings, item.id)
  const topId = categoryPath(item.category_id, categories).topId
  // "Yours usually go in": your listings of things in the same top category.
  const sameCategory = useMemo(() => new Set(items.filter(i => topId && categoryPath(i.category_id, categories).topId === topId).map(i => i.id)), [items, categories, topId])
  const nudge = open ? listingNudge(open, listings, today, sameCategory) : null
  const tag = listingTag(open, today)
  const set = (listing: ShopListing, patch: Parameters<typeof change.mutate>[0]['patch'], done: string) => change.mutate({ listing, patch, done, today })

  return (
    <div>
      <CardHeader title="Selling" variant="label" className="mb-1"
        action={!open && !isLoading && <Button size="sm" variant="ghost" icon={<PenLine />} onClick={() => setWriting(true)}>Write the ad</Button>} />
      {!open && !isLoading && (
        <p className="text-meta text-fg-muted">Write the ad from your template for the marketplace, copy it and post it yourself — the app never posts anything. Then mark it listed here.</p>
      )}
      {open && (
        <div className="flex flex-col gap-2 rounded-row border border-line px-3 py-2">
          <div className="flex items-center gap-2">
            {tag && <TonePill tone={tag.tone} className="shrink-0 tabular-nums">{tag.text}</TonePill>}
            <Truncate as="span" className="min-w-0 flex-1 text-meta text-fg-muted">{open.marketplace ?? 'Another place'}</Truncate>
            <span className="shrink-0 text-body font-semibold tabular-nums text-fg">{money(priceNow(open), open.currency)}</span>
          </div>
          <p className="text-meta tabular-nums text-fg-muted">
            Listed {formatDate(open.listed_on)}{open.for_sale_on ? ` · up ${formatDate(open.for_sale_on)}` : ''}
            {open.prices.length > 1 && <> · asked {open.prices.map((p, i) => <span key={i} className="whitespace-nowrap">{i > 0 && ' → '}{money(p.price, open.currency)}{i > 0 && ` (${formatDate(p.on)})`}</span>)}</>}
          </p>
          {open.ad_url ? <AddressLink url={open.ad_url} className="text-meta" /> : linking && <AdLinkForm listing={open} onDone={() => setLinking(false)} />}
          {nudge && !pricing && (
            <div className="flex items-center gap-2 rounded-row bg-warn-soft px-2 py-1">
              <span className="min-w-0 flex-1 text-meta text-fg-2">{nudge.words}</span>
              <Button size="sm" variant="ghost" icon={<TrendingDown />} onClick={() => setPricing(true)} className="shrink-0">Lower it</Button>
            </div>
          )}
          {pricing && <PriceForm listing={open} onSave={price => {
            const patch = priceChangePatch(open, price, today)
            if (patch) set(open, patch, priceChangeWords(open, price))
            setPricing(false)
          }} onCancel={() => setPricing(false)} busy={change.isPending} />}
          {!pricing && (
            <div className="flex flex-wrap items-center gap-1.5">
              {open.status === 'listed'
                ? <Button size="sm" icon={<Send />} onClick={() => set(open, { status: 'for_sale', for_sale_on: today }, `For sale${open.marketplace ? ` on ${open.marketplace}` : ''}`)} loading={change.isPending}>It's up for sale</Button>
                : <Button size="sm" icon={<HandCoins />} onClick={() => modal.open({ kind: 'shop-sell', id: item.id })}>Sold</Button>}
              <Button size="sm" variant="ghost" icon={<TrendingDown />} onClick={() => setPricing(true)}>Change the price</Button>
              <Menu as="div" className="ml-auto">
                <MenuButton className="icon-btn" aria-label="More for this listing" title="More">
                  <MoreHorizontal aria-hidden className="h-[18px] w-[18px]" />
                </MenuButton>
                <MenuItems anchor={{ to: 'bottom end', gap: 4, padding: 12 }} className="menu z-toast w-56">
                  <MenuItem><button type="button" className="menu-item" onClick={() => setWriting(true)}>Edit the ad</button></MenuItem>
                  {!open.ad_url && <MenuItem><button type="button" className="menu-item" onClick={() => setLinking(true)}>Add the ad's link</button></MenuItem>}
                  <MenuItem><button type="button" className="menu-item text-danger" onClick={() => set(open, { status: 'withdrawn', ended_on: today }, `Taken down · ${item.title}`)}>Take it down</button></MenuItem>
                </MenuItems>
              </Menu>
            </div>
          )}
        </div>
      )}
      {ended.length > 0 && (
        <ul className="mt-1 flex flex-col gap-0.5">
          {ended.slice(0, 3).map(l => <li key={l.id} className="text-meta tabular-nums text-fg-muted">{listingWords(l, today)} · asked {money(priceNow(l), l.currency)}</li>)}
        </ul>
      )}
      {writing && (
        <Suspense fallback={null}>
          <AdSheet r={r} listing={open} onClose={() => setWriting(false)} />
        </Suspense>
      )}
    </div>
  )
}

/** A new price from today: typed, or 5 % / 10 % off the price now (shares of your own price, never one from outside). */
function PriceForm({ listing, onSave, onCancel, busy }: { listing: ShopListing; onSave: (price: number) => void; onCancel: () => void; busy: boolean }) {
  const now = priceNow(listing)
  const [price, setPrice] = useState<number | null>(null)
  return (
    <div className="flex flex-col gap-2 rounded-row bg-surface-2 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <DecimalInput value={price} onValue={setPrice} placeholder={String(now)} aria-label="New price" className="input w-[6.5rem] tabular-nums" autoFocus />
        <span className="text-meta text-fg-muted">{listing.currency}</span>
        {priceCuts(now).map((p, i) => (
          <button key={p} type="button" onClick={() => setPrice(p)} aria-label={`${money(p, listing.currency)} (${i === 0 ? '5' : '10'} % off)`}
            className="chip min-h-[36px] px-3 tabular-nums hover:bg-surface-hover">{num(p)}</button>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={price == null || !isPrice(price) || !twoDecimals(price) || price === now} loading={busy} onClick={() => price != null && onSave(price)}>Save the price</Button>
      </div>
    </div>
  )
}

/** The ad's link once it is up (https, never fetched — shown with its address). */
function AdLinkForm({ listing, onDone }: { listing: ShopListing; onDone: () => void }) {
  const change = useChangeListing()
  const [url, setUrl] = useState('')
  const link = url.trim() ? normalizeAdUrl(url) : null
  const ok = link !== null
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="url" inputMode="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.finn.no/…" aria-label="The ad's link" className="input min-w-0 max-w-md flex-1" autoFocus />
      <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      <Button size="sm" variant="primary" disabled={!ok} loading={change.isPending}
        onClick={() => link && change.mutate({ listing, patch: { ad_url: link }, done: 'The ad\'s link saved', today: todayStr() }, { onSuccess: onDone })}>Save</Button>
    </div>
  )
}
