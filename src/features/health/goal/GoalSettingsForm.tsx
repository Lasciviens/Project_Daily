import { useId, useState } from 'react'
import { Button } from '../../../shared/ui'
import { DateInput } from '../../../shared/components/DateInput'
import { todayStr } from '../../../shared/utils/dateUtils'
import { GOAL_LIMITS, validGoal, type GoalSettings } from './goalSettings'

type NumField = keyof typeof GOAL_LIMITS

const FIELDS: { key: NumField; label: string; unit: string }[] = [
  { key: 'goalWeightKg', label: 'Goal weight', unit: 'kg' },
  { key: 'goalBodyFatPct', label: 'Goal body fat', unit: '%' },
  { key: 'goalMuscleMassKg', label: 'Goal muscle mass', unit: 'kg' },
]

const text = (v: number | null) => (v != null ? String(v) : '')

/** The three body goals and the phase start, as one draft saved together. */
export function GoalSettingsForm({ settings, now, saving, onSave, onCancel }: {
  settings: GoalSettings
  /** Current values, shown as placeholders. */
  now: Partial<Record<NumField, number | null>>
  saving: boolean
  onSave: (next: GoalSettings) => void
  onCancel: () => void
}) {
  const id = useId()
  const [draft, setDraft] = useState<Record<NumField, string>>({
    goalWeightKg: text(settings.goalWeightKg), goalBodyFatPct: text(settings.goalBodyFatPct), goalMuscleMassKg: text(settings.goalMuscleMassKg),
  })
  const [start, setStart] = useState(settings.phaseStartDate ?? '')
  const [errors, setErrors] = useState<Partial<Record<NumField, string>>>({})

  function submit() {
    const next: Partial<Record<NumField, string>> = {}
    const values = {} as Record<NumField, number | null>
    for (const f of FIELDS) {
      const raw = draft[f.key].trim()
      values[f.key] = raw === '' ? null : validGoal(f.key, raw)
      if (raw !== '' && values[f.key] == null) next[f.key] = `Between ${GOAL_LIMITS[f.key].min} and ${GOAL_LIMITS[f.key].max} ${f.unit}`
    }
    setErrors(next)
    if (Object.keys(next).length) return
    onSave({ goalWeightKg: values.goalWeightKg, goalBodyFatPct: values.goalBodyFatPct, goalMuscleMassKg: values.goalMuscleMassKg, phaseStartDate: start || null })
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={e => { e.preventDefault(); submit() }}>
      <div className="grid grid-cols-2 gap-3 @lg:grid-cols-4">
        {FIELDS.map(f => (
          <div key={f.key} className="min-w-0">
            <label htmlFor={`${id}-${f.key}`} className="field-label">{f.label} ({f.unit})</label>
            <input id={`${id}-${f.key}`} type="text" inputMode="decimal" autoComplete="off"
              value={draft[f.key]} placeholder={now[f.key] != null ? `now ${(now[f.key] as number).toFixed(1)}` : 'not set'}
              onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value.replace(/[^\d.,]/g, '') }))}
              aria-invalid={errors[f.key] ? true : undefined}
              aria-describedby={errors[f.key] ? `${id}-${f.key}-err` : undefined}
              className="input mt-1 w-full max-w-[9rem] tabular-nums" />
            {errors[f.key] && <p id={`${id}-${f.key}-err`} className="mt-1 text-meta text-danger">{errors[f.key]}</p>}
          </div>
        ))}
        <div className="min-w-0">
          <p className="field-label" aria-hidden>Phase started</p>
          <div className="mt-1">
            <DateInput value={start} onChange={setStart} max={todayStr()} aria-label="Phase start date"
              className="input w-full max-w-[9rem]" placeholder="DD/MM/YYYY" />
          </div>
        </div>
      </div>
      <p className="text-meta text-fg-muted">
        Leave a field empty to clear it. Muscle mass is the scale report&apos;s muscle % × weight, not lean mass. The phase start is
        the baseline for progress, and the first weeks of a cut or gain get a water note.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" size="sm" loading={saving}>Save goals</Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}
