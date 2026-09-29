import { useId, type ReactNode } from 'react'
import { Minus, Plus } from 'lucide-react'
import { BODY_TARGET_UNITS, type BodyTargetField } from '../../health/goal/goalSettings'

// Building blocks of the goal editor (DayTargetsEditor).

/** One titled group of the editor, with an optional one-line explanation. */
export function EditorSection({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
      <h3 className="section-label">{title}</h3>
      {children}
      {hint && <p className="text-meta text-fg-muted">{hint}</p>}
    </section>
  )
}

// −/+ stepper: targets move in meaningful steps (kcal by 50, protein by 10)
// instead of a native ±1 spinner; the field stays typeable. Clamped at 0.
export function GoalStepper({ label, value, step, suffix, onChange }: {
  label: string; value: number; step: number; suffix: string; onChange: (v: number) => void
}) {
  const set = (v: number) => onChange(Math.max(0, v))
  return (
    <div className="flex items-center gap-1">
      <button type="button" aria-label={`${label} −${step}`} onClick={() => set(value - step)} className="icon-btn-bordered">
        <Minus className="h-4 w-4" aria-hidden />
      </button>
      <div className="relative">
        <input
          type="number" value={value} min={0} step={step} aria-label={label}
          onChange={e => set(Number(e.target.value) || 0)}
          // The native spinner would duplicate the −/+ buttons flanking it.
          className="input w-24 pr-10 text-center tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-meta text-fg-muted">{suffix}</span>
      </div>
      <button type="button" aria-label={`${label} +${step}`} onClick={() => set(value + step)} className="icon-btn-bordered">
        <Plus className="h-4 w-4" aria-hidden />
      </button>
    </div>
  )
}

export function StepperRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-fg-2">{label}</span>
      {children}
    </div>
  )
}

export function Suggestion({ children, onApply }: { children: ReactNode; onApply: () => void }) {
  return (
    <button
      type="button" onClick={onApply}
      className="row row-interactive justify-between border border-accent-500/25 bg-accent-50 text-left text-meta"
    >
      <span className="text-fg-2">{children}</span>
      <span className="shrink-0 font-semibold text-accent-600">Apply</span>
    </button>
  )
}

const BODY_FIELDS: { key: BodyTargetField; label: string }[] = [
  { key: 'goalWeightKg', label: 'Weight' },
  { key: 'goalBodyFatPct', label: 'Body fat' },
  { key: 'goalMuscleMassKg', label: 'Muscle' },
]

/** Goal weight, body fat % and muscle mass as typed text (empty = not set). */
export function BodyTargetFields({ text, errors, now, onChange }: {
  text: Record<BodyTargetField, string>
  errors: Partial<Record<BodyTargetField, string>>
  /** Current values, shown as placeholders. */
  now: Partial<Record<BodyTargetField, number | null>>
  onChange: (field: BodyTargetField, value: string) => void
}) {
  const id = useId()
  return (
    <div className="grid grid-cols-3 gap-2">
      {BODY_FIELDS.map(f => {
        const unit = BODY_TARGET_UNITS[f.key]
        const cur = now[f.key]
        return (
          <div key={f.key} className="min-w-0">
            <label htmlFor={`${id}-${f.key}`} className="field-label">{f.label} ({unit})</label>
            <input id={`${id}-${f.key}`} type="text" inputMode="decimal" autoComplete="off"
              value={text[f.key]} placeholder={cur != null ? `now ${cur.toFixed(1)}` : 'not set'}
              onChange={e => onChange(f.key, e.target.value.replace(/[^\d.,]/g, ''))}
              aria-invalid={errors[f.key] ? true : undefined}
              aria-describedby={errors[f.key] ? `${id}-${f.key}-err` : undefined}
              className="input mt-1 w-full tabular-nums" />
            {errors[f.key] && <p id={`${id}-${f.key}-err`} className="mt-1 text-meta text-danger">{errors[f.key]}</p>}
          </div>
        )
      })}
    </div>
  )
}
