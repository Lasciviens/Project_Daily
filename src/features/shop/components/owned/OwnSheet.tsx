import { useState } from 'react'
import { ModalShell } from '../../../../shared/modals/ModalShell'
import { Button, SegmentedControl, cx } from '../../../../shared/ui'
import { DateInput } from '../../../../shared/components/DateInput'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { middayIso } from '../../../media/watchedWhen'
import { useCreateShopItem } from '../../hooks/useShop'
import { useCreateShopLink, useFillRatesNow } from '../../hooks/useShopMoney'
import { DISPOSAL_LABEL, isPossession } from '../../ownModel'
import { listOf } from '../../shopModel'
import { MoneyEditor, Toggle } from '../record/factKit'
import type { ShopCategory, ShopCurrency, ShopDisposal, ShopItem } from '../../types'

const HOW: ShopDisposal[] = ['sold', 'traded_in', 'given', 'broken', 'lost', 'other']

/**
 * Add something you own — or had — from before the app: what it cost, when
 * (roughly is fine: "≈"), where, and for something you had, how it left and
 * where its money went. Chains start from here: "paid with money from" links
 * the older thing it replaced.
 */
export function OwnSheet({ had: hadInitially, items, categories, onClose }: { had: boolean; items: ShopItem[]; categories: ShopCategory[]; onClose: () => void }) {
  const create = useCreateShopItem()
  const link = useCreateShopLink()
  const fill = useFillRatesNow()
  const today = todayStr()
  const [had, setHad] = useState(hadInitially)
  const [title, setTitle] = useState('')
  const [topId, setTopId] = useState('')
  const [subId, setSubId] = useState('')
  const [price, setPrice] = useState<number | null>(null)
  const [currency, setCurrency] = useState<ShopCurrency>('NOK')
  const [day, setDay] = useState('')
  const [approx, setApprox] = useState(true)
  const [store, setStore] = useState('')
  const [gift, setGift] = useState(false)
  const [used, setUsed] = useState(false)
  const [how, setHow] = useState<ShopDisposal>('sold')
  const [left, setLeft] = useState('')
  const [got, setGot] = useState<number | null>(null)
  const [gotCurrency, setGotCurrency] = useState<ShopCurrency>('NOK')
  const [soldTo, setSoldTo] = useState('')
  const [paidFrom, setPaidFrom] = useState('')
  const [moneyTo, setMoneyTo] = useState('')
  const tops = categories.filter(c => !c.parent_id)
  const subs = topId ? categories.filter(c => c.parent_id === topId) : []
  const money = how === 'sold' || how === 'traded_in' || how === 'other'
  const sources = items.filter(i => isPossession(i) && !i.accessory_of && i.disposal)
  const targets = items.filter(i => listOf(i) === 'wishlist' && !i.accessory_of && i.kind !== 'general' && (i.status === 'wishlist' || isPossession(i)))
  const valid = title.trim() && day && (!had || (left && left >= day))

  async function save() {
    if (!valid) return
    let row: ShopItem
    try {
      row = await create.mutateAsync({ input: {
        title: title.trim(), list: 'wishlist', status: 'bought', category_id: subId || topId || null,
        price: gift && price == null ? 0 : price, currency, platform: store.trim() || null,
        bought_at: middayIso(day), approx_dates: approx, got_as_gift: gift, used,
        ...(had ? {
          disposal: how, disposed_on: left, sold_to: soldTo.trim() || null,
          ...(money && got != null ? { sale_price: got, sale_currency: gotCurrency } : {}),
        } : {}),
      } })
    } catch { return }
    try {
      if (paidFrom) await link.mutateAsync({ from_id: paidFrom, to_id: row.id })
      if (had && moneyTo) await link.mutateAsync({ from_id: row.id, to_id: moneyTo })
    } catch { /* the link's own hook toasted it; the thing itself is saved */ }
    if (currency !== 'NOK' || (had && gotCurrency !== 'NOK')) fill()
    onClose()
  }

  return (
    <ModalShell onClose={onClose} title={had ? 'Add something I had' : 'Add something I own'} size="md" dismissible={!create.isPending}
      footer={
        <div className="flex items-center gap-2">
          <Button onClick={onClose} className="ml-auto" disabled={create.isPending}>Cancel</Button>
          <Button variant="primary" onClick={() => { void save() }} disabled={!valid} loading={create.isPending || link.isPending}>Add</Button>
        </div>
      }>
      <div className="flex flex-col gap-3">
        <SegmentedControl<'own' | 'had'> size="sm" value={had ? 'had' : 'own'} onChange={v => setHad(v === 'had')}
          options={[{ value: 'own', label: 'I still have it' }, { value: 'had', label: 'I had it' }]} />
        <div>
          <label htmlFor="own-title" className="field-label">What</label>
          <input id="own-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="PlayStation 4 Pro, iPhone 12…" autoFocus className="input" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select value={topId} onChange={e => { setTopId(e.target.value); setSubId('') }} aria-label="Category" className="select">
            <option value="">No category</option>
            {tops.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select value={subId} onChange={e => setSubId(e.target.value)} disabled={!topId} aria-label="Subcategory" className="select disabled:opacity-50">
            <option value="">{topId ? 'No subcategory' : 'Subcategory'}</option>
            {subs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <span className="field-label">Paid</span>
            <MoneyEditor label="Paid" amount={price} currency={currency} onAmount={setPrice} onCurrency={setCurrency} />
          </div>
          <div>
            <span className="field-label">Bought on</span>
            <DateInput value={day} onChange={setDay} max={today} aria-label="Bought on" className="input w-[10rem] tabular-nums" />
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4">
          <Toggle checked={approx} onChange={setApprox}>The day is a guess (≈)</Toggle>
          <Toggle checked={gift} onChange={setGift}>A gift to me</Toggle>
          <Toggle checked={used} onChange={setUsed}>Bought used</Toggle>
        </div>
        <div>
          <label htmlFor="own-store" className="field-label">Bought at <span className="font-normal text-fg-faint">(optional)</span></label>
          <input id="own-store" value={store} onChange={e => setStore(e.target.value)} className="input max-w-sm" />
        </div>
        {sources.length > 0 && (
          <div>
            <label htmlFor="own-from" className="field-label">Paid with money from <span className="font-normal text-fg-faint">(optional)</span></label>
            <select id="own-from" value={paidFrom} onChange={e => setPaidFrom(e.target.value)} className="select">
              <option value="">Nothing I sold</option>
              {sources.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </div>
        )}
        {had && (
          <div className={cx('flex flex-col gap-3 rounded-row border border-line bg-surface-2 p-3')}>
            <div>
              <span className="field-label">How it left</span>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="How it left">
                {HOW.map(h => (
                  <button key={h} type="button" role="radio" aria-checked={how === h} onClick={() => setHow(h)}
                    className={cx('chip min-h-[44px] px-3', how === h ? 'border-accent-500 bg-accent-50 font-semibold text-accent-700' : 'hover:bg-surface')}>
                    {DISPOSAL_LABEL[h]}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <span className="field-label">On</span>
                <DateInput value={left} onChange={setLeft} min={day || undefined} max={today} aria-label="Left on" className="input w-[10rem] tabular-nums" />
              </div>
              <div>
                <label htmlFor="own-to" className="field-label">To <span className="font-normal text-fg-faint">(optional)</span></label>
                <input id="own-to" value={soldTo} onChange={e => setSoldTo(e.target.value)} className="input" />
              </div>
            </div>
            {money && (
              <div>
                <span className="field-label">Got</span>
                <MoneyEditor label="Got" amount={got} currency={gotCurrency} onAmount={setGot} onCurrency={setGotCurrency} />
              </div>
            )}
            {money && targets.length > 0 && (
              <div>
                <label htmlFor="own-moneyto" className="field-label">Money went to <span className="font-normal text-fg-faint">(optional)</span></label>
                <select id="own-moneyto" value={moneyTo} onChange={e => setMoneyTo(e.target.value)} className="select">
                  <option value="">Nothing in particular</option>
                  {targets.map(t => <option key={t.id} value={t.id}>{t.title}{t.status === 'wishlist' ? ' (to buy)' : ''}</option>)}
                </select>
              </div>
            )}
            {left && day && left < day && <p className="text-meta text-danger">It can't leave before it was bought.</p>}
          </div>
        )}
      </div>
    </ModalShell>
  )
}
