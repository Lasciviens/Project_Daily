import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button, Card, CardHeader, Truncate } from '../../../../shared/ui'
import { DateInput } from '../../../../shared/components/DateInput'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { useCreateShopCost, useDeleteShopCost } from '../../hooks/useShopMoney'
import { add, complete, nokAt } from '../../ownModel'
import { AmountText } from '../shopKit'
import { money } from '../shopFormat'
import { MoneyEditor, Toggle } from './factKit'
import type { ShopCurrency, ShopItemCost } from '../../types'

/** Repairs, shipping, fees, AppleCare — or money back (a rebate) — each with its own day and rate. */
export function RecordCosts({ itemId, costs }: { itemId: string; costs: readonly ShopItemCost[] }) {
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
    create.mutate({ item_id: itemId, label: label.trim(), amount: back ? -amount : amount, currency, spent_on: day }, {
      onSuccess: () => { setOpen(false); setLabel(''); setAmount(null); setBack(false) },
    })
  }

  return (
    <Card>
      <CardHeader title="Extra costs" variant="label" className="mb-1"
        subtitle={costs.length > 0 ? <>in all <AmountText amount={total} /></> : undefined}
        action={!open && <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setOpen(true)}>Cost</Button>} />
      {costs.length === 0 && !open && <p className="text-meta text-fg-muted">A repair, shipping, a fee, insurance — or money back. They count in what it cost you.</p>}
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
                  {c.currency !== 'NOK' && <span className="block text-fg-faint">{complete(nok) ? `≈ ${money(nok.nok)}` : 'rate pending'}</span>}
                </span>
                <button type="button" onClick={() => remove.mutate(c.id)} aria-label={`Remove ${c.label}`} className="icon-btn shrink-0 text-fg-faint hover:!text-danger">
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
            <DateInput value={day} onChange={d => d && setDay(d)} aria-label="On" className="input w-[10rem] tabular-nums" />
            <Toggle checked={back} onChange={setBack}>Money back (a rebate)</Toggle>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={save} loading={create.isPending} disabled={!label.trim() || !amount}>Add</Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </Card>
  )
}
