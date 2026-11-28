// A choice drawn as a chip inside an editor (Repeat's kind, its unit, a cost's currency): the shared field list
// (FieldSelect). Its own file: fields.tsx (used by other screens' sheets too) takes it without the item screen's rows.

import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { FieldSelect, type FieldChoice } from '../FieldSelect'
import { chipClass } from './fieldStyles'

export function SelectChip<T extends string>({ label, value, options, onChange, icon, disabled }: {
  label: string
  value: T
  options: readonly FieldChoice<T>[]
  onChange: (value: T) => void
  icon?: ReactNode
  disabled?: boolean
}) {
  return (
    <FieldSelect label={label} value={value} options={options} onChange={onChange} disabled={disabled} align="start"
      buttonClassName={chipClass('set', 'pr-2 data-[open]:bg-surface-hover')}>
      {choice => <>{icon}{choice?.label ?? value}<ChevronDown className="text-fg-faint" aria-hidden /></>}
    </FieldSelect>
  )
}

