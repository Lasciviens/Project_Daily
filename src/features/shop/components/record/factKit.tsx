import type { ReactNode } from 'react'
import { Check, Pencil, Plus } from 'lucide-react'
import { cx } from '../../../../shared/ui'
import { DecimalInput } from '../../../recipes/components/foodLogKit'
import { SHOP_CURRENCIES } from '../../shopModel'
import type { ShopCurrency } from '../../types'

// A record's facts read as text; tapping one turns it into its editor (one at
// a time), and a filled fact is never more than a tap from changing.

export function Fact({ id, label, value, editing, onEdit, onDone, children, hint }: {
  id: string
  label: string
  /** The fact as text. */
  value: ReactNode
  editing: string | null
  onEdit: (id: string) => void
  onDone: () => void
  /** The editor, shown while this fact is being edited. */
  children?: ReactNode
  hint?: ReactNode
}) {
  const open = editing === id && children != null
  return (
    // Open, the tint reaches past the row (-mx-2 px-2) so the label and the
    // Done tick stay where the label and the pen were.
    <div className={cx('rounded-row', open && '-mx-2 bg-surface-2 px-2 py-2')}>
      <div className="flex items-start gap-2">
        <span className="w-[8.5rem] shrink-0 pt-[11px] text-meta text-fg-muted max-[380px]:w-[6.5rem]">{label}</span>
        {open ? (
          <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">{children}</div>
        ) : (
          <button type="button" onClick={() => children != null && onEdit(id)} disabled={children == null}
            className="group flex min-h-[44px] min-w-0 flex-1 items-center gap-2 rounded-row px-1 text-left text-body text-fg enabled:hover:bg-surface-hover">
            <span className="min-w-0 flex-1 break-words">{value}</span>
            {children != null && <Pencil aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-faint opacity-60 group-hover:opacity-100" />}
          </button>
        )}
        {open && (
          <button type="button" onClick={onDone} aria-label={`Done with ${label}`} title="Done" className="icon-btn -mr-2.5 shrink-0 text-accent-600">
            <Check aria-hidden className="h-4 w-4" />
          </button>
        )}
      </div>
      {hint && !open && <p className="ml-[8.5rem] pl-1 text-meta text-fg-faint max-[380px]:ml-[6.5rem]">{hint}</p>}
    </div>
  )
}

/** The facts not filled yet, as "+" chips: a tap adds the fact and opens its editor. */
export function FactChips({ chips }: { chips: { id: string; label: string; onAdd: () => void }[] }) {
  if (!chips.length) return null
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {chips.map(c => (
        <button key={c.id} type="button" onClick={c.onAdd} className="chip min-h-[44px] gap-1 text-fg-muted hover:bg-surface-hover hover:text-fg-2">
          <Plus aria-hidden className="h-3 w-3" /> {c.label}
        </button>
      ))}
    </div>
  )
}

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
