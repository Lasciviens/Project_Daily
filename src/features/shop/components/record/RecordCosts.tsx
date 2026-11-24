import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button, CardHeader, Truncate, cx } from '../../../../shared/ui'
import { REBATE_LABEL } from '../../complaintModel'
import { DateInput } from '../../../../shared/components/DateInput'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { formatMoney } from '../../../settings/subscriptionRules'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { useCreateShopCost, useDeleteShopCost } from '../../hooks/useShopMoney'
import { add, complete, nokAt } from '../../ownModel'
import { AmountText } from '../shopKit'
import { money } from '../shopFormat'
import { MoneyEditor, Toggle } from '../shopEditors'
import type { ShopCurrency, ShopItemCost } from '../../types'
import type { DraftCost } from './createDraft'

/**
 * Repairs, shipping, fees, AppleCare — or money back (a rebate) — each with its own day and rate: the one body's Extra costs in
 * every mode. A saved thing (`itemId`) lists and adds its saved costs; a thing being added or a purchase being saved lists its
 * DRAFT costs (a read receipt's, ticked unless the owner unticks one; a typed one while adding), written with its Save.
 */
export function RecordCosts({ itemId, costs = [], drafts, onDrafts, canAdd = true, moveTo }: {
  itemId?: string
  costs?: readonly ShopItemCost[]
  drafts?: readonly DraftCost[]
  onDrafts?: (next: DraftCost[]) => void
  /** Whether a cost can be typed here (Just bought writes only the receipt's own). */
  canAdd?: boolean
  /** Several drafts at once (a receipt's lines): the draft a cost goes with, picked on its own line. */
  moveTo?: { current: number; options: { value: number; label: string }[]; onMove: (id: string, to: number) => void }
}) {
  const create = useCreateShopCost()
  const remove = useDeleteShopCost()
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState<number | null>(null)
  const [currency, setCurrency] = useState<ShopCurrency>('NOK')
  const [day, setDay] = useState(todayStr())
  const [back, setBack] = useState(false)
  const total = add(...costs.map(c => nokAt(c.amount, c.currency, c.fx_nok)))

  function save() {
    if (!label.trim() || !amount) return
    if (!itemId) {
      // Typed while adding: a draft like the receipt's, written with the thing.
      onDrafts?.([...(drafts ?? []), { id: `t:${Date.now()}`, kind: 'fee', label: label.trim(), amount: back ? -amount : amount, currency, on: true }])
      setOpen(false); setLabel(''); setAmount(null); setBack(false)
      return
    }
    create.mutate({ item_id: itemId, label: label.trim(), amount: back ? -amount : amount, currency, spent_on: day }, {
      onSuccess: () => { setOpen(false); setLabel(''); setAmount(null); setBack(false) },
    })
  }

  return (
    <div>
      <CardHeader title="Extra costs" variant="label" className="mb-1"
        subtitle={costs.length > 0 ? <>in all <AmountText amount={total} /></> : undefined}
        action={!open && canAdd && <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setOpen(true)} tip="Cost — add an extra cost">Cost</Button>} />
      {drafts && drafts.length > 0 && (
        <ul aria-label="Extra costs to save" className="flex flex-col">
          {drafts.map(c => (
            <li key={c.id} className="flex items-center gap-2">
              <Toggle checked={c.on} onChange={x => onDrafts?.(drafts.map(k => (k.id === c.id ? { ...k, on: x } : k)))}>
                <span className="min-w-0">{c.label} · <span className={cx('tabular-nums', c.amount < 0 && 'text-success')}>{formatMoney(c.amount, c.currency)}</span></span>
              </Toggle>
              {moveTo && moveTo.options.length > 1 && (
                <select value={moveTo.current} onChange={e => moveTo.onMove(c.id, Number(e.target.value))} className="select input-sm ml-auto w-auto min-w-0 max-w-[45%] shrink" aria-label={`Attach ${c.label} to`}>
                  {moveTo.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )}
            </li>
          ))}
        </ul>
      )}
      {costs.length === 0 && !drafts?.length && !open && canAdd && <p className="text-meta text-fg-muted">A repair, shipping, a fee, insurance — or money back. They count in what it cost you.</p>}
      {costs.length > 0 && (
        <ul className="-mx-2 flex flex-col">
          {costs.map(c => {
            const nok = nokAt(c.amount, c.currency, c.fx_nok)
            return (
              <li key={c.id} className="flex min-h-[44px] items-center gap-2 px-2">
                <span className="min-w-0 flex-1">
                  <Truncate as="span" className="block text-body text-fg-2">{c.label}</Truncate>
                  <span className="block text-meta text-fg-muted">{formatDate(c.spent_on)}</span>
                </span>
                <span className="shrink-0 text-right text-meta tabular-nums text-fg-2">
                  {money(c.amount, c.currency)}
                  {c.currency !== 'NOK' && <span className="block text-fg-muted">{complete(nok) ? `≈ ${money(nok.nok)}` : 'NOK rate missing'}</span>}
                </span>
                <button type="button" onClick={() => void remove.run([c.id], { title: `Remove “${c.label}”?`, confirmLabel: 'Remove', done: `Removed ${c.label}` })} aria-label={`Remove ${c.label}`} className="icon-btn shrink-0 text-fg-faint hover:!text-danger">
                  <X aria-hidden className="h-4 w-4" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {open && (
        <div className="mt-2 flex flex-col gap-2 rounded-row bg-surface-2 p-2">
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Screen repair, shipping, AppleCare…" aria-label="What for" className="input" autoFocus />
          <MoneyEditor label="Amount" amount={amount} currency={currency} onAmount={setAmount} onCurrency={setCurrency} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {/* A draft cost takes the thing's own day when it is saved. */}
            {itemId && <DateInput value={day} onChange={d => d && setDay(d)} aria-label="On" className="input w-[10rem] tabular-nums" />}
            <Toggle checked={back} onChange={setBack}>Money back (a rebate)</Toggle>
          </div>
          {back && (
            <div className="flex flex-wrap items-center gap-1.5 text-meta text-fg-muted">
              {/* Stats counts a price match or a claim as saved by watching, by these labels. */}
              For:
              {(['match', 'claim'] as const).map(k => (
                <button key={k} type="button" onClick={() => setLabel(REBATE_LABEL[k])} aria-pressed={label === REBATE_LABEL[k]}
                  className={cx('chip', label === REBATE_LABEL[k] && 'text-accent-600')}>{k === 'match' ? 'Price match' : 'Complaint'}</button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={save} loading={create.isPending} disabled={!label.trim() || !amount}>Add</Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  )
}
