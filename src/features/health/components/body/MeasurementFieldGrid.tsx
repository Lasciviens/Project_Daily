import type { FieldDef, MeasKey, MeasurementValues } from '../../../training/bodyMeasurementFields'

export function MeasurementFieldGrid({ label, fields, values, onChange, withUnit }: {
  label: string
  fields: FieldDef[]
  values: MeasurementValues
  onChange: (key: MeasKey, val: string) => void
  withUnit?: boolean
}) {
  return (
    <fieldset>
      <legend className="field-label">{label}</legend>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {fields.map(f => (
          <label key={f.key} className="block">
            <span className="mb-1 block text-meta text-fg-2">{f.label}{withUnit ? ` (${f.unit})` : ''}</span>
            <input
              type="text"
              inputMode="decimal"
              value={values[f.key]}
              onChange={e => onChange(f.key, e.target.value)}
              placeholder="—"
              className="input w-full"
            />
          </label>
        ))}
      </div>
    </fieldset>
  )
}
