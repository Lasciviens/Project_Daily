import { useCallback, useMemo, useRef, useState } from 'react'
import { ModalShell } from '../../../../shared/modals/ModalShell'
import { Button } from '../../../../shared/ui'
import { DateInput } from '../../../../shared/components/DateInput'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { middayIso } from '../../../media/watchedWhen'
import { useShopCategories } from '../../hooks/useShop'
import { useLawRules, useShopStores, useStoreRules } from '../../hooks/useShopStores'
import { useSavePurchase } from '../../hooks/usePurchase'
import { complaintYears } from '../../ownModel'
import { categoryPath } from '../../shopModel'
import { boughtDayOf, complaintYearsOf, dateSource, factsOf, storeOfItem } from '../../purchaseModel'
import { purchaseDeadlines } from '../../storeRules'
import { DateFact, DeadlineWords } from './purchaseKit'
import { ReceiptPhoto } from './ReceiptPhoto'
import { matchLine, RECEIPT_CURRENCIES, type ReceiptFill, type ReceiptRead } from '../../../ai/claude/featureRules'
import { ChoiceChip } from '../shopPickers'
import type { PurchasePatch } from '../../api/shopPurchaseApi'
import type { ShopCurrency, ShopItem, ShopStore } from '../../types'

type Channel = 'online' | 'in_store'
const OTHER = 'other'
const NOTE_MAX = 2000


/**
 * Just bought: where and how it was bought, Arrived, the return and complaint days with their reasons (the
 * store's rules and Norway's law, storeRules.purchaseDeadlines — each date explains itself, the earlier one when
 * unsure), an extra warranty and the receipt as a note. Until Arrived is tapped every count starts on the purchase
 * day. A date the owner sets is theirs, and the rules' date is still named beside it.
 */
export function JustBoughtSheet({ item, bought, onClose }: { item: ShopItem; bought: boolean; onClose: () => void }) {
  const today = todayStr()
  const { data: stores = [], isLoading: storesLoading } = useShopStores()
  const { data: rules = [] } = useStoreRules()
  const { data: law = [] } = useLawRules()
  const { data: categories = [] } = useShopCategories()
  const save = useSavePurchase()

  const pickable = useMemo(() => stores.filter(s => !s.hidden && s.kind !== 'price_site').sort((a, b) => a.name.localeCompare(b.name, 'en')), [stores])
  const first = useMemo(() => storeOfItem(item, stores), [item, stores])
  const [storePick, setStorePick] = useState<string | null>(null)
  const [otherName, setOtherName] = useState<string | null>(null)
  const storeId = storePick ?? (first?.id ?? (item.platform ? OTHER : ''))
  const store: ShopStore | null = storeId && storeId !== OTHER ? stores.find(s => s.id === storeId) ?? null : null
  const other = otherName ?? (first ? '' : item.platform ?? '')

  const boughtDay = boughtDayOf(item) ?? today
  const [day, setDay] = useState(boughtDay)
  const [channel, setChannel] = useState<Channel | null>(item.bought_channel ?? null)
  const [arrived, setArrived] = useState(item.arrived_on ?? '')
  const path = categoryPath(item.category_id, categories)
  const suggestedYears = complaintYears([path.topName ?? '', path.subName ?? ''], item.region)
  const storedYears = complaintYearsOf(item)
  const [years, setYears] = useState<2 | 5>(storedYears ?? suggestedYears)
  const [extra, setExtra] = useState(item.extra_warranty_until ?? '')
  const [note, setNote] = useState(item.receipt_note ?? '')

  // The deadlines as the draft stands; a date the owner set before stays theirs (shown beside the rules' one).
  const draft = { ...item, bought_at: middayIso(day), bought_channel: channel, arrived_on: channel === 'online' ? arrived || null : null }
  const facts = factsOf(draft, store, years)
  const dl = facts ? purchaseDeadlines(facts, { store, rules, law }) : null
  const initial = useMemo(() => {
    const f = factsOf(item, storeOfItem(item, stores))
    return f ? purchaseDeadlines(f, { store: storeOfItem(item, stores), rules, law }) : null
  }, [item, stores, rules, law])
  const [ownReturn, setOwnReturn] = useState<string | null | undefined>(undefined)
  const returnOwn = ownReturn !== undefined ? ownReturn
    : dateSource(item.return_by, initial?.returnBy?.day) === 'own' ? item.return_by ?? null : null
  const complainOwn = storedYears == null && item.warranty_until ? item.warranty_until : null
  const [keepComplain, setKeepComplain] = useState(complainOwn != null)
  const returnBy = returnOwn ?? dl?.returnBy?.day ?? null

  // A read receipt fills the store, the day and the receipt note (a printed warranty goes in the note); what the owner chose
  // or typed is never overwritten (only a value an earlier receipt put there is replaced). The amount and the warranty's
  // day are offered as chips, never filled: "Paid … — use it" writes the thing's price, a "(receipt)" chip sets a date.
  const [rd, setRd] = useState<{ fill: ReceiptFill; read: ReceiptRead } | null>(null)
  const [usePaid, setUsePaid] = useState(false)
  const [useReceiptComplain, setUseReceiptComplain] = useState(false)
  const last = useRef<{ store: string | null; day: string | null; other: string | null }>({ store: null, day: null, other: null })
  const fromReceipt = useCallback((f: ReceiptFill, read: ReceiptRead) => {
    setRd({ fill: f, read })
    const wasStore = last.current.store
    const nextStore = f.storeId ?? (f.storeName ? OTHER : null)
    if (nextStore) {
      setStorePick(p => (p === null || p === wasStore ? nextStore : p))
      if (!f.storeId && f.storeName) { const wasOther = last.current.other; setOtherName(o => (o === null || o === '' || o === wasOther ? f.storeName : o)); last.current.other = f.storeName }
      last.current.store = nextStore
    }
    if (f.day && f.day <= today) {
      const wasDay = last.current.day
      setDay(d => (d === boughtDay || d === wasDay ? f.day as string : d))
      last.current.day = f.day
    }
    if (f.note) setNote(n => (n.includes(f.note) ? n : n.trim() ? `${n.trim()}\n${f.note}` : f.note))
  }, [today, boughtDay])
  // The line that is this thing, and what was paid for it: the line's price; with no lines the receipt's total.
  const lineAt = rd?.read.items?.length ? matchLine(item.title, rd.fill.lines) : null
  const paid = !rd ? null : lineAt !== null ? rd.read.items?.[lineAt]?.price ?? null : rd.read.items?.length ? null : rd.read.total ?? null
  const paidCur = rd?.read.currency && RECEIPT_CURRENCIES.includes(rd.read.currency) ? rd.read.currency as ShopCurrency : null
  const noLine = !!rd && !!rd.read.items?.length && lineAt === null
  const receiptWarranty = rd?.fill.warrantyUntil ?? null
  const complainBy = useReceiptComplain && rd?.fill.warrantyUntil ? rd.fill.warrantyUntil : keepComplain && complainOwn ? complainOwn : dl?.complaintBy?.day ?? null

  const gone = !bought
  const valid = !!day && day <= today && (!arrived || channel !== 'online' || arrived >= day) && note.length <= NOTE_MAX

  function submit() {
    if (!valid) return
    const name = store ? store.name : storeId === OTHER ? other.trim() || null : null
    const patch: PurchasePatch = {
      bought_channel: channel,
      arrived_on: channel === 'online' ? arrived || null : null,
      return_by: returnBy,
      warranty_until: complainBy,
      extra_warranty_until: extra || null,
      receipt_note: note.trim() || null,
    }
    if (usePaid && paid != null && paidCur) { patch.price = paid; patch.currency = paidCur }
    if (storePick !== null || otherName !== null) patch.platform = name
    if (day !== boughtDay) patch.bought_at = middayIso(day)
    save.mutate({ id: item.id, patch, done: returnBy ? `Purchase saved — return by ${formatDate(returnBy)}` : 'Purchase saved' }, { onSuccess: onClose })
  }

  return (
    <ModalShell onClose={onClose} title="Just bought" subtitle={item.title} size="md" compact dismissible={!save.isPending}
      footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} className="ml-auto" disabled={save.isPending}>{gone ? 'Close' : 'Later'}</Button>
          {!gone && <Button variant="primary" size="sm" onClick={submit} disabled={!valid} loading={save.isPending}>Save</Button>}
        </div>
      }>
      {gone ? <p className="text-body text-fg-muted">It's on the wishlist again — nothing to fill in.</p> : (
        <div className="flex flex-col gap-3">
          <ReceiptPhoto stores={stores} onFill={fromReceipt} pickLines={false} />
          {rd && (
            <div className="flex flex-col gap-1.5">
              {paid != null && paidCur && (item.price !== paid || item.currency !== paidCur) && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <ChoiceChip on={usePaid} onClick={() => setUsePaid(v => !v)}>Paid {paid} {paidCur} — use it</ChoiceChip>
                  <span className="text-meta text-fg-muted">{item.price != null ? `now ${item.price} ${item.currency ?? 'NOK'}` : 'no price saved yet'}; the NOK rate of the day is set when you save</span>
                </div>
              )}
              {noLine && <p className="text-meta text-warn">No line on the receipt looks like “{item.title}” — check that it is the right receipt.</p>}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1.5" role="radiogroup" aria-label="How it was bought">
              <ChoiceChip on={channel === 'online'} onClick={() => setChannel('online')}>Online</ChoiceChip>
              <ChoiceChip on={channel === 'in_store'} onClick={() => setChannel('in_store')}>In a shop</ChoiceChip>
            </div>
            <select value={storeId} onChange={e => setStorePick(e.target.value)} aria-label="Store" disabled={storesLoading}
              className="select input-sm w-auto min-w-0 max-w-[14rem] flex-1">
              <option value="">Which store?</option>
              {pickable.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              <option value={OTHER}>Somewhere else…</option>
            </select>
          </div>
          {storeId === OTHER && (
            <input value={other} onChange={e => setOtherName(e.target.value)} placeholder="The store's name" aria-label="Store name" className="input input-sm max-w-sm" />
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-2 text-meta font-medium text-fg-muted">
              Bought on
              <DateInput value={day} onChange={d => d && setDay(d)} max={today} aria-label="Bought on" className="input input-sm w-[8.5rem] tabular-nums" />
            </label>
            {channel === 'online' && (
              <span className="flex items-center gap-2 text-meta font-medium text-fg-muted">
                Arrived
                {arrived
                  ? <DateInput value={arrived} onChange={setArrived} min={day} max={today} aria-label="Arrived on" className="input input-sm w-[8.5rem] tabular-nums" />
                  : <Button size="sm" onClick={() => setArrived(today)}>Arrived today</Button>}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-2 rounded-row border border-line bg-surface-2 p-3">
            <DateFact label="Return by" day={returnBy} today={today}
              action={returnOwn
                ? <button type="button" onClick={() => setOwnReturn(null)} className="text-meta font-semibold text-accent-600 hover:underline">Use the rules' date</button>
                : <button type="button" onClick={() => setOwnReturn(returnBy ?? day)} className="text-meta font-semibold text-accent-600 hover:underline">Set my own</button>}>
              {returnOwn
                ? <>
                  <DateInput value={returnOwn} onChange={d => setOwnReturn(d || null)} min={day} aria-label="Return by" className="input input-sm w-[8.5rem] tabular-nums" />
                  <p className="text-meta text-fg-muted">Your own date. {dl?.returnBy ? `The rules give ${formatDate(dl.returnBy.day)}.` : 'No rule gives one.'}</p>
                </>
                : dl?.returnBy
                  ? <DeadlineWords deadline={dl.returnBy} notes={dl.notes} />
                  : <DeadlineWords deadline={null} notes={dl?.notes.length ? dl.notes : ['No return rule known for this store — set your own if it gives one.']} />}
            </DateFact>
            <DateFact label="Complain by" day={complainBy} today={today}>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Complaint years">
                {([2, 5] as const).map(y => (
                  <ChoiceChip key={y} on={!keepComplain && !useReceiptComplain && years === y} onClick={() => { setYears(y); setKeepComplain(false); setUseReceiptComplain(false) }}>
                    {y} years{y === 5 ? ' — meant to last' : ''}{y === suggestedYears ? ' (suggested)' : ''}
                  </ChoiceChip>
                ))}
                {complainOwn && <ChoiceChip on={keepComplain && !useReceiptComplain} onClick={() => { setKeepComplain(true); setUseReceiptComplain(false) }}>Keep {formatDate(complainOwn)}</ChoiceChip>}
                {receiptWarranty && <ChoiceChip on={useReceiptComplain} onClick={() => { setUseReceiptComplain(true); setKeepComplain(false) }}>{formatDate(receiptWarranty)} (receipt)</ChoiceChip>}
              </div>
              {!keepComplain && !useReceiptComplain && <DeadlineWords deadline={dl?.complaintBy ?? null} />}
            </DateFact>
          </div>

          <label className="flex flex-wrap items-center gap-2 text-meta font-medium text-fg-muted">
            Extra warranty until
            <DateInput value={extra} onChange={setExtra} min={day} aria-label="Extra warranty until" className="input input-sm w-[8.5rem] tabular-nums" />
            {receiptWarranty && extra !== receiptWarranty && <ChoiceChip on={false} onClick={() => setExtra(receiptWarranty)}>{formatDate(receiptWarranty)} (receipt)</ChoiceChip>}
            <span className="font-normal">its price goes under Extra costs</span>
          </label>
          <div>
            <label htmlFor="receipt-note" className="field-label">Receipt <span className="font-normal text-fg-muted">(a note: order number, where it is)</span></label>
            <textarea id="receipt-note" value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={NOTE_MAX} className="input resize-y" />
          </div>
        </div>
      )}
    </ModalShell>
  )
}
