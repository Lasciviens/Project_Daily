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
    <div className={cx('rounded-row', open && 'bg-surface-2 p-2')}>
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
          <button type="button" onClick={onDone} aria-label={`Done with ${label}`} title="Done" className="icon-btn shrink-0 text-accent-600">
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

/** An amount with its currency. */
export function MoneyEditor({ amount, currency, onAmount, onCurrency, label, autoFocus }: {
  amount: number | null
  currency: ShopCurrency
  onAmount: (v: number | null) => void
  onCurrency: (c: ShopCurrency) => void
  label: string
  autoFocus?: boolean
}) {
  return (
    <div className="flex max-w-xs gap-2">
      <DecimalInput value={amount} onValue={onAmount} aria-label={label} placeholder="0" autoFocus={autoFocus} className="input min-w-0 flex-1 tabular-nums" />
      <select value={currency} onChange={e => onCurrency(e.target.value as ShopCurrency)} aria-label={`${label} currency`} className="select w-[6.5rem] shrink-0">
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
