import { useMemo, useState, type ReactNode } from 'react'
import { ArrowRightLeft, Plus, X } from 'lucide-react'
import { Button, Card, CardHeader, Truncate, cx } from '../../../../shared/ui'
import { useEntityModal } from '../../../../shared/modals'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { DecimalInput } from '../../../recipes/components/foodLogKit'
import { useCreateShopLink, useDeleteShopLink } from '../../hooks/useShopMoney'
import { cashNeeded, chainsOf, finalCostOf, wouldCycle, type Chain } from '../../chainModel'
import { complete, DISPOSAL_LABEL, isPossession, type MoneyCtx } from '../../ownModel'
import { listOf } from '../../shopModel'
import { AmountText } from '../shopKit'
import { money } from '../shopFormat'
import { finalCostWords } from '../shopFormat'
import type { ShopItem, ShopItemLink } from '../../types'

/**
 * "Paid with money from" and "Money goes to": the links that make a money
 * chain. A link from a thing still yours, or to a wish, is a plan — for a
 * wish it shows what the sale would leave to pay.
 */
export function RecordMoney({ item, items, links, ctx, chain }: { item: ShopItem; items: ShopItem[]; links: ShopItemLink[]; ctx: MoneyCtx; chain: Chain | null }) {
  const modal = useEntityModal()
  const del = useDeleteShopLink()
  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items])
  const incoming = links.filter(l => l.to_id === item.id)
  const outgoing = links.filter(l => l.from_id === item.id)
  const owned = isPossession(item)
  const isWish = item.status === 'wishlist'
  const canGive = owned && !item.accessory_of
  const projected = useMemo(() => (isWish && incoming.length ? chainsOf(items, links, ctx, { project: true }).find(c => c.nodes.some(n => n.id === item.id)) ?? null : null), [isWish, incoming.length, items, links, ctx, item.id])
  const need = projected ? cashNeeded(projected, item.id) : null
  const final = chain ? finalCostOf(chain, item.id) : null
  if (item.accessory_of || (!owned && !isWish) || (item.kind === 'general' && item.status !== 'wishlist')) return null

  const row = (l: ShopItemLink, other: ShopItem | undefined, dir: 'from' | 'to') => (
    <li key={l.id} className="flex items-center gap-1">
      <button type="button" onClick={() => other && modal.open({ kind: 'shop-item', id: other.id })} className="flex min-h-[44px] min-w-0 flex-1 flex-col justify-center rounded-row px-2 text-left hover:bg-surface-hover">
        <Truncate as="span" className="text-body text-fg-2">{other?.title ?? 'A deleted item'}</Truncate>
        <span className="text-meta text-fg-muted">{other ? stateLine(other, dir) : ''}{l.amount != null ? ` · ${money(l.amount, other?.sale_currency ?? other?.value_currency ?? 'NOK')} of it` : ''}</span>
      </button>
      <button type="button" onClick={() => del.mutate(l.id)} aria-label="Remove this link" title="Remove this link" className="icon-btn shrink-0 text-fg-faint hover:!text-danger">
        <X aria-hidden className="h-4 w-4" />
      </button>
    </li>
  )

  return (
    <Card>
      <CardHeader title="Money" variant="label" className="mb-1"
        action={owned && <Button size="sm" variant="ghost" icon={<ArrowRightLeft />} onClick={() => modal.open({ kind: 'shop-chain', id: item.id })}>{chain && chain.nodes.length > 1 ? 'Open the chain' : 'Try other prices'}</Button>} />
      {final && (
        <p className="mb-2 text-body text-fg-2">
          Final cost <AmountText amount={final.total} className="font-semibold text-fg" />
          {complete(final.own) && complete(final.carried) && <span className="text-fg-muted"> ({finalCostWords(final.own.nok, final.carried.nok)})</span>}
        </p>
      )}
      {need && (
        <p className="mb-2 text-body text-fg-2">
          After selling, it needs <AmountText amount={need.needed} className="font-semibold text-fg" /> more
          <span className="text-fg-muted"> (<AmountText amount={need.fromSales} /> from the sale{incoming.length > 1 ? 's' : ''} at "Could sell for")</span>
        </p>
      )}
      <Section title={isWish ? 'Will be paid with money from' : 'Paid with money from'} empty={incoming.length === 0}>
        <ul className="-mx-2 flex flex-col">{incoming.map(l => row(l, byId.get(l.from_id), 'from'))}</ul>
      </Section>
      <LinkPicker
        label={isWish ? 'Pay with money from…' : 'Paid with money from…'}
        candidates={items.filter(c => isPossession(c) && !c.accessory_of && c.id !== item.id && !incoming.some(l => l.from_id === c.id) && !wouldCycle(c.id, item.id, links))}
        onPick={(id, amount) => ({ from_id: id, to_id: item.id, amount })}
      />
      {canGive && <>
        <Section title="Money goes to" empty={outgoing.length === 0}>
          <ul className="-mx-2 flex flex-col">{outgoing.map(l => row(l, byId.get(l.to_id), 'to'))}</ul>
        </Section>
        <LinkPicker
          label="Money goes to…"
          candidates={items.filter(c => listOf(c) === 'wishlist' && !c.accessory_of && c.id !== item.id && (c.status === 'wishlist' || isPossession(c)) && !outgoing.some(l => l.to_id === c.id) && !wouldCycle(item.id, c.id, links))}
          onPick={(id, amount) => ({ from_id: item.id, to_id: id, amount })}
        />
      </>}
    </Card>
  )
}

function stateLine(i: ShopItem, dir: 'from' | 'to'): string {
  if (i.status === 'wishlist') return i.kind === 'general' ? 'A wish — any model' : 'To buy — a plan'
  if (i.disposal) return `${DISPOSAL_LABEL[i.disposal]}${i.disposed_on ? ` ${formatDate(i.disposed_on)}` : ''}${i.sale_price != null ? ` · got ${money(i.sale_price, i.sale_currency ?? 'NOK')}` : ''}`
  return dir === 'from' ? 'Still yours — a plan until it is sold' : 'Yours'
}

function Section({ title, empty, children }: { title: string; empty: boolean; children: ReactNode }) {
  if (empty) return null
  return <div className="mt-1"><p className="section-label mb-0.5">{title}</p>{children}</div>
}

/** One "+" that opens a picker: which thing, and optionally how much of the money. */
function LinkPicker({ label, candidates, onPick }: { label: string; candidates: ShopItem[]; onPick: (id: string, amount: number | null) => { from_id: string; to_id: string; amount: number | null } }) {
  const create = useCreateShopLink()
  const [open, setOpen] = useState(false)
  const [id, setId] = useState('')
  const [amount, setAmount] = useState<number | null>(null)
  if (!candidates.length) return null
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="chip mt-1 min-h-[44px] gap-1 text-fg-muted hover:bg-surface-hover hover:text-fg-2">
        <Plus aria-hidden className="h-3 w-3" /> {label}
      </button>
    )
  }
  const gone = candidates.filter(c => c.status === 'bought' && c.disposal)
  const rest = candidates.filter(c => !gone.includes(c))
  return (
    <div className={cx('mt-2 flex flex-col gap-2 rounded-row bg-surface-2 p-2')}>
      <select value={id} onChange={e => setId(e.target.value)} aria-label={label} className="select">
        <option value="">Pick one…</option>
        {gone.length > 0 && <optgroup label="Sold or gone">{gone.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</optgroup>}
        {rest.length > 0 && <optgroup label={gone.length ? 'Others' : 'Things and wishes'}>{rest.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</optgroup>}
      </select>
      <div className="flex flex-wrap items-center gap-2">
        <DecimalInput value={amount} onValue={setAmount} placeholder="All of it" aria-label="How much of the money (optional)" className="input w-[9rem] tabular-nums" />
        <span className="text-meta text-fg-muted">in the sale's currency — or leave it for all</span>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="primary" disabled={!id} loading={create.isPending}
          onClick={() => create.mutate(onPick(id, amount), { onSuccess: () => { setOpen(false); setId(''); setAmount(null) } })}>Link</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  )
}
