import { useMemo, useState } from 'react'
import { ModalShell } from '../../../../shared/modals/ModalShell'
import { Button, Truncate, cx } from '../../../../shared/ui'
import { DateInput } from '../../../../shared/components/DateInput'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { DecimalInput } from '../../../recipes/components/foodLogKit'
import { useRecordSale } from '../../hooks/useShopMoney'
import { boughtOn, complete, costOf, DISPOSAL_LABEL, isMine, PAID_BACK, splitSale, type MoneyCtx } from '../../ownModel'
import { categoryPath, defaultCurrencyFor, listOf } from '../../shopModel'
import { MoneyEditor } from '../record/factKit'
import { PaidText } from './PaidText'
import { SaleResult } from './SaleResult'
import type { ShopCategory, ShopCurrency, ShopDisposal, ShopItem } from '../../types'

const HOW: ShopDisposal[] = ['sold', 'traded_in', 'given', 'returned', 'broken', 'lost', 'other']

/**
 * Sell or give away one of your things — with the accessories you tick (the
 * money is split by what each cost), the rest staying yours or moving to
 * another thing — and where the money goes. One transaction, with Undo.
 */
export function SellSheet({ item, items, categories, ctx, onClose }: { item: ShopItem; items: ShopItem[]; categories: ShopCategory[]; ctx: MoneyCtx; onClose: () => void }) {
  const sale = useRecordSale()
  const today = todayStr()
  const from = boughtOn(item) ?? undefined
  const accessories = useMemo(() => items.filter(a => a.accessory_of === item.id && isMine(a)), [items, item.id])
  const [how, setHow] = useState<ShopDisposal>('sold')
  const [on, setOn] = useState(today)
  const [to, setTo] = useState('')
  const [got, setGot] = useState<number | null>(null)
  const [currency, setCurrency] = useState<ShopCurrency>(item.region === 'TR' ? 'TRY' : defaultCurrencyFor(null))
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(accessories.map(a => a.id)))
  const [moveTo, setMoveTo] = useState<Record<string, string>>({})
  const [target, setTarget] = useState('')
  const [targetAmount, setTargetAmount] = useState<number | null>(null)
  const money = PAID_BACK.includes(how) || how === 'other'
  const sold = [item, ...accessories.filter(a => ticked.has(a.id))]
  const kept = accessories.filter(a => !ticked.has(a.id))
  const cat = categoryPath(item.category_id, categories).topId
  // Where the money can go: things to buy first (same category first), then general wishes and recent things.
  const targets = useMemo(() => items
    .filter(c => listOf(c) === 'wishlist' && c.id !== item.id && !c.accessory_of && (c.status === 'wishlist' || (c.status === 'bought' && isMine(c))))
    .sort((a, b) => Number(b.status === 'wishlist') - Number(a.status === 'wishlist')
      || Number(categoryPath(b.category_id, categories).topId === cat) - Number(categoryPath(a.category_id, categories).topId === cat)
      || a.title.localeCompare(b.title)), [items, item.id, categories, cat])
  const moveTargets = items.filter(c => c.id !== item.id && !c.accessory_of && c.kind !== 'general' && listOf(c) === 'wishlist' && (isMine(c) || c.status === 'wishlist'))
  const weights = sold.map(r => { const c = costOf(r, ctx); return { id: r.id, weight: complete(c) ? c.nok : null } })
  const shares = money && got != null ? splitSale(got, weights) : null

  function submit() {
    sale.mutate({
      label: `${DISPOSAL_LABEL[how]} · ${item.title}`,
      input: {
        rows: sold.map(r => ({ id: r.id, sale_price: money && got != null ? shares?.get(r.id) ?? 0 : null })),
        disposal: how, on, currency, soldTo: to.trim() || null,
        keep: kept.map(a => ({ id: a.id, move_to: moveTo[a.id] || null })),
        to: money && target ? target : null,
        toAmount: money && target ? targetAmount : null,
      },
    }, { onSuccess: onClose })
  }

  return (
    <ModalShell onClose={onClose} title={`Sell or give away · ${item.title}`} size="md" dismissible={!sale.isPending}
      footer={
        <div className="flex items-center gap-2">
          <Button onClick={onClose} className="ml-auto" disabled={sale.isPending}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={sale.isPending} disabled={!on}>{how === 'sold' ? 'Sell' : DISPOSAL_LABEL[how]}</Button>
        </div>
      }>
      <div className="flex flex-col gap-4">
        <div>
          <span className="field-label">How</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="How it leaves">
            {HOW.map(h => (
              <button key={h} type="button" role="radio" aria-checked={how === h} onClick={() => setHow(h)}
                className={cx('chip min-h-[44px] px-3', how === h ? 'border-accent-500 bg-accent-50 font-semibold text-accent-700' : 'hover:bg-surface-hover')}>
                {DISPOSAL_LABEL[h]}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <span className="field-label">On</span>
            <DateInput value={on} onChange={setOn} min={from} max={today} aria-label="On" className="input w-[10rem] tabular-nums" />
          </div>
          <div>
            <label className="field-label" htmlFor="sell-to">{how === 'given' ? 'Given to' : how === 'traded_in' ? 'Traded in at' : 'To'} <span className="font-normal text-fg-faint">(optional)</span></label>
            <input id="sell-to" value={to} onChange={e => setTo(e.target.value)} placeholder={how === 'traded_in' ? 'Apple, POWER…' : 'FINN, a friend…'} className="input" />
          </div>
        </div>
        {money && (
          <div>
            <span className="field-label">{how === 'returned' ? 'Refunded' : 'Got'}</span>
            <MoneyEditor label="Got" amount={got} currency={currency} onAmount={setGot} onCurrency={setCurrency} />
            {got == null && <p className="mt-1 text-meta text-fg-faint">Without an amount the result stays Unknown — you can add it later.</p>}
          </div>
        )}
        {accessories.length > 0 && (
          <div>
            <span className="field-label">{money ? 'Sold with it' : 'Going with it'}</span>
            <ul className="flex flex-col divide-y divide-line rounded-row border border-line">
              {accessories.map(a => (
                <li key={a.id} className="flex flex-wrap items-center gap-x-2 px-2 py-1">
                  <label className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2">
                    <input type="checkbox" checked={ticked.has(a.id)} onChange={e => setTicked(s => { const n = new Set(s); if (e.target.checked) n.add(a.id); else n.delete(a.id); return n })}
                      className="h-[18px] w-[18px] shrink-0 accent-accent-500" />
                    <Truncate as="span" className="min-w-0 text-body text-fg-2">{a.title}</Truncate>
                  </label>
                  <span className="shrink-0 text-meta tabular-nums text-fg-muted">
                    {shares?.has(a.id) ? <>gets {shares.get(a.id)} {currency}</> : <PaidText item={a} />}
                  </span>
                  {!ticked.has(a.id) && (
                    <select value={moveTo[a.id] ?? ''} onChange={e => setMoveTo(m => ({ ...m, [a.id]: e.target.value }))} aria-label={`Where ${a.title} goes`} className="select mb-1 w-full text-meta">
                      <option value="">Stays with your things, on its own</option>
                      {moveTargets.map(t => <option key={t.id} value={t.id}>Move it to {t.title}{t.status === 'wishlist' ? ' (to buy)' : ''}</option>)}
                    </select>
                  )}
                </li>
              ))}
            </ul>
            {shares && sold.length > 1 && <p className="mt-1 text-meta text-fg-faint">The money is split by what each cost: {item.title} gets {shares.get(item.id)} {currency}.</p>}
          </div>
        )}
        {money && targets.length > 0 && (
          <div>
            <label className="field-label" htmlFor="sell-target">Money goes to <span className="font-normal text-fg-faint">(optional)</span></label>
            <select id="sell-target" value={target} onChange={e => setTarget(e.target.value)} className="select">
              <option value="">Nowhere in particular</option>
              {targets.map(t => <option key={t.id} value={t.id}>{t.title}{t.status === 'wishlist' ? (t.kind === 'general' ? ' (a wish)' : ' (to buy)') : ''}</option>)}
            </select>
            {target && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <DecimalInput value={targetAmount} onValue={setTargetAmount} placeholder="All of it" aria-label="How much of it" className="input w-[9rem] tabular-nums" />
                <span className="text-meta text-fg-muted">{currency} of it — or leave it for all</span>
              </div>
            )}
          </div>
        )}
        <SaleResult item={item} sold={sold} ctx={ctx} got={money ? got : 0} currency={currency} on={on} />
      </div>
    </ModalShell>
  )
}
