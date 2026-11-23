import { Check } from 'lucide-react'
import { Button, SegmentedControl, Truncate } from '../../../../shared/ui'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { costNote } from '../../../ai/claude/featureRules'
import type { MergedLine } from '../../receiptBatch'
import { lineFacts, type ReceiptSide } from '../../receiptRead'
import { SHOP_CURRENCIES } from '../../shopModel'
import type { ShopCurrency } from '../../types'
import { money } from '../shopFormat'
import type { FileRow } from './useReceiptFiles'
import type { useReceiptFlow } from './useReceiptFlow'

type Flow = ReturnType<typeof useReceiptFlow>

const amount = (n: number | null | undefined, currency: string | undefined) => {
  if (n == null) return ''
  return currency && SHOP_CURRENCIES.includes(currency as ShopCurrency) ? money(n, currency as ShopCurrency) : `${n}${currency ? ` ${currency}` : ''}`
}

const SIDES = [{ value: 'bought' as ReceiptSide, label: 'Bought' }, { value: 'sold' as ReceiptSide, label: 'Sold' }]

/** The lines of every read file as one list, under a one-line header per file (name, store, day, cost). */
export function ReceiptLines({ files, merged, flow }: { files: readonly FileRow[]; merged: readonly MergedLine[]; flow: Flow }) {
  const groups = files.filter(f => f.status === 'done' && f.read).map(f => ({ file: f, lines: merged.filter(m => m.file === f.id) }))
  return (
    <div className="flex flex-col gap-3">
      {groups.map(({ file, lines }) => {
        const read = file.read as NonNullable<FileRow['read']>
        const head = [file.name, read.store, read.date ? formatDate(read.date) : null].filter(Boolean).join(' · ')
        const cost = [read.searched ? 'searched' : null, costNote(read.costUsd)].filter(Boolean).join(' · ')
        return (
          <section key={file.id} aria-label={file.name}>
            <h3 className="mb-1 flex items-baseline gap-2 text-meta font-medium text-fg-muted">
              <span className="min-w-0 flex-1"><Truncate>{head}</Truncate></span>
              {cost && <span className="shrink-0 font-normal tabular-nums">{cost}</span>}
            </h3>
            {lines.length === 0
              ? <p className="text-body text-fg-muted">No product lines were read.</p>
              : <ul className="flex flex-col gap-1.5">{lines.map(m => <LineRow key={m.key} m={m} flow={flow} />)}</ul>}
          </section>
        )
      })}
    </div>
  )
}

function LineRow({ m, flow }: { m: MergedLine; flow: Flow }) {
  const i = flow.info.get(m.key)
  if (!i) return null
  const done = flow.doneKeys.has(m.key)
  const name = m.line.product ?? m.line.name
  const price = m.line.price !== null ? amount(m.line.price, m.read.currency) : 'no price printed'
  const facts = [lineFacts(m.line), i.wish ? 'on your wishlist' : ''].filter(Boolean).join(' · ')
  // A wish has its own Bought button; every other line has a tick (a repeat of an earlier file starts unticked).
  const tick = !i.wish
  return (
    <li className={`rounded-row border border-line bg-surface-2 px-3 py-2 ${i.included || i.wish ? '' : 'opacity-70'}`}>
      <div className="flex items-center gap-2">
        {tick && (
          <input type="checkbox" checked={i.included} disabled={done} aria-label={`Include “${name}”`} onChange={e => flow.setIncluded(m.key, e.target.checked)} className="h-[18px] w-[18px] shrink-0 accent-accent-500" />
        )}
        <span className="min-w-0 flex-1 text-body font-medium"><Truncate>{name}</Truncate></span>
        <span className="shrink-0 text-meta tabular-nums text-fg-muted">{price}</span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="min-w-0 flex-1 text-meta text-fg-muted"><Truncate>{facts || ' '}</Truncate></span>
        {!done && <SegmentedControl<ReceiptSide> size="xs" label={`Bought or sold: ${name}`} value={i.side} onChange={s => flow.setSide(m.key, s)} options={SIDES} />}
        {done
          ? <span className="inline-flex shrink-0 items-center gap-1 text-meta font-medium text-success"><Check aria-hidden className="h-3.5 w-3.5" />{i.side === 'sold' ? 'Done' : i.wish ? 'Bought' : 'Added'}</span>
          : i.side === 'bought' && i.wish
            ? <Button size="sm" variant="primary" className="shrink-0" onClick={() => flow.buyWish(m.key)}>Bought</Button>
            : i.side === 'sold' && i.included && i.way === 'owned'
              ? <Button size="sm" className="shrink-0" onClick={() => flow.openSale(m.key)}>Sell</Button>
              : i.side === 'sold' && i.included && i.way === 'had'
                ? <Button size="sm" className="shrink-0" onClick={() => flow.openHad(m.key)}>Add</Button>
                : null}
      </div>
      {i.side === 'sold' && !done && i.included && (
        <div className="mt-1">
          <select aria-label={`Which of your things is “${name}”`} value={i.way === 'had' ? '' : i.thingId} onChange={e => flow.setPick(m.key, e.target.value)} className="select w-full">
            <option value="">Not one of my things — add it as something I had</option>
            {flow.mine.length > 0 && <optgroup label="Mine">{flow.mine.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</optgroup>}
            {flow.soldInApp.length > 0 && <optgroup label="Already sold in the app">{flow.soldInApp.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</optgroup>}
          </select>
        </div>
      )}
    </li>
  )
}
