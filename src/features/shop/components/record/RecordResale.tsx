import { Suspense, useMemo, useState } from 'react'
import { Plus, RefreshCw, X } from 'lucide-react'
import { Button, CardHeader, MetaLine, Skeleton, Truncate, cx } from '../../../../shared/ui'
import { DateInput } from '../../../../shared/components/DateInput'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { lazyPart } from '../../../../shared/utils/lazyPage'
import { todayStr } from '../../../../shared/utils/dateUtils'
import {
  useAdNotes, useAdTemplates, useCreateAdNote, useCreateTradeInQuote, useDeleteAdNote, useDeleteTradeInQuote, useListings,
  useTradeInQuotes, useValueHistory,
} from '../../hooks/useShopResale'
import { CONDITION_LABEL, resaleEvidence, type ResaleEvidenceRow, type ResaleRange } from '../../resaleEvidence'
import { isAdUrl, marketplaceOf, RESALE_CONDITIONS } from '../../resaleRows'
import { endedListingsOf, estimateHistory, HANDED_OVER, hasOldEstimate, listingWords, marketplacesOf, oldEstimates } from '../../sellingModel'
import { money, moneyRange, num } from '../shopFormat'
import { MoneyEditor } from './factKit'
import { AddressLink } from './AddressLink'
import { RecordListing } from './RecordListing'
import { HandoverChecklist } from './HandoverChecklist'
import type { ShopRecordModel } from './useShopRecord'
import type { ResaleCondition, ShopAdNote, ShopTradeInQuote } from '../../resaleTypes'
import type { ShopCurrency, ShopItem, ShopPriceWatch } from '../../types'

const UpdateValuesSheet = lazyPart('shop-update-values', () => import('./UpdateValuesSheet').then(m => m.UpdateValuesSheet))

/**
 * The Resale section's own parts (step C), under its facts: for a thing still yours the evidence of what it could
 * sell for with a suggested range (Use fills "Could sell for" in the draft — nothing fills itself), "+ Note an ad",
 * "+ Trade-in quote", your past estimates, "Update values" for every old one, and Selling (the ad, the listing);
 * for a thing that left, how its listing ended and the hand-over checklist.
 */
export function RecordResale({ r, watch }: { r: ShopRecordModel; watch: ShopPriceWatch | null }) {
  const { state } = r
  if (state === 'gone') return <GoneResale r={r} />
  if (state !== 'mine') return null
  return (
    <>
      <ResaleEvidence r={r} watch={watch} />
      <RecordListing r={r} />
    </>
  )
}

function GoneResale({ r }: { r: ShopRecordModel }) {
  const { data: listings = [] } = useListings()
  const ended = endedListingsOf(listings, r.item.id)
  return (
    <>
      {ended.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {ended.map(l => (
            <li key={l.id} className="text-meta tabular-nums text-fg-muted">
              {listingWords(l, r.today)} · asked {l.prices.map(p => money(p.price, l.currency)).join(' → ')}
            </li>
          ))}
        </ul>
      )}
      {r.item.disposal && HANDED_OVER.includes(r.item.disposal) && <HandoverChecklist item={r.item} categories={r.categories} />}
    </>
  )
}

function ResaleEvidence({ r, watch }: { r: ShopRecordModel; watch: ShopPriceWatch | null }) {
  const { item, items, ctx, today, d } = r
  const notes = useAdNotes()
  const quotes = useTradeInQuotes()
  const values = useValueHistory()
  const { data: templates = [] } = useAdTemplates()
  const [adding, setAdding] = useState<'ad' | 'quote' | null>(null)
  const [updating, setUpdating] = useState(false)
  // Prisjakt's used and refurbished offers count only from the watch of the thing's own Prisjakt link.
  const own = watch && watch.url === item.url && watch.source === 'prisjakt' ? watch : null
  const evidence = useMemo(() => resaleEvidence({
    item, items, adNotes: notes.data ?? [], quotes: quotes.data ?? [], values: values.data ?? [], watch: own, rates: ctx.rates, today,
  }), [item, items, notes.data, quotes.data, values.data, own, ctx.rates, today])
  const history = useMemo(() => estimateHistory(values.data ?? [], item), [values.data, item])
  const old = useMemo(() => oldEstimates(items, today), [items, today])
  const rows = evidence.rows.filter(e => e.kind !== 'estimate')
  const loading = notes.isLoading || quotes.isLoading || values.isLoading
  const draft = { ...item, ...d.draft } as ShopItem
  const use = (n: number) => { d.set({ value_now: n, value_currency: 'NOK' }) }

  return (
    <div className="flex flex-col gap-2">
      {loading ? <Skeleton className="h-11 w-full" /> : evidence.range && (
        <RangeRow range={evidence.range} used={draft.value_now === evidence.range.mid && (draft.value_currency ?? 'NOK') === 'NOK'} onUse={use} />
      )}
      <div>
        <CardHeader title="Evidence" variant="label" className="mb-1"
          action={!adding && (
            <span className="flex gap-1">
              <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setAdding('ad')}>Note an ad</Button>
              <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setAdding('quote')}>Trade-in quote</Button>
            </span>
          )} />
        {adding === 'ad' && <AdNoteForm itemId={item.id} known={marketplacesOf(templates)} onDone={() => setAdding(null)} />}
        {adding === 'quote' && <QuoteForm itemId={item.id} onDone={() => setAdding(null)} />}
        {loading ? <Skeleton className="h-4 w-3/4" /> : rows.length === 0 && !adding ? (
          <p className="text-meta text-fg-muted">Ads you note (asking or sold), trade-in quotes and shops' used prices for it show here, with a suggested range.</p>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {rows.map(e => <EvidenceRow key={`${e.kind}:${e.ref}`} e={e} notes={notes.data ?? []} quotes={quotes.data ?? []} />)}
          </ul>
        )}
      </div>
      {history.length > 0 && (
        <div className="text-meta tabular-nums text-fg-muted">
          <span className="font-semibold text-fg-2">Your estimates</span> <span>— shown, not counted</span>
          <MetaLine as="p" items={[...history.slice(0, 4).map(h => `${money(h.value, h.currency)} (${formatDate(h.on)})`), history.length > 4 && `and ${history.length - 4} earlier`]} />
        </div>
      )}
      {old.length > 0 && hasOldEstimate(item, today) && (
        <div className="flex flex-wrap items-center gap-x-2 text-meta text-fg-muted">
          <span>{old.length === 1 ? 'This estimate is over six months old.' : `This and ${old.length - 1} more estimate${old.length === 2 ? ' are' : 's are'} over six months old.`}</span>
          <Button size="sm" variant="ghost" icon={<RefreshCw />} className="text-accent-600" onClick={() => setUpdating(true)}>Update values</Button>
        </div>
      )}
      {updating && (
        <Suspense fallback={null}>
          <UpdateValuesSheet items={items} today={today} onClose={() => setUpdating(false)} />
        </Suspense>
      )}
    </div>
  )
}

/** The suggested range and what it is from; Use puts its middle in "Could sell for" (the draft — Save keeps it). */
function RangeRow({ range, used, onUse }: { range: ResaleRange; used: boolean; onUse: (n: number) => void }) {
  const words = range.low !== null && range.high !== null
    ? (range.low === range.high ? money(range.low) : moneyRange(range.low, range.high))
    : range.low !== null ? `at least ${money(range.low)}` : `up to ${money(range.high as number)}`
  return (
    <div className="flex items-center gap-2 rounded-row border border-line bg-surface-2 px-3 py-1.5">
      <span className="min-w-0 flex-1">
        <span className="block text-body tabular-nums text-fg"><span className="text-fg-muted">Suggested</span> <span className="font-semibold">{words}</span></span>
        <Truncate as="span" className="block text-meta text-fg-muted">{range.basis}</Truncate>
      </span>
      {range.mid !== null && (
        <Button size="sm" variant={used ? 'ghost' : 'secondary'} disabled={used} onClick={() => onUse(range.mid as number)} className="shrink-0 tabular-nums">
          {used ? 'Used' : `Use ${num(range.mid)}`}
        </Button>
      )}
    </div>
  )
}

function EvidenceRow({ e, notes, quotes }: { e: ResaleEvidenceRow; notes: readonly ShopAdNote[]; quotes: readonly ShopTradeInQuote[] }) {
  const delNote = useDeleteAdNote()
  const delQuote = useDeleteTradeInQuote()
  const note = e.kind === 'ad_ask' || e.kind === 'ad_sold' ? notes.find(n => n.id === e.ref) : undefined
  const quote = e.kind === 'trade_in' ? quotes.find(q => q.id === e.ref) : undefined
  const condition = e.condition ? CONDITION_LABEL[e.condition] : null
  return (
    <li className="flex min-h-[44px] items-center gap-2 px-2 py-1">
      <span className="min-w-0 flex-1">
        <Truncate as="span" className={cx('block text-body', e.counts ? 'text-fg-2' : 'text-fg-muted')}>{[e.source, condition].filter(Boolean).join(' · ')}</Truncate>
        <span className="flex min-w-0 items-center gap-1.5 text-meta tabular-nums text-fg-muted">
          <span className="shrink-0">{formatDate(e.on)}</span>
          {e.why && <span className="shrink-0">· not counted: {e.why}</span>}
          {e.link && <><span aria-hidden>·</span><AddressLink url={e.link} /></>}
        </span>
      </span>
      <span className={cx('shrink-0 text-right text-body tabular-nums', e.counts ? 'font-semibold text-fg' : 'text-fg-muted')}>{money(e.amount, e.currency)}</span>
      {(note || quote) && (
        <button type="button" aria-label={note ? 'Delete this noted ad' : 'Delete this trade-in quote'}
          onClick={() => { if (note) void delNote.run(note); else if (quote) void delQuote.run(quote) }}
          className="icon-btn shrink-0 text-fg-faint hover:!text-danger">
          <X aria-hidden className="h-4 w-4" />
        </button>
      )}
    </li>
  )
}

function ConditionSelect({ value, onChange }: { value: ResaleCondition | null; onChange: (c: ResaleCondition | null) => void }) {
  return (
    <select value={value ?? ''} onChange={e => onChange((e.target.value || null) as ResaleCondition | null)} aria-label="Condition" className="select w-auto min-w-0">
      <option value="">Condition…</option>
      {RESALE_CONDITIONS.map(c => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
    </select>
  )
}

/** "+ Note an ad": a pasted link and its price. The link is kept as typed and never opened or read by the app. */
function AdNoteForm({ itemId, known, onDone }: { itemId: string; known: readonly string[]; onDone: () => void }) {
  const create = useCreateAdNote()
  const [url, setUrl] = useState('')
  const [price, setPrice] = useState<number | null>(null)
  const [currency, setCurrency] = useState<ShopCurrency>('NOK')
  const [asking, setAsking] = useState(true)
  const [condition, setCondition] = useState<ResaleCondition | null>(null)
  const link = url.trim()
  const ok = isAdUrl(link)
  const host = ok ? marketplaceOf(link, known) : null
  const save = () => {
    if (!ok || price == null) return
    create.mutate({ item_id: itemId, ad_url: link, marketplace: host, price, currency, asking, condition, noted_on: todayStr() }, { onSuccess: onDone })
  }
  return (
    <div className="mb-2 flex flex-col gap-2 rounded-row bg-surface-2 p-2">
      <input type="url" inputMode="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.finn.no/…" aria-label="The ad's link" className="input max-w-md" autoFocus />
      {link && !ok && <p className="text-meta text-danger">One https:// address — paste it from the address bar.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-[11rem]"><MoneyEditor label="Price" amount={price} currency={currency} onAmount={setPrice} onCurrency={setCurrency} /></div>
        <div className="seg" role="group" aria-label="Asking or sold">
          <button type="button" aria-pressed={asking} onClick={() => setAsking(true)} className="seg-btn">Asking</button>
          <button type="button" aria-pressed={!asking} onClick={() => setAsking(false)} className="seg-btn">Sold for</button>
        </div>
        <ConditionSelect value={condition} onChange={setCondition} />
      </div>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-meta text-fg-muted">{host ? `On ${host}. ` : ''}The app never opens or reads the link.</span>
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={save} disabled={!ok || price == null} loading={create.isPending}>Note it</Button>
      </div>
    </div>
  )
}

/** "+ Trade-in quote": what a dealer offered (the floor of the range). */
function QuoteForm({ itemId, onDone }: { itemId: string; onDone: () => void }) {
  const create = useCreateTradeInQuote()
  const [dealer, setDealer] = useState('')
  const [amount, setAmount] = useState<number | null>(null)
  const [currency, setCurrency] = useState<ShopCurrency>('NOK')
  const [condition, setCondition] = useState<ResaleCondition | null>(null)
  const [on, setOn] = useState(todayStr)
  const save = () => {
    if (!dealer.trim() || amount == null) return
    create.mutate({ item_id: itemId, dealer: dealer.trim(), amount, currency, condition, quoted_on: on }, { onSuccess: onDone })
  }
  return (
    <div className="mb-2 flex flex-col gap-2 rounded-row bg-surface-2 p-2">
      <input value={dealer} onChange={e => setDealer(e.target.value)} placeholder="Who offered it (a store, a trade-in site)" aria-label="Who offered it" className="input max-w-md" autoFocus />
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-[11rem]"><MoneyEditor label="Offered" amount={amount} currency={currency} onAmount={setAmount} onCurrency={setCurrency} /></div>
        <ConditionSelect value={condition} onChange={setCondition} />
        <DateInput value={on} onChange={v => v && setOn(v)} aria-label="Quoted on" className="input w-[10rem] tabular-nums" />
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={save} disabled={!dealer.trim() || amount == null} loading={create.isPending}>Add the quote</Button>
      </div>
    </div>
  )
}

