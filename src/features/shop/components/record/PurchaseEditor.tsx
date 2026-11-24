import type { ReactNode } from 'react'
import { Button } from '../../../../shared/ui'
import { DateInput } from '../../../../shared/components/DateInput'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { DateFact, DeadlineWords } from '../purchase/purchaseKit'
import { ChoiceChip } from '../shopPickers'
import { ReceiptPhoto } from './ReceiptPhoto'
import { RecordCosts } from './RecordCosts'
import { NOTE_MAX, OTHER_STORE, withReceiptOnForm, type PurchaseForm, type PurchaseView } from './purchaseDraft'
import type { ReceiptFill, ReceiptRead } from '../../../ai/claude/featureRules'
import type { ShopItem, ShopStore } from '../../types'

/**
 * The one body's Purchase editor (every mode where a thing is yours): online or in a shop, where, the day, Arrived, the return
 * and complaint days with their reasons (the store's rules and Norway's law — each date explains itself, the earlier one when
 * unsure), "Set my own", the complaint years, an extra warranty, the receipt as a note, and what a read receipt adds (the
 * paid price as a chip, the warranty's day, its extra costs ticked). `dayAndStore` false: the day and the store are the
 * thing's Facts (adding, and a saved record — one editor each, guardian 24.11.2026), so they are shown there, never edited twice.
 * Until Arrived is tapped every count starts on the purchase day.
 */
export function PurchaseEditor({ item, form: f, onForm, view: v, stores, storesLoading, today, dayAndStore = true, receipt = true, noDay = false, beside, onReceiptFacts, factsLine }: {
  item: ShopItem
  form: PurchaseForm
  onForm: (next: PurchaseForm) => void
  view: PurchaseView
  stores: readonly ShopStore[]
  storesLoading?: boolean
  today: string
  /** The store and the day edited here (Just bought); false where the Facts hold them. */
  dayAndStore?: boolean
  /** Offer "From a receipt" (one file fills this form). */
  receipt?: boolean
  /** No purchase day yet (a thing being added): the deadlines wait for it instead of counting from a guess. */
  noDay?: boolean
  /** What shares the receipt's row (Find picture), so it takes no line of its own. */
  beside?: ReactNode
  /** Where the Facts hold the day and the store: the receipt's day and store go there (the record's draft, saved with its Save). */
  onReceiptFacts?: (fill: ReceiptFill) => void
  /** Where the Facts hold the day and the store: them as one read-only line ("Bought 08.11.2026 · Elkjøp — edit it in Facts"). */
  factsLine?: string
}) {
  const set = (p: Partial<PurchaseForm>) => onForm({ ...f, ...p })
  const rd = f.rd
  return (
    <div className="flex flex-col gap-3">
      {(receipt || beside) && (
        <div className="flex flex-wrap items-start justify-between gap-2">
          {receipt && (
            <ReceiptPhoto stores={stores} pickLines={false} onFill={(fill: ReceiptFill, read: ReceiptRead) => {
              onForm(withReceiptOnForm(f, fill, read, v.boughtDay, today))
              if (!dayAndStore) onReceiptFacts?.(fill)
            }} />
          )}
          {beside && <div className="ml-auto">{beside}</div>}
        </div>
      )}
      {rd && (
        <div className="flex flex-col gap-1.5">
          {v.paid != null && v.paidCur && (item.price !== v.paid || item.currency !== v.paidCur) && (
            <div className="flex flex-wrap items-center gap-1.5">
              <ChoiceChip on={f.usePaid} onClick={() => set({ usePaid: !f.usePaid })}>Paid {v.paid} {v.paidCur}</ChoiceChip>
              <span className="text-meta text-fg-muted">{item.price != null ? `now ${item.price} ${item.currency ?? 'NOK'}` : 'no price saved yet'}; the NOK rate of the day is set when you save</span>
            </div>
          )}
          {v.costs.length > 0 && (
            <RecordCosts canAdd={false}
              drafts={v.costs.map(c => ({ ...c, id: c.label + c.amount, on: v.costOn(c) }))}
              onDrafts={next => set({ costOff: next.filter(c => !c.on).map(c => c.id) })} />
          )}
          {v.noLine && <p className="text-meta text-warn">No line on the receipt looks like “{item.title}” — check that it is the right receipt.</p>}
        </div>
      )}
      {factsLine && <p className="text-meta tabular-nums text-fg-muted">{factsLine}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5" role="radiogroup" aria-label="How it was bought">
          <ChoiceChip on={f.channel === 'online'} onClick={() => set({ channel: 'online' })}>Online</ChoiceChip>
          <ChoiceChip on={f.channel === 'in_store'} onClick={() => set({ channel: 'in_store' })} tip="In store — bought in a shop">In store</ChoiceChip>
        </div>
        {dayAndStore && (
          <select value={v.storeId} onChange={e => set({ storePick: e.target.value })} aria-label="Store" disabled={storesLoading}
            className="select input-sm w-auto min-w-0 max-w-[14rem] flex-1">
            <option value="">Which store?</option>
            {v.pickable.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            <option value={OTHER_STORE}>Somewhere else…</option>
          </select>
        )}
      </div>
      {dayAndStore && v.storeId === OTHER_STORE && (
        <input value={v.other} onChange={e => set({ otherName: e.target.value })} placeholder="The store's name" aria-label="Store name" className="input input-sm max-w-sm" />
      )}
      {(dayAndStore || f.channel === 'online') && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {dayAndStore && (
            <label className="flex items-center gap-2 text-meta font-medium text-fg-muted">
              Bought on
              <DateInput value={f.day} onChange={d => d && set({ day: d })} max={today} aria-label="Bought on" className="input input-sm w-[8.5rem] tabular-nums" />
            </label>
          )}
          {f.channel === 'online' && (
            <span className="flex items-center gap-2 text-meta font-medium text-fg-muted">
              Arrived
              {f.arrived
                ? <DateInput value={f.arrived} onChange={d => set({ arrived: d })} min={f.day} max={today} aria-label="Arrived on" className="input input-sm w-[8.5rem] tabular-nums" />
                : <Button size="sm" onClick={() => set({ arrived: today })} tip="Today — it arrived today">Today</Button>}
            </span>
          )}
        </div>
      )}

      {noDay ? (
        <p className="text-meta text-fg-muted">The return and complaint days show once the day it was bought is set (Facts).</p>
      ) : <div className="flex flex-col gap-2 rounded-row border border-line bg-surface-2 p-3">
        <DateFact label="Return by" day={v.returnBy} today={today}
          action={v.returnOwn
            ? <button type="button" onClick={() => set({ ownReturn: null })} title="Rules' date — use it" className="text-meta font-semibold text-accent-600 hover:underline">Rules' date</button>
            : <button type="button" onClick={() => set({ ownReturn: v.returnBy ?? f.day })} title="Own date — set my own return date" className="text-meta font-semibold text-accent-600 hover:underline">Own date</button>}>
          {v.returnOwn
            ? <>
              <DateInput value={v.returnOwn} onChange={d => set({ ownReturn: d || null })} min={f.day} aria-label="Return by" className="input input-sm w-[8.5rem] tabular-nums" />
              <p className="text-meta text-fg-muted">Your own date. {v.dl?.returnBy ? `The rules give ${formatDate(v.dl.returnBy.day)}.` : 'No rule gives one.'}</p>
            </>
            : v.dl?.returnBy
              ? <DeadlineWords deadline={v.dl.returnBy} notes={v.dl.notes} />
              : <DeadlineWords deadline={null} notes={v.dl?.notes.length ? v.dl.notes : ['No return rule known for this store — set your own if it gives one.']} />}
        </DateFact>
        <DateFact label="Complain by" day={v.complainBy} today={today}>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Complaint years">
            {([2, 5] as const).map(y => (
              <ChoiceChip key={y} on={!f.keepComplain && !f.useReceiptComplain && v.years === y} onClick={() => set({ years: y, complainSet: true, keepComplain: false, useReceiptComplain: false })}>
                <span title={`${y} years${y === 5 ? ' — meant to last' : ''}${y === v.suggestedYears ? ' (suggested)' : ''}`}>{y} years{y === v.suggestedYears ? ' ✓' : ''}</span>
              </ChoiceChip>
            ))}
            {v.complainOwn && <ChoiceChip on={f.keepComplain && !f.useReceiptComplain} onClick={() => set({ keepComplain: true, complainSet: true, useReceiptComplain: false })}>Keep {formatDate(v.complainOwn)}</ChoiceChip>}
            {v.receiptWarranty && <ChoiceChip on={f.useReceiptComplain} onClick={() => set({ useReceiptComplain: true, complainSet: true, keepComplain: false })}>{formatDate(v.receiptWarranty)} (receipt)</ChoiceChip>}
          </div>
          {!f.keepComplain && !f.useReceiptComplain && <DeadlineWords deadline={v.dl?.complaintBy ?? null} />}
          <p className="text-meta text-fg-muted">5 years for things meant to last{v.suggestedYears === 5 ? ' — suggested for this one' : ''}.</p>
        </DateFact>
      </div>}

      <label className="flex flex-wrap items-center gap-2 text-meta font-medium text-fg-muted">
        Extra warranty until
        <DateInput value={f.extra} onChange={d => set({ extra: d })} min={f.day} aria-label="Extra warranty until" className="input input-sm w-[8.5rem] tabular-nums" />
        {v.receiptWarranty && f.extra !== v.receiptWarranty && <ChoiceChip on={false} onClick={() => set({ extra: v.receiptWarranty as string })}>{formatDate(v.receiptWarranty)} (receipt)</ChoiceChip>}
        <span className="font-normal">its price goes under Extra costs</span>
      </label>
      <div>
        <label htmlFor="receipt-note" className="field-label">Receipt <span className="font-normal text-fg-muted">(a note: order number, where it is)</span></label>
        <textarea id="receipt-note" value={f.note} onChange={e => set({ note: e.target.value })} rows={2} maxLength={NOTE_MAX} className="input resize-y" />
      </div>
    </div>
  )
}
