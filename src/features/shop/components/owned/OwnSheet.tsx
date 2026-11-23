import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ModalShell } from '../../../../shared/modals/ModalShell'
import { Button, SegmentedControl } from '../../../../shared/ui'
import { DateInput } from '../../../../shared/components/DateInput'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { middayIso } from '../../../media/watchedWhen'
import { useCreateShopItem } from '../../hooks/useShop'
import { useQuietCheck } from '../../hooks/useShopPrices'
import { useCreateShopLink, useFillRatesNow } from '../../hooks/useShopMoney'
import { useResolveCategory } from '../../hooks/useCategorySuggestions'
import { DISPOSAL_LABEL, isPossession } from '../../ownModel'
import { listOf } from '../../shopModel'
import { factsToSave } from '../../factsKept'
import { ShopAutofill, type ShopDraft } from '../ShopItemForm'
import { MoneyEditor, Toggle } from '../record/factKit'
import { CategoryPicker } from '../CategoryPicker'
import { ChoiceChips, StoreNameField } from '../shopPickers'
import { LeftToField } from './SellSheet'
import { ReceiptPhoto } from '../purchase/ReceiptPhoto'
import { useShopStores } from '../../hooks/useShopStores'
import type { ReceiptFill } from '../../../ai/claude/featureRules'
import { receiptFacts } from '../../receiptFacts'
import { fieldsAfter, mergeFacts } from '../../autofillModel'
import type { ShopCategory, ShopCurrency, ShopDisposal, ShopItem } from '../../types'

/** The fields this sheet shares with the Wishlist's add (title, category, price, store, link, picture, facts): one draft, so the same autofill fills them. */
const EMPTY: ShopDraft = {
  title: '', list: 'wishlist', topId: '', newTop: '', subId: '', newSub: '', notes: '', price: null, currency: 'NOK',
  platform: '', url: '', priority: 'medium', region: '', plannedDate: '', status: 'bought', boughtDay: '', general: false,
  priceMin: null, priceMax: null, requirements: '', reason: '', image: null, facts: [],
}

const HOW = (['sold', 'traded_in', 'given', 'broken', 'lost', 'other'] as ShopDisposal[]).map(h => ({ value: h, label: DISPOSAL_LABEL[h] }))

/**
 * Add something you own — or had — from before the app: what it cost, when
 * (roughly is fine: "≈"), where, and for something you had, how it left and
 * where its money went. Chains start from here: "paid with money from" links
 * the older thing it replaced. It has the Wishlist add's tools too: the link
 * reader, barcode scan, facts with sources, picture and duplicate warning
 * (`ShopAutofill`), and the store picked from your Stores (`StoreNameField`).
 */
export function OwnSheet({ had: hadInitially, items, categories, receipt: start, onSaved, onClose }: {
  had: boolean; items: ShopItem[]; categories: ShopCategory[]
  /** One line of a read receipt (Read a receipt): it starts the sheet through the same path a receipt photo uses. */
  receipt?: ReceiptFill
  onSaved?: (item: ShopItem) => void
  onClose: () => void
}) {
  const id = useId()
  const create = useCreateShopItem()
  const check = useQuietCheck()
  const link = useCreateShopLink({ report: false })
  const fill = useFillRatesNow()
  const suggested = useResolveCategory()
  const { data: stores = [] } = useShopStores()
  const today = todayStr()
  const [had, setHad] = useState(hadInitially)
  const [draft, setDraft] = useState<ShopDraft>(EMPTY)
  const onChange = useCallback((patch: Partial<ShopDraft>) => setDraft(d => ({ ...d, ...patch })), [])
  // The autofill's answers land later: worked out from the draft as it is then.
  const update = useCallback((change: (d: ShopDraft) => Partial<ShopDraft>) => setDraft(d => {
    const patch = change(d)
    return Object.keys(patch).length ? { ...d, ...patch } : d
  }), [])
  const { title, topId, subId, price, currency } = draft
  const [day, setDay] = useState('')
  const [approx, setApprox] = useState(true)
  const [gift, setGift] = useState(false)
  const [used, setUsed] = useState(start?.condition === 'used')
  const [how, setHow] = useState<ShopDisposal>('sold')
  const [left, setLeft] = useState('')
  const [got, setGot] = useState<number | null>(null)
  const [gotCurrency, setGotCurrency] = useState<ShopCurrency>('NOK')
  const [soldTo, setSoldTo] = useState('')
  const [paidFrom, setPaidFrom] = useState('')
  const [moneyTo, setMoneyTo] = useState('')
  const money = how === 'sold' || how === 'traded_in' || how === 'other'
  const sources = items.filter(i => isPossession(i) && !i.accessory_of && i.disposal)
  const targets = items.filter(i => listOf(i) === 'wishlist' && !i.accessory_of && i.kind !== 'general' && (i.status === 'wishlist' || isPossession(i)))
  // A read receipt goes in as autofill facts ("Filled in for you · untick what's wrong"): a fact fills its field only when the
  // field is empty or still holds an earlier receipt value, never over what was typed. The day and the note follow the same rule.
  const [receipt, setReceipt] = useState<ReceiptFill | null>(null)
  const [withOthers, setWithOthers] = useState(false)
  const receiptDay = useRef('')
  const fromReceipt = useCallback((f: ReceiptFill) => {
    setReceipt(f)
    update(d => {
      const facts = mergeFacts(d.facts, 'receipt', receiptFacts(f, new Date().toISOString()))
      const note = f.note && !d.notes.includes(f.note) ? { notes: d.notes.trim() ? `${d.notes.trim()}\n${f.note}` : f.note } : {}
      return { facts, ...fieldsAfter(d, d.facts, facts), ...note }
    })
    if (f.day) {
      const was = receiptDay.current
      setDay(d => (!d || d === was ? f.day as string : d))
      setApprox(a => (was || !day ? false : a))
      receiptDay.current = f.day
    }
  }, [update, day])
  // A line of a read receipt starts the sheet once, through the same facts a photo of a receipt gives (never over what is typed).
  const started = useRef(false)
  useEffect(() => {
    if (!start || started.current) return
    started.current = true
    fromReceipt(start)
  }, [start, fromReceipt])
  const valid = title.trim() && day && (!had || (left && left >= day))

  async function save() {
    if (!valid) return
    let row: ShopItem
    try {
      // A suggested category picked here is made now, with the save.
      const categoryId = await suggested.resolve({ topId, subId }, categories)
      const kept = factsToSave(draft.facts, draft)
      row = await create.mutateAsync({ input: {
        title: title.trim(), list: 'wishlist', status: 'bought', category_id: categoryId,
        price: gift && price == null ? 0 : price, currency, platform: draft.platform.trim() || null,
        url: draft.url.trim() || null, image_url: draft.image, notes: draft.notes.trim() || null,
        ...(kept.ean ? { ean: kept.ean } : {}),
        ...(kept.facts ? { facts: kept.facts } : {}),
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
    // The receipt's other lines as accessories of this thing (the owner ticked it): same store, same day, their own prices.
    if (withOthers && receipt && receipt.currency && receipt.others.length) {
      try {
        for (const l of receipt.others) {
          await create.mutateAsync({ quiet: true, input: {
            title: l.name, price: l.price, currency: receipt.currency as ShopCurrency, platform: draft.platform.trim() || null, list: 'wishlist', category_id: row.category_id,
            accessory_of: row.id, status: 'bought', bought_at: middayIso(day), approx_dates: approx,
          } })
        }
      } catch { /* the hook toasted it; the thing itself is saved */ }
    }
    onSaved?.(row)
    if (row.url) check([row.id])
    if (currency !== 'NOK' || (had && gotCurrency !== 'NOK')) fill()
    onClose()
  }

  return (
    <ModalShell onClose={onClose} title={had ? 'Add something I had' : 'Add something I own'} size="md" dismissible={!create.isPending}
      footer={
        <div className="flex items-center gap-2">
          <Button onClick={onClose} className="ml-auto" disabled={create.isPending}>Cancel</Button>
          <Button variant="primary" onClick={() => { void save() }} disabled={!valid} loading={suggested.busy || create.isPending || link.isPending}>Add</Button>
        </div>
      }>
      <div className="flex flex-col gap-3">
        <SegmentedControl<'own' | 'had'> size="sm" value={had ? 'had' : 'own'} onChange={v => setHad(v === 'had')}
          options={[{ value: 'own', label: 'I still have it' }, { value: 'had', label: 'I had it' }]} />
        <div>
          <label htmlFor="own-title" className="field-label">What</label>
          <input id="own-title" value={title} onChange={e => onChange({ title: e.target.value })} placeholder="PlayStation 4 Pro, iPhone 12…" autoFocus className="input" />
        </div>
        <ShopAutofill draft={draft} onChange={onChange} update={update} categories={categories} />
        <ReceiptPhoto stores={stores} onFill={fromReceipt} />
        {receipt && receipt.others.length > 0 && receipt.currency && (
          <Toggle checked={withOthers} onChange={setWithOthers}>Add the other {receipt.others.length === 1 ? 'line' : `${receipt.others.length} lines`} as {receipt.others.length === 1 ? 'an accessory' : 'accessories'}</Toggle>
        )}
        <div>
          <span className="field-label">Category</span>
          <div className="grid grid-cols-2 gap-2">
            <CategoryPicker categories={categories} value={{ topId, subId }} onChange={p => onChange({ topId: p.topId, subId: p.subId })} />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <span className="field-label">Paid</span>
            <MoneyEditor label="Paid" amount={price} currency={currency} onAmount={v => onChange({ price: v })} onCurrency={c => onChange({ currency: c })} />
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
          <span className="field-label">Bought at <span className="font-normal text-fg-muted">(optional)</span></span>
          <StoreNameField label="Bought at" value={draft.platform} onChange={platform => onChange({ platform })} className="max-w-sm" />
        </div>
        <div>
          <label htmlFor={`${id}-notes`} className="field-label">Notes <span className="font-normal text-fg-muted">(optional)</span></label>
          <textarea id={`${id}-notes`} value={draft.notes} onChange={e => onChange({ notes: e.target.value })} rows={2} className="input resize-none" />
        </div>
        {sources.length > 0 && (
          <div>
            <label htmlFor="own-from" className="field-label">Paid with money from <span className="font-normal text-fg-muted">(optional)</span></label>
            <select id="own-from" value={paidFrom} onChange={e => setPaidFrom(e.target.value)} className="select">
              <option value="">Nothing I sold</option>
              {sources.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </div>
        )}
        {had && (
          <div className="flex flex-col gap-3 rounded-row border border-line bg-surface-2 p-3">
            <div>
              <span className="field-label">How it left</span>
              <ChoiceChips label="How it left" value={how} options={HOW} onChange={setHow} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <span className="field-label">On</span>
                <DateInput value={left} onChange={setLeft} min={day || undefined} max={today} aria-label="Left on" className="input w-[10rem] tabular-nums" />
              </div>
              <LeftToField how={how} value={soldTo} onChange={setSoldTo} />
            </div>
            {money && (
              <div>
                <span className="field-label">Got</span>
                <MoneyEditor label="Got" amount={got} currency={gotCurrency} onAmount={setGot} onCurrency={setGotCurrency} />
              </div>
            )}
            {money && targets.length > 0 && (
              <div>
                <label htmlFor="own-moneyto" className="field-label">Money went to <span className="font-normal text-fg-muted">(optional)</span></label>
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
