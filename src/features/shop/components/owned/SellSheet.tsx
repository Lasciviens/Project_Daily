import { useMemo, useState } from 'react'
import { ModalShell } from '../../../../shared/modals/ModalShell'
import { Button, Truncate } from '../../../../shared/ui'
import { DateInput } from '../../../../shared/components/DateInput'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { DecimalInput } from '../../../recipes/components/foodLogKit'
import { useRecordSale } from '../../hooks/useShopMoney'
import { useHandoverChecklists, useListings } from '../../hooks/useShopResale'
import { categoryNamesOf, checklistFor } from '../../resaleTexts'
import { HANDED_OVER, openListingOf } from '../../sellingModel'
import { priceNow } from '../../listingNudge'
import { HandoverChecklist } from '../record/HandoverChecklist'
import { boughtOn, complete, costOf, DISPOSAL_LABEL, isMine, PAID_BACK, splitSale, type MoneyCtx } from '../../ownModel'
import { categoryPath, defaultCurrencyFor, listOf } from '../../shopModel'
import { MoneyEditor } from '../shopEditors'
import { money as moneyText } from '../shopFormat'
import { ChoiceChips, StoreNameField } from '../shopPickers'
import { PaidText } from './PaidText'
import { SaleResult } from './SaleResult'
import type { ShopCategory, ShopCurrency, ShopDisposal, ShopItem } from '../../types'
import type { SaleDefaults } from '../../receiptRead'

const HOW = (['sold', 'traded_in', 'given', 'returned', 'broken', 'lost', 'other'] as ShopDisposal[]).map(h => ({ value: h, label: DISPOSAL_LABEL[h] }))

const LEFT_TO = ['marketplace', 'refurbisher', 'shop'] as const

/** Who or where it went: a person typed for a gift, else a marketplace, refurbisher or store from your Stores (`StoreNameField`). */
export function LeftToField({ how, value, onChange }: { how: ShopDisposal; value: string; onChange: (v: string) => void }) {
  const label = how === 'given' ? 'Given to' : how === 'traded_in' ? 'Traded in at' : how === 'sold' ? 'Sold to' : 'To'
  return (
    <div>
      <span className="field-label">{label} <span className="font-normal text-fg-muted">(optional)</span></span>
      {how === 'given'
        ? <input value={value} onChange={e => onChange(e.target.value)} placeholder="A friend…" aria-label={label} className="input" />
        : <StoreNameField label={label} value={value} onChange={onChange} kinds={LEFT_TO} placeholder="Pick where" />}
    </div>
  )
}

/** What a saved sale says about itself: for a read receipt's Undo all (it only takes back a sale that still looks like this) and to start Sell again with the same values. */
export interface SoldDone { id: string; to: string | null; how: ShopDisposal; on: string; currency: ShopCurrency; amount: number | null; soldTo: string | null }

/** Where a sale's money may go: another thing to buy, or one of yours (never an accessory). */
const isMoneyTarget = (c: ShopItem, sellingId: string): boolean => listOf(c) === 'wishlist' && c.id !== sellingId && !c.accessory_of && (c.status === 'wishlist' || (c.status === 'bought' && isMine(c)))

/**
 * Sell or give away one of your things — with the accessories you tick (the
 * money is split by what each cost), the rest staying yours or moving to
 * another thing — and where the money goes. One transaction, with Undo.
 * Its open listing (if any) offers its asking price and is closed by the
 * sale (the database); a thing handed over then shows its category's
 * hand-over checklist to tick through (step C).
 */
export function SellSheet({ item, items, categories, ctx, sale: start, onSold, onClose }: {
  item: ShopItem; items: ShopItem[]; categories: ShopCategory[]; ctx: MoneyCtx
  /** What a read receipt gives (Read a receipt): the amount, currency and day to start from. Only a day inside the thing's own life is taken. */
  sale?: SaleDefaults
  onSold?: (done: SoldDone) => void
  onClose: () => void
}) {
  const sale = useRecordSale()
  const today = todayStr()
  const from = boughtOn(item) ?? undefined
  const accessories = useMemo(() => items.filter(a => a.accessory_of === item.id && isMine(a)), [items, item.id])
  const [how, setHow] = useState<ShopDisposal>(start?.how ?? 'sold')
  const [on, setOn] = useState(() => (start?.day && start.day <= today && (!from || start.day >= from) ? start.day : today))
  const [to, setTo] = useState(start?.to ?? '')
  const [got, setGot] = useState<number | null>(start?.amount ?? null)
  const [currency, setCurrency] = useState<ShopCurrency>(start?.amount !== undefined && start.currency ? start.currency : item.region === 'TR' ? 'TRY' : defaultCurrencyFor(null))
  // Your own "Could sell for", one tap away (it fills nothing by itself: never a made-up sale price).
  const estimate = item.value_now != null ? { amount: item.value_now, currency: (item.value_currency ?? 'NOK') as ShopCurrency } : null
  const { data: listings = [] } = useListings()
  const { data: checklists = [] } = useHandoverChecklists()
  const listing = openListingOf(listings, item.id)
  const asking = listing ? { amount: priceNow(listing), currency: listing.currency } : null
  const [handover, setHandover] = useState(false)
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(accessories.map(a => a.id)))
  const [moveTo, setMoveTo] = useState<Record<string, string>>({})
  // A receipt's money target is taken only when it is one of this sheet's own choices (a thing to buy, or one of yours): never an id from anywhere else.
  const [target, setTarget] = useState(() => (start?.moneyTo && items.some(c => c.id === start.moneyTo && isMoneyTarget(c, item.id)) ? start.moneyTo : ''))
  const [targetAmount, setTargetAmount] = useState<number | null>(null)
  const money = PAID_BACK.includes(how) || how === 'other'
  const sold = [item, ...accessories.filter(a => ticked.has(a.id))]
  const kept = accessories.filter(a => !ticked.has(a.id))
  const cat = categoryPath(item.category_id, categories).topId
  // Where the money can go: things to buy first (same category first), then general wishes and recent things.
  const targets = useMemo(() => items
    .filter(c => isMoneyTarget(c, item.id))
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
    }, {
      // Handed over with a checklist for its category: tick through it here before closing.
      onSuccess: () => {
        onSold?.({ id: item.id, to: money && target ? target : null, how, on, currency, amount: money ? got : null, soldTo: to.trim() || null })
        return (HANDED_OVER.includes(how) && checklistFor(checklists, categoryNamesOf(item.category_id, categories)) ? setHandover(true) : onClose()) },
    })
  }

  if (handover) {
    return (
      <ModalShell onClose={onClose} title={`${DISPOSAL_LABEL[how]} · ${item.title}`} size="md"
        footer={<div className="flex"><Button variant="primary" className="ml-auto" onClick={onClose}>Done</Button></div>}>
        <HandoverChecklist item={item} categories={categories} />
      </ModalShell>
    )
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
          <ChoiceChips label="How it leaves" value={how} options={HOW} onChange={setHow} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <span className="field-label">On</span>
            <DateInput value={on} onChange={setOn} min={from} max={today} aria-label="On" className="input w-[10rem] tabular-nums" />
          </div>
          <LeftToField how={how} value={to} onChange={setTo} />
        </div>
        {money && (
          <div>
            <span className="field-label">{how === 'returned' ? 'Refunded' : 'Got'}</span>
            <MoneyEditor label="Got" amount={got} currency={currency} onAmount={setGot} onCurrency={setCurrency} />
            {asking && how === 'sold' && (got !== asking.amount || currency !== asking.currency) && (
              <button type="button" onClick={() => { setGot(asking.amount); setCurrency(asking.currency) }}
                className="chip mt-2 mr-1.5 min-h-[36px] gap-1 px-3 tabular-nums hover:bg-surface-hover">
                Use the asking price {moneyText(asking.amount, asking.currency)}
              </button>
            )}
            {estimate && how !== 'returned' && (got !== estimate.amount || currency !== estimate.currency) && (
              <button type="button" onClick={() => { setGot(estimate.amount); setCurrency(estimate.currency) }}
                className="chip mt-2 min-h-[36px] gap-1 px-3 tabular-nums hover:bg-surface-hover">
                Use your estimate {moneyText(estimate.amount, estimate.currency)}
              </button>
            )}
            {got == null && <p className="mt-1 text-meta text-fg-muted">Without an amount the result stays Unknown — you can add it later.</p>}
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
            {shares && sold.length > 1 && <p className="mt-1 text-meta text-fg-muted">The money is split by what each cost: {item.title} gets {shares.get(item.id)} {currency}.</p>}
          </div>
        )}
        {money && targets.length > 0 && (
          <div>
            <label className="field-label" htmlFor="sell-target">Money goes to <span className="font-normal text-fg-muted">(optional)</span></label>
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
