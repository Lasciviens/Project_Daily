import { useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { EntityModalProps } from '../../../shared/modals/types'
import { useEntityModal } from '../../../shared/modals'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button, SegmentedControl, Truncate } from '../../../shared/ui'
import { formatDate } from '../../../shared/utils/dateFormat'
import { PhotoButton } from '../../ai/claude/components/PhotoButton'
import { useReadReceipt } from '../../ai/claude/hooks/useAiFeatures'
import { costNote, type ReceiptFill, type ReceiptLine, type ReceiptRead } from '../../ai/claude/featureRules'
import { useBuyNow, useShopItems } from '../hooks/useShop'
import { useShopStores } from '../hooks/useShopStores'
import { isMine } from '../ownModel'
import { addFillFor, lineFacts, saleFor, sideOf, thingForLine, wishForLine, type ReceiptSide } from '../receiptRead'
import { SHOP_CURRENCIES } from '../shopModel'
import { money } from '../components/shopFormat'
import type { ShopCurrency } from '../types'

/**
 * Read a receipt (owner, 23.11.2026: "read from receipt, either to sell or save a purchase — a physical receipt and a
 * digital one, a PDF"): one photo or PDF, read by the model in one call (and never kept), then its product lines.
 * Bought: a line that is one of your wishes says **Bought** (the wish becomes bought and Just bought opens with the
 * receipt's values); any other line says **Add** (Add something I own with the line's values). Sold: each line is
 * matched to one of your things (you can change it) and Sell opens with the amount, the day and the buyer. Every sheet
 * saves on your tap only: this popup writes nothing but the wish's own "bought" (which has its Undo).
 */
export function ShopReceiptModal({ onClose }: EntityModalProps<'shop-receipt'>) {
  const read = useReadReceipt()
  const modal = useEntityModal()
  const { data: stores = [] } = useShopStores()
  const { data: items = [] } = useShopItems()
  const [data, setData] = useState<(ReceiptRead & { costUsd: number | null }) | null>(null)
  const [side, setSide] = useState<ReceiptSide>('bought')
  const [done, setDone] = useState<ReadonlySet<string>>(new Set())
  const [picked, setPicked] = useState<Record<number, string>>({})
  const mark = (key: string) => setDone(d => new Set(d).add(key))

  // A wish bought here goes through the one "Bought" every screen uses: today, the row's own price, store and currency, Undo,
  // then Just bought opens at once with the receipt's values.
  const buying = useRef<{ key: string; receipt: { fill: ReceiptFill; read: ReceiptRead } } | null>(null)
  const buyNow = useBuyNow(id => {
    const b = buying.current
    if (!b) return
    mark(b.key)
    modal.open({ kind: 'shop-just-bought', id, receipt: b.receipt })
  }, { thenDetails: true })

  const things = useMemo(() => items.filter(t => isMine(t) && !t.accessory_of).sort((a, b) => a.title.localeCompare(b.title)), [items])
  const lines = useMemo(() => data?.items ?? [], [data])
  // The matches by code, once for this receipt: the owner's pick wins.
  const matched = useMemo(() => lines.map(l => thingForLine(l, items)?.id ?? ''), [lines, items])
  const wishes = useMemo(() => lines.map(l => wishForLine(l, items)), [lines, items])

  async function onFile(file: File) {
    try {
      const r = await read.mutateAsync(file)
      setData(r)
      setSide(sideOf(r))
      setDone(new Set())
      setPicked({})
    } catch { /* the hook reports it, in its own words */ }
  }

  const amount = (n: number | null | undefined, currency: string | undefined) => {
    if (n == null) return ''
    return currency && SHOP_CURRENCIES.includes(currency as ShopCurrency) ? money(n, currency as ShopCurrency) : `${n}${currency ? ` ${currency}` : ''}`
  }
  const currencyOk = !!data?.currency && SHOP_CURRENCIES.includes(data.currency as ShopCurrency)

  function lineRow(line: ReceiptLine, i: number) {
    const key = `${side}:${i}`
    const facts = lineFacts(line)
    const price = line.price !== null ? amount(line.price, data?.currency) : 'no price printed'
    // A pick that is no longer one of your things (sold or deleted since) is never used.
    const chosen = [picked[i], matched[i]].find(id => id && things.some(t => t.id === id)) ?? ''
    const wish = side === 'bought' ? wishes[i] : null
    return (
      <li key={i} className={`flex gap-2 rounded-row border border-line bg-surface-2 p-3 ${side === 'bought' ? 'items-center' : 'flex-col sm:flex-row sm:items-center'}`}>
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-2 text-body font-medium">
            <span className="min-w-0 flex-1"><Truncate>{line.product ?? line.name}</Truncate></span>
            {side === 'sold' && <span className="shrink-0 text-meta font-normal tabular-nums text-fg-muted">{price}</span>}
          </p>
          <p className="text-meta text-fg-muted tabular-nums">{[facts, side === 'bought' ? price : '', wish ? 'on your wishlist' : ''].filter(Boolean).join(' · ')}</p>
        </div>
        {side === 'bought' ? (
          done.has(key)
            ? <span className="shrink-0 text-meta font-medium text-success">✓ {wish ? 'Bought' : 'Added'}</span>
            : wish
              ? <Button size="sm" variant="primary" className="shrink-0" onClick={() => {
                if (!data) return
                buying.current = { key, receipt: { fill: addFillFor(data, i, stores), read: data } }
                buyNow(wish)
              }}>Bought</Button>
              : <Button size="sm" className="shrink-0" onClick={() => data && modal.open({ kind: 'shop-own', receipt: addFillFor(data, i, stores), onSaved: () => mark(key) })}>Add</Button>
        ) : (
          <div className="flex items-center gap-2">
            <select aria-label={`Which of your things is “${line.name}”`} value={chosen} onChange={e => setPicked(p => ({ ...p, [i]: e.target.value }))} className="select min-w-0 flex-1 sm:w-52 sm:flex-none">
              <option value="">Pick one of your things</option>
              {things.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
            {done.has(key)
              ? <span className="shrink-0 text-meta font-medium text-success">✓ Sold</span>
              : <Button size="sm" disabled={!chosen} className="shrink-0"
                onClick={() => data && chosen && modal.open({ kind: 'shop-sell', id: chosen, sale: saleFor(data, line, stores), onSold: () => mark(key) })}>Sell</Button>}
          </div>
        )}
      </li>
    )
  }

  // The cost goes last, so the line fits one row on a phone.
  const summary = data ? [
    data.store, data.date ? formatDate(data.date) : null, data.total !== undefined ? amount(data.total, data.currency) : null,
    data.searched ? 'searched the web' : null, costNote(data.costUsd) || null,
  ].filter(Boolean).join(' · ') : ''

  return (
    <ModalShell onClose={onClose} title="Read a receipt" size="md" dismissible={!read.isPending}
      footer={
        <div className="flex items-center gap-2">
          {data && <PhotoButton accept="image/*,application/pdf" variant="ghost" onFile={f => { void onFile(f) }} loading={read.isPending}>Another receipt</PhotoButton>}
          <Button onClick={onClose} className="ml-auto" disabled={read.isPending}>Close</Button>
        </div>
      }>
      <div className="flex flex-col gap-3">
        {!data && !read.isPending && (
          <div className="flex flex-col items-start gap-2">
            <p className="text-body text-fg-muted">Pick a photo of a receipt or a PDF (a till slip, an invoice, an order, a payout). AI reads it and lists what was bought or sold; you then add each line yourself. The file is not kept.</p>
            <PhotoButton accept="image/*,application/pdf" variant="primary" onFile={f => { void onFile(f) }}>Choose a photo or PDF</PhotoButton>
          </div>
        )}
        {read.isPending && (
          <p role="status" className="flex items-center gap-2 text-body text-fg-muted">
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Reading the receipt… a long PDF can take up to a minute.
          </p>
        )}
        {data && !read.isPending && (
          <>
            <p className="text-meta text-fg-muted"><span className="text-fg-muted">AI read: </span>{summary || 'nothing clear'}</p>
            <SegmentedControl<ReceiptSide> size="sm" value={side} onChange={setSide}
              options={[{ value: 'bought', label: 'Bought' }, { value: 'sold', label: 'Sold' }]} />
            {!currencyOk && <p className="text-meta text-warn">No clear currency this app holds (NOK, TRY, EUR, USD): amounts are left out of the sheets.</p>}
            {lines.length === 0
              ? <p className="text-body text-fg-muted">No product lines were read. Try another photo or PDF.</p>
              : <ul className="flex flex-col gap-2">{lines.map(lineRow)}</ul>}
            {side === 'sold' && lines.length > 0 && things.length === 0 && <p className="text-meta text-fg-muted">You have no things in Owned to sell yet.</p>}
          </>
        )}
      </div>
    </ModalShell>
  )
}
