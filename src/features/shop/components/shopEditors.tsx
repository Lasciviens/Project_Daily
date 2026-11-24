import type { ReactNode } from 'react'
import { DecimalInput } from '../../recipes/components/foodLogKit'
import { SHOP_CURRENCIES } from '../shopModel'
import type { ShopCurrency } from '../types'

// The Shop's two small editors every sheet uses (the record's facts, Sell, a money chain's steps, the errand sheet):
// an amount with its currency and a yes/no line. The record's own fact parts are `record/factKit.tsx`.

/**
 * An amount with its currency, as one field: the number takes the room, the
 * currency is a small plain dropdown at its end (owner, 14.10.2026).
 */
export function MoneyEditor({ amount, currency, onAmount, onCurrency, label, autoFocus }: {
  amount: number | null
  currency: ShopCurrency
  onAmount: (v: number | null) => void
  onCurrency: (c: ShopCurrency) => void
  label: string
  autoFocus?: boolean
}) {
  return (
    <div className="flex min-h-[40px] w-full max-w-xs items-center rounded-input border border-line bg-surface-2 transition-[border-color,box-shadow] duration-100 focus-within:border-accent-500 focus-within:shadow-[0_0_0_3px_rgb(var(--accent-500)/0.18)] [@media(pointer:coarse)]:min-h-[44px]">
      <DecimalInput value={amount} onValue={onAmount} aria-label={label} placeholder="0" autoFocus={autoFocus}
        className="min-w-0 flex-1 self-stretch bg-transparent pl-3 text-body tabular-nums text-fg outline-none placeholder:text-fg-faint focus-visible:outline-none" />
      <select value={currency} onChange={e => onCurrency(e.target.value as ShopCurrency)} aria-label={`${label} currency`}
        className="my-1 mr-1 shrink-0 cursor-pointer rounded-control bg-transparent pl-1.5 text-meta font-semibold text-fg-muted outline-none hover:text-fg focus-visible:bg-surface-hover focus-visible:text-fg focus-visible:outline-none">
        {SHOP_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    </div>
  )
}

/** A yes/no fact as a checkbox line. */
export function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex min-h-[44px] items-center gap-2 text-body text-fg-2">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="h-[18px] w-[18px] shrink-0 accent-accent-500" />
      <span>{children}</span>
    </label>
  )
}
