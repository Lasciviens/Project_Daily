import { useId, useMemo, useState, type ReactNode } from 'react'
import { cx } from '../../../shared/ui'
import { useShopStores } from '../hooks/useShopStores'
import type { ShopStoreKind } from '../types'

/** A choice chip (a radio), picked or not: the one look for every Shop choice row (how it left, 2 / 5 years, online / in a shop). */
export function ChoiceChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick}
      className={cx('chip px-3', on ? 'border-accent-500 bg-accent-50 font-semibold text-accent-700' : 'hover:bg-surface-hover')}>
      {children}
    </button>
  )
}

/** A row of `ChoiceChip`s for one value. */
export function ChoiceChips<T extends string>({ value, options, onChange, label }: {
  value: T
  options: readonly { value: T; label: ReactNode }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
      {options.map(o => <ChoiceChip key={o.value} on={value === o.value} onClick={() => onChange(o.value)}>{o.label}</ChoiceChip>)}
    </div>
  )
}

const OTHER = '__other__'
const SHOPS: readonly ShopStoreKind[] = ['shop', 'marketplace', 'refurbisher']

/**
 * A store or marketplace as its name: picked from your Stores (`shop_stores`), so its rules match it, or typed
 * after "Somewhere else…". It still saves a name (the row's `platform`, `sold_to`, …), so nothing else changes.
 * `kinds` narrows the list (marketplaces and refurbishers for where a thing went); `typing` starts with the typed
 * name open (the quick list: a grocery store is seldom in Stores).
 */
export function StoreNameField({ value, onChange, kinds = SHOPS, label, placeholder, typing = false, className }: {
  value: string
  onChange: (name: string) => void
  kinds?: readonly ShopStoreKind[]
  label: string
  placeholder?: string
  typing?: boolean
  className?: string
}) {
  const id = useId()
  const { data: stores = [], isLoading } = useShopStores()
  const pickable = useMemo(
    () => stores.filter(s => !s.hidden && kinds.includes(s.kind)).sort((a, b) => a.name.localeCompare(b.name, 'en')),
    [stores, kinds],
  )
  const typed = value.trim().toLowerCase()
  const match = typed ? pickable.find(s => s.name.toLowerCase() === typed) : undefined
  const [otherMode, setOtherMode] = useState(typing)
  const other = otherMode || (!!typed && !match && !isLoading)
  const selectValue = match ? match.id : other ? OTHER : ''
  return (
    <div className={cx('flex min-w-0 flex-col gap-2', className)}>
      <select id={id} value={selectValue} aria-label={label} disabled={isLoading} className="select min-w-0"
        onChange={e => {
          const v = e.target.value
          if (v === OTHER) { setOtherMode(true); if (match) onChange(''); return }
          setOtherMode(false)
          onChange(v ? pickable.find(s => s.id === v)?.name ?? '' : '')
        }}>
        <option value="">{placeholder ?? 'Pick a store'}</option>
        {pickable.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        <option value={OTHER}>Somewhere else…</option>
      </select>
      {other && (
        <input value={value} onChange={e => onChange(e.target.value)} placeholder="Its name" aria-label={`${label} name`} className="input min-w-0" />
      )}
    </div>
  )
}
