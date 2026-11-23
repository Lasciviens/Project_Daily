import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { EntityModalProps } from '../../../shared/modals/types'
import { useEntityModal } from '../../../shared/modals'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button, SegmentedControl, Truncate } from '../../../shared/ui'
import { formatDate } from '../../../shared/utils/dateFormat'
import { PhotoButton } from '../../ai/claude/components/PhotoButton'
import { useReadReceipt } from '../../ai/claude/hooks/useAiFeatures'
import { costNote, type ReceiptLine, type ReceiptRead } from '../../ai/claude/featureRules'
import { useShopItems } from '../hooks/useShop'
import { useShopStores } from '../hooks/useShopStores'
import { isMine } from '../ownModel'
import { addFillFor, lineFacts, saleFor, sideOf, thingForLine, type ReceiptSide } from '../receiptRead'
import { SHOP_CURRENCIES } from '../shopModel'
import { money } from '../components/shopFormat'
import type { ShopCurrency } from '../types'

/**
 * Read a receipt (owner, 23.11.2026: "read from receipt, either to sell or save a purchase — a physical receipt and a
 * digital one, a PDF"): one photo or PDF, read by the model in one call (and never kept), then its product lines.
 * Bought: each line's Add opens Add something I own with that line's values; Sold: each line is matched to one of your
 * things (you can change it) and Sell opens with the amount and the day. Both sheets save, and only on your tap — this
 * popup writes nothing.
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

  const things = useMemo(() => items.filter(t => isMine(t) && !t.accessory_of).sort((a, b) => a.title.localeCompare(b.title)), [items])
  const lines = useMemo(() => data?.items ?? [], [data])
  // The match by code, once for this receipt: the owner's pick wins.
  const matched = useMemo(() => lines.map(l => thingForLine(l, items)?.id ?? ''), [lines, items])
  const mark = (key: string) => setDone(d => new Set(d).add(key))

  async function onFile(file: File) {
    try {
      const r = await read.mutateAsync(file)
      setData(r)
      setSide(sideOf(r))
      setDone(new Set())
      setPicked({})
    } catch { /* the hook reports it */ }
  }

  const amount = (n: number | null | undefined, currency: string | undefined) => {
    if (n == null) return ''
    return currency && SHOP_CURRENCIES.includes(currency as ShopCurrency) ? money(n, currency as ShopCurrency) : `${n}${currency ? ` ${currency}` : ''}`
  }
  const currencyOk = !!data?.currency && SHOP_CURRENCIES.includes(data.currency as ShopCurrency)

  function lineRow(line: ReceiptLine, i: number) {
    const key = `${side}:${i}`
    const facts = lineFacts(line)
    const chosen = picked[i] ?? matched[i] ?? ''
    return (
      <li key={i} className={`flex gap-2 rounded-row border border-line bg-surface-2 p-3 ${side === 'bought' ? 'items-center' : 'flex-col sm:flex-row sm:items-center'}`}>
        <div className="min-w-0 flex-1">
          <p className="text-body font-medium"><Truncate>{line.name}</Truncate></p>
          <p className="text-meta text-fg-muted tabular-nums">
            {[facts, line.price !== null ? amount(line.price, data?.currency) : 'no price printed'].filter(Boolean).join(' · ')}
          </p>
        </div>
        {side === 'bought' ? (
          done.has(key)
            ? <span className="text-meta font-medium text-success">✓ Added</span>
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
                onClick={() => data && modal.open({ kind: 'shop-sell', id: chosen, sale: saleFor(data, line), onSold: () => mark(key) })}>Sell</Button>}
          </div>
        )}
      </li>
    )
  }

  const summary = data ? [data.store, data.date ? formatDate(data.date) : null, data.total !== undefined ? amount(data.total, data.currency) : null].filter(Boolean).join(' · ') : ''

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
            <p className="text-body text-fg-muted">Pick a photo of a receipt or a PDF (a till slip, an invoice, an order). AI reads it and lists what was bought or sold; you then add each line yourself. The file is not kept.</p>
            <PhotoButton accept="image/*,application/pdf" variant="primary" onFile={f => { void onFile(f) }}>Choose a photo or PDF</PhotoButton>
            {read.isError && <p className="text-meta text-warn">Nothing was read. Try a flatter, brighter photo, or a PDF of one to three pages.</p>}
          </div>
        )}
        {read.isPending && (
          <p role="status" className="flex items-center gap-2 text-body text-fg-muted">
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Reading the receipt… a long PDF can take up to a minute.
          </p>
        )}
        {data && !read.isPending && (
          <>
            <p className="text-meta text-fg-muted">AI read{costNote(data.costUsd) ? ` (${costNote(data.costUsd)})` : ''}: {summary || 'nothing clear'}</p>
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
