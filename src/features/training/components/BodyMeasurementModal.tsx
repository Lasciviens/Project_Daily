import { useState, useMemo } from 'react'
import { Droplet, Scale } from 'lucide-react'
import { ModalShell } from '../../../shared/modals'
import { Button } from '../../../shared/ui'
import { useUpsertBodyMeasurement } from '../hooks/useHevyBodyMeasurements'
import { useHealthMetricSeries } from '../hooks/useHealthExport'
import { computeDailySeries } from '../healthAggregate'
import { todayStr, daysAgoStr } from '../../../shared/utils/dateUtils'
import { DateInput } from '../../../shared/components/DateInput'
import { ALL_FIELDS, DETAIL_FIELDS, HERO_FIELDS, fmtMeasDate, type FieldDef, type MeasKey } from '../bodyMeasurementFields'
import type { HevyBodyMeasurement } from '../types.hevy'

// ─── Log/Edit Measurement Modal ───────────────────────────────────────────────

type FormValues = Record<MeasKey, string>

function blankForm(initial?: HevyBodyMeasurement): { date: string; values: FormValues } {
  const base: FormValues = {} as FormValues
  for (const f of ALL_FIELDS) {
    base[f.key] = initial && initial[f.key] != null ? String(initial[f.key]) : ''
  }
  return { date: initial ? initial.date : todayStr(), values: base }
}

// Numeric-only text sanitizer: digits + at most one decimal separator (a
// typed comma becomes a dot). Used on every measurement field so nothing
// non-numeric can be entered on web either — and paired with
// inputMode="decimal" so phones open the numeric keypad directly.
function sanitizeDecimal(raw: string): string {
  const cleaned = raw.replace(',', '.').replace(/[^0-9.]/g, '')
  const firstDot = cleaned.indexOf('.')
  return firstDot === -1
    ? cleaned
    : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
}

interface MeasurementModalProps {
  isOpen:   boolean
  onClose:  () => void
  initial?: HevyBodyMeasurement
  /** All known measurements, so picking a date that already has a row
      prefills its values — the user then sees exactly what a save will
      keep/replace instead of blindly overlaying a day they can't see. */
  existing?: HevyBodyMeasurement[]
}

export function MeasurementModal({ isOpen, onClose, initial, existing = [] }: MeasurementModalProps) {
  const upsert = useUpsertBodyMeasurement()
  const [form, setForm] = useState(() => blankForm(initial))

  // When the selected date has a stored measurement, load its values into
  // fields the user hasn't typed into (adjust-during-render pattern; typed
  // values are never clobbered — this only fills blanks). Starts at '' so
  // the initial date (today) prefills on first open too.
  const [loadedDate, setLoadedDate] = useState('')
  if (form.date !== loadedDate) {
    setLoadedDate(form.date)
    const row = existing.find(m => m.date === form.date)
    if (row) {
      setForm(f => {
        const values = { ...f.values }
        for (const fd of ALL_FIELDS) {
          if (values[fd.key] === '' && row[fd.key] != null) values[fd.key] = String(row[fd.key])
        }
        return { ...f, values }
      })
    }
  }

  // Latest known weight/body-fat from Apple Health (Watch/manual scale syncs
  // arrive there daily) — offered as one-tap suggestion chips so the values
  // the app already knows don't have to be retyped. 60-day window, newest
  // day wins; 'latest'-aggregated like the Body health section.
  const today = todayStr()
  const { data: weightPts = [] } = useHealthMetricSeries('weight_body_mass', daysAgoStr(59), today)
  const { data: fatPts = [] }    = useHealthMetricSeries('body_fat_percentage', daysAgoStr(59), today)
  const suggestions = useMemo(() => {
    const lastOf = (metric: string, pts: typeof weightPts) => {
      const series = computeDailySeries(metric, pts)
      return series.length ? series[series.length - 1] : null
    }
    const w = lastOf('weight_body_mass', weightPts)
    const f = lastOf('body_fat_percentage', fatPts)
    return {
      weight: w ? { value: Math.round(w.value * 10) / 10, date: w.date } : null,
      fat:    f ? { value: Math.round(f.value * 10) / 10, date: f.date } : null,
    }
  }, [weightPts, fatPts])

  function setVal(key: MeasKey, val: string) {
    setForm(f => ({ ...f, values: { ...f.values, [key]: sanitizeDecimal(val) } }))
  }

  async function handleSave() {
    // Only the fields actually filled in go into the payload — Hevy 400s on
    // null fields ("Expected number, received null"), which is why saving
    // used to fail no matter what was entered. Omitting the blanks makes
    // partial entry work exactly as intended ("eksik girdiysem eksik
    // kaydet"). The DB row still gets nulls for the omitted columns.
    const payload: Record<string, unknown> = { date: form.date }
    for (const f of ALL_FIELDS) {
      const raw = form.values[f.key]
      if (raw === '' || raw === '.') continue
      const n = Number(raw)
      if (Number.isFinite(n)) payload[f.key] = n
    }
    try {
      await upsert.mutateAsync(payload)
      onClose()
    } catch {
      return
    }
  }

  return (
    <ModalShell
      open={isOpen}
      onClose={onClose}
      title={initial ? 'Edit measurement' : 'Log measurement'}
      size="md"
      dismissible={!upsert.isPending}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button onClick={onClose} className="w-full sm:w-auto">Cancel</Button>
          <Button variant="primary" onClick={handleSave} loading={upsert.isPending} disabled={!form.date} className="w-full sm:w-auto">
            Save measurement
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <label className="field-label">Date</label>
          <DateInput
            value={form.date}
            onChange={v => setForm(f => ({ ...f, date: v }))}
            className="input w-full max-w-xs"
          />
        </div>

        {/* One-tap suggestions from data the app already has (Apple
            Health) — tap to fill, then adjust/complete the rest. */}
        {(suggestions.weight || suggestions.fat) && (
          <div className="flex flex-wrap gap-1.5">
            {suggestions.weight && (
              <button
                type="button"
                onClick={() => setVal('weight_kg', String(suggestions.weight!.value))}
                className="pill-tab border border-accent-200 bg-accent-50 px-3 text-meta text-accent-700"
              >
                <Scale className="h-3.5 w-3.5" aria-hidden />
                {suggestions.weight.value} kg <span className="text-fg-muted">({fmtMeasDate(suggestions.weight.date)})</span>
              </button>
            )}
            {suggestions.fat && (
              <button
                type="button"
                onClick={() => setVal('fat_percent', String(suggestions.fat!.value))}
                className="pill-tab border border-accent-200 bg-accent-50 px-3 text-meta text-accent-700"
              >
                <Droplet className="h-3.5 w-3.5" aria-hidden />
                {suggestions.fat.value}% fat <span className="text-fg-muted">({fmtMeasDate(suggestions.fat.date)})</span>
              </button>
            )}
          </div>
        )}

        <MeasurementFieldGrid label="Main measurements" fields={HERO_FIELDS} values={form.values} onChange={setVal} withUnit />
        <MeasurementFieldGrid label="Body circumferences (cm)" fields={DETAIL_FIELDS} values={form.values} onChange={setVal} />
      </div>
    </ModalShell>
  )
}

function MeasurementFieldGrid({ label, fields, values, onChange, withUnit }: {
  label: string
  fields: FieldDef[]
  values: FormValues
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
