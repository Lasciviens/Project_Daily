import { Check, CircleHelp, Plus, X } from 'lucide-react'
import { Button, Card, CardHeader, TonePill, Truncate, cx } from '../../../../shared/ui'
import { useEntityModal } from '../../../../shared/modals'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { useBuyNow, useUpdateShopItem } from '../../hooks/useShop'
import { priceNow } from '../../shopModel'
import { bestMatch, cycleMeets, meetsOf, metCount, requirementsOf } from '../../wishModel'
import { money } from '../shopFormat'
import type { ShopItem, ShopPriceWatch } from '../../types'

/**
 * A general wish's models side by side: price now (the price watch when it
 * has one), ✓ / ✗ / ? per must-have (one tap cycles), the best match, and
 * Buy this model / Not chosen. A row per model reads the same on a phone.
 */
export function RecordModels({ wish, models, watches }: { wish: ShopItem; models: ShopItem[]; watches: ReadonlyMap<string, ShopPriceWatch> }) {
  const modal = useEntityModal()
  const update = useUpdateShopItem()
  const buy = useBuyNow(id => modal.open({ kind: 'shop-item', id }))
  const reqs = requirementsOf(wish)
  const price = (m: ShopItem) => priceNow(m, watches.get(m.id))
  const best = bestMatch(wish, models, price)
  const order = [...models].sort((a, b) => rank(a) - rank(b) || (price(a)?.amount ?? Infinity) - (price(b)?.amount ?? Infinity))
  const open = wish.status === 'wishlist'

  return (
    <Card>
      <CardHeader title={`Models · ${models.filter(m => m.status === 'wishlist').length} in the running`} variant="label" className="mb-2"
        action={open && <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => modal.open({ kind: 'shop-model', wishId: wish.id })}>Model</Button>} />
      {models.length === 0 ? (
        <p className="text-meta text-fg-muted">Add the models you are thinking of — with a Prisjakt link each one's price is checked every morning, and the must-haves become a comparison.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {order.map(m => {
            const p = price(m)
            const watched = watches.get(m.id)
            const counts = metCount(m, reqs)
            const out = m.status !== 'wishlist'
            return (
              <li key={m.id} className={cx('rounded-row border border-line p-2.5', out && m.status !== 'bought' && 'opacity-60', m === best && 'border-accent-300 bg-accent-50/40')}>
                <div className="flex flex-wrap items-start gap-2">
                  <button type="button" onClick={() => modal.open({ kind: 'shop-item', id: m.id })} className="min-h-[44px] min-w-0 flex-1 text-left">
                    <Truncate as="span" className="block text-ui font-semibold text-fg">{m.title}</Truncate>
                    <span className="block text-meta tabular-nums text-fg-muted">
                      {p ? money(p.amount, p.currency) : 'No price yet'}
                      {watched && watched.url === m.url && watched.low != null && <> · {watched.source === 'prisjakt' ? 'Prisjakt' : 'shop'} {formatDate(watched.last_ok_at ?? watched.checked_at)}</>}
                      {reqs.length > 0 && <> · {counts.met} of {reqs.length} must-haves</>}
                    </span>
                  </button>
                  {m === best && <TonePill tone="info" className="shrink-0">Best match</TonePill>}
                  {m.status === 'bought' && <TonePill tone="success" className="shrink-0">Bought</TonePill>}
                  {m.status === 'dropped' && <TonePill tone="neutral" className="shrink-0">Not chosen</TonePill>}
                </div>
                {reqs.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {reqs.map(r => {
                      const v = meetsOf(m, r)
                      return (
                        <button key={r} type="button" disabled={out}
                          onClick={() => update.mutate({ id: m.id, patch: { meets: cycleMeets(m.meets, r) }, quiet: true })}
                          title={`${r}: ${v === true ? 'yes' : v === false ? 'no' : 'not known'} — tap to change`}
                          data-tone={v === true ? 'success' : v === false ? 'danger' : 'neutral'}
                          className="tone-soft tone-text inline-flex min-h-[44px] max-w-full items-center gap-1 rounded-control px-2 text-meta font-medium disabled:opacity-70">
                          {v === true ? <Check aria-hidden className="h-3.5 w-3.5 shrink-0" /> : v === false ? <X aria-hidden className="h-3.5 w-3.5 shrink-0" /> : <CircleHelp aria-hidden className="h-3.5 w-3.5 shrink-0" />}
                          <Truncate as="span" className="min-w-0">{r}</Truncate>
                        </button>
                      )
                    })}
                  </div>
                )}
                {!out && open && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Button size="sm" variant="ghost" onClick={() => buy(m)} icon={<Check />}>Buy this model</Button>
                    <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: m.id, patch: { status: 'dropped' }, quiet: true })} className="text-fg-muted">Not chosen</Button>
                  </div>
                )}
                {m.status === 'dropped' && (
                  <Button size="sm" variant="ghost" className="mt-1" onClick={() => update.mutate({ id: m.id, patch: { status: 'wishlist' }, quiet: true })}>Back in the running</Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

const rank = (m: ShopItem) => (m.status === 'bought' ? 0 : m.status === 'wishlist' ? 1 : 2)
