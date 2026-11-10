import { useId, useState } from 'react'
import { Check, Search } from 'lucide-react'
import { ModalShell } from '../../../../shared/modals'
import { Button, MetaLine, Skeleton, Truncate } from '../../../../shared/ui'
import { useDebouncedValue } from '../../../../shared/hooks/useDebouncedValue'
import { formatMoney } from '../../../settings/subscriptionRules'
import { useUpdateShopItem } from '../../hooks/useShop'
import { SEARCH_MIN_CHARS, useGrocerySearch, useScanLookup } from '../../hooks/useGrocery'
import { chainName, matchPatch, unmatchPatch, type GroceryHit, type GroceryPrice } from '../../groceryModel'
import { ItemThumb } from '../shopKit'
import type { ShopItem, UpdateShopItemInput } from '../../types'

interface Props {
  item: ShopItem | null
  open: boolean
  /** The row's current product, when it has one (its name). */
  current?: GroceryPrice
  onClose: () => void
}

/**
 * "Find a price": pick the product a quick-list row is (Kassalapp's search),
 * so it is priced at every chain. Saves the EAN — and the picture when the
 * row has none, or had only the old product's (`matchPatch`; the old product
 * is looked up when the search doesn't show it) — quietly; the row's picture
 * and price chip are the confirmation. Remove match takes the old product's
 * picture with it (`unmatchPatch`).
 */
export function FindPriceSheet({ item, open, current, onClose }: Props) {
  return (
    <ModalShell open={open && item != null} onClose={onClose} size="sm"
      title={item?.ean ? 'Change product' : 'Find a price'} subtitle={item?.title}>
      {item && <FindPriceBody key={item.id} item={item} current={current} onDone={onClose} />}
    </ModalShell>
  )
}

function FindPriceBody({ item, current, onDone }: { item: ShopItem; current?: GroceryPrice; onDone: () => void }) {
  const id = useId()
  const update = useUpdateShopItem()
  const [query, setQuery] = useState(item.title)
  const q = useDebouncedValue(query.trim(), 350)
  const search = useGrocerySearch(q)
  const lookUp = useScanLookup()
  const [saving, setSaving] = useState(false)
  const hits = search.data ?? []

  /**
   * The row's product until now, for its picture: a picture that is exactly
   * that product's came with the old match, so it goes with it. From the
   * search when it shows it, else Kassalapp's EAN lookup (cached an hour) —
   * asked only when the row has a product and a picture to compare; a failed
   * lookup keeps the picture (it can't tell).
   */
  async function previous(): Promise<GroceryHit | null> {
    if (!item.ean || !item.image_url) return null
    const shown = hits.find(h => h.ean === item.ean)
    if (shown) return shown
    try { return await lookUp(item.ean) } catch { return null }
  }
  async function save(patchFor: (was: GroceryHit | null) => UpdateShopItemInput) {
    if (saving) return
    setSaving(true)
    const was = await previous()
    update.mutate({ id: item.id, patch: patchFor(was), quiet: true })
    onDone()
  }
  const pick = (hit: GroceryHit) => void save(was => matchPatch(item, hit, was))
  const unmatch = () => void save(was => unmatchPatch(item, was))

  const results = q.length < SEARCH_MIN_CHARS ? <p className="text-body text-fg-muted">Type at least three letters.</p>
    : search.isError ? (
      <div className="flex flex-col items-start gap-2">
        <p className="text-body text-danger">{search.error.message || 'The search failed.'}</p>
        <Button size="sm" onClick={() => void search.refetch()}>Try again</Button>
      </div>
    )
    : search.isPending ? (
      <div className="flex flex-col gap-2" aria-busy>{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} rounded="rounded-row" className="h-14 w-full" />)}</div>
    )
    : hits.length === 0 ? <p className="text-body text-fg-muted">No products found for “{q}”. Try a shorter or different name.</p>
    : (
      <ul className="-mx-2 flex flex-col">
        {hits.map(hit => {
          const now = hit.ean === item.ean
          return (
            <li key={hit.ean}>
              <button type="button" onClick={() => pick(hit)} aria-current={now || undefined} disabled={saving}
                className="row row-interactive w-full gap-3 px-2 py-1.5 text-left aria-[current]:bg-accent-50 disabled:opacity-60">
                <ItemThumb src={hit.image} size="sm" />
                <span className="min-w-0 flex-1">
                  <Truncate as="span" lines={2} className="block text-body font-medium leading-snug text-fg">{hit.name}</Truncate>
                  <MetaLine as="span" className="block text-meta text-fg-muted tabular-nums" items={[
                    hit.brand,
                    hit.price != null && `${formatMoney(hit.price, 'NOK')}${hit.store ? ` at ${chainName({ code: hit.store, name: hit.store })}` : ''}`,
                  ]} />
                </span>
                {now && <Check aria-label="The product now" className="h-4 w-4 shrink-0 text-accent-600" />}
              </button>
            </li>
          )
        })}
      </ul>
    )

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label htmlFor={`${id}-q`} className="sr-only">Search products</label>
        <div className="relative max-w-md">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
          <input id={`${id}-q`} type="search" value={query} onChange={e => setQuery(e.target.value)} className="input pl-9" enterKeyHint="search" />
        </div>
        <p className="mt-1.5 text-meta text-fg-muted">Pick the product you buy — its price is then compared across the chains.</p>
      </div>
      {item.ean && (
        <div className="flex items-center gap-2 rounded-row border border-line bg-surface-2 py-1 pl-3 pr-1">
          <Truncate as="span" className="min-w-0 flex-1 text-meta text-fg-2">{`Now: ${current?.name && current.name !== item.ean ? current.name : `EAN ${item.ean}`}`}</Truncate>
          <Button variant="ghost" size="sm" onClick={unmatch} loading={saving}>Remove match</Button>
        </div>
      )}
      {results}
    </div>
  )
}
