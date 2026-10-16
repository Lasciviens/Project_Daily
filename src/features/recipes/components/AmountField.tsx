import { useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { IconButton, cx } from '../../../shared/ui'
import { sanitizeDecimal } from './foodLogUtils'
import { choiceClass } from '../../../shared/components/plan-modal/fieldStyles'
import { ChipSelect } from '../../../shared/components/plan-modal/fields'
import {
  amountChips, amountHint, amountText, fromUnit, stepValue, toUnit, unitOf,
  type AmountModel, type AmountUnitId, type BatchState,
} from '../foodAmount'

// The one amount control (Food point 8.2): − / a typeable box / the unit / +,
// the same amount in the other main unit on the right ("= ½ portion"), and
// preset chips under it that follow the unit. Used by the portion sheet,
// Edit entry and RecipeDetail's "I ate this". The parent owns the stored
// amount (grams / ml / servings, the "base"); the unit is only how it is
// typed and read (foodAmount.ts).

interface Props {
  model: AmountModel
  /** The stored amount: grams / ml for a food, servings for a recipe. */
  value: number
  onChange: (base: number) => void
  /** The amount eaten last time (base), offered as a chip. */
  last?: number | null
  /** A recipe's current batch: adds "The rest". */
  batch?: BatchState | null
  /** The field's label on the left ("Amount"); none = no label column. */
  label?: string
  id?: string
}

export function AmountField({ model, value, onChange, last, batch, label, id = 'amount-field' }: Props) {
  const [unitId, setUnitId] = useState<AmountUnitId>(model.start)
  const unit = unitOf(model, unitId)
  // What is typed, kept as typed ("1." / "0.") while it means `textFor`.
  const [text, setText] = useState(() => amountText(toUnit(unit, value)))
  const [textFor, setTextFor] = useState({ value, unit: unit.id })
  if (textFor.value !== value || textFor.unit !== unit.id) {
    setTextFor({ value, unit: unit.id })
    setText(amountText(toUnit(unit, value)))
  }

  function type(raw: string) {
    const t = sanitizeDecimal(raw)
    const base = t === '' ? 0 : fromUnit(unit, Number(t) || 0)
    setText(t)
    setTextFor({ value: base, unit: unit.id })
    onChange(base)
  }
  const step = (dir: 1 | -1) => onChange(fromUnit(unit, stepValue(unit, toUnit(unit, value), dir)))

  const chips = amountChips(model, unit.id, { last, batch })
  const hint = amountHint(model, unit.id, value)
  const invalid = !(value > 0)

  return (
    <div className="flex flex-col gap-1.5">
      {/* One row; the "= …" hint drops under it only when the row has no room. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {label && <label htmlFor={id} className="field-label mb-0 w-14 shrink-0 max-sm:sr-only">{label}</label>}
        <div className="flex shrink-0 items-center gap-1">
          <IconButton label={`Less (${unit.label})`} bordered className="h-8 w-8 [&_svg]:!h-4 [&_svg]:!w-4" onClick={() => step(-1)} disabled={invalid}><Minus /></IconButton>
          <input id={id} value={text} onChange={e => type(e.target.value)} inputMode="decimal" aria-invalid={invalid}
            aria-label={label ? undefined : `Amount in ${unit.label}`}
            className={cx('input input-sm h-8 w-16 px-1.5 text-right tabular-nums', invalid && 'border-danger')} />
          {/* The unit as a chip over an invisible native select (THEME §8): sized to the choice, the phone's own picker. */}
          {model.units.length > 1
            ? <ChipSelect label="Unit" value={unit.id} options={model.units.map(u => ({ value: u.id, label: u.label }))} onChange={setUnitId} />
            : <span className="px-1 text-body text-fg-muted">{unit.label}</span>}
          <IconButton label={`More (${unit.label})`} bordered className="h-8 w-8 [&_svg]:!h-4 [&_svg]:!w-4" onClick={() => step(1)}><Plus /></IconButton>
        </div>
        {hint && <span className="ml-auto whitespace-nowrap text-meta text-fg-muted tabular-nums">{hint}</span>}
      </div>
      {chips.length > 0 && (
        <div className={cx('flex flex-wrap gap-1.5', label && 'sm:pl-16')}>
          {chips.map(c => {
            const on = Math.abs(c.base - value) < 1e-6
            return (
              <button key={c.label} type="button" onClick={() => onChange(c.base)} aria-pressed={on} className={choiceClass(on, undefined, 'sm')}>
                {c.label}{c.hint && <span className={on ? 'opacity-80' : 'text-fg-muted'}>{c.hint}</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
