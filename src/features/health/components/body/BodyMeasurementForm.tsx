import { useState } from 'react'
import { Droplet, Scale } from 'lucide-react'
import { ModalShell } from '../../../../shared/modals'
import { Button } from '../../../../shared/ui'
import { toast } from '../../../../app/store'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { DateInput } from '../../../../shared/components/DateInput'
import { useHevyBodyMeasurementForDate, useUpsertBodyMeasurement } from '../../../training/hooks/useHevyBodyMeasurements'
import { sanitizeDecimal } from '../../../training/routineForm'
import {
  ALL_FIELDS, DETAIL_FIELDS, HERO_FIELDS, buildMeasurementPayload, fmtMeasDate,
  type MeasKey, type MeasurementValues,
} from '../../../training/bodyMeasurementFields'
import { useLatestBodyweight } from '../../hooks/useBodyweight'
import { BODYWEIGHT_SOURCE_LABEL } from '../../bodyweight'
import { MeasurementFieldGrid } from './MeasurementFieldGrid'

// ─── Log/Edit a Hevy body measurement (the `body-measurement` popup) ─────────
// Moved here from Training → Log → Body. The request carries a DATE, never a
// row: the form always shows what is stored for its date, read fresh. Picking
// another date REPLACES every field the user hasn't typed into with that
// date's stored values. Clearing a stored value and saving clears it
// (hevy-api's merge treats an explicit null as "clear"). Editing an existing
// day keeps its date fixed — changing it would create a second day and leave
// the original behind.

const EMPTY = Object.fromEntries(ALL_FIELDS.map(f => [f.key, ''])) as MeasurementValues

function valuesFrom(row: Partial<Record<MeasKey, number | null>> | null | undefined): MeasurementValues {
  const out = { ...EMPTY }
  for (const f of ALL_FIELDS) out[f.key] = row?.[f.key] != null ? String(row[f.key]) : ''
  return out
}

/** `fixedDate` edits that day; without it the form logs a new day (today by default). */
export function BodyMeasurementForm({ fixedDate, onClose }: { fixedDate?: string; onClose: () => void }) {
  const upsert = useUpsertBodyMeasurement()
  const [date, setDate] = useState(fixedDate ?? todayStr())
  const [values, setValues] = useState<MeasurementValues>(EMPTY)
  const [touched, setTouched] = useState<ReadonlySet<MeasKey>>(() => new Set())

  const storedQ = useHevyBodyMeasurementForDate(date)
  const storedReady = storedQ.isSuccess && !storedQ.isPlaceholderData
  const stored = storedReady ? storedQ.data : null

  // Adjust-during-render: once the stored row for this date is known, show it
  // in every field the user hasn't typed into.
  const loadedKey = storedReady ? `${date}|${stored?.updated_at ?? 'none'}` : ''
  const [appliedKey, setAppliedKey] = useState('')
  if (loadedKey && loadedKey !== appliedKey) {
    setAppliedKey(loadedKey)
    const fresh = valuesFrom(stored)
    setValues(v => {
      const next = { ...v }
      for (const f of ALL_FIELDS) if (!touched.has(f.key)) next[f.key] = fresh[f.key]
      return next
    })
  }

  // The newest weight from another source (the smart scale via Apple Health,
  // or its photo report), offered as a one-tap fill.
  const { data: latest } = useLatestBodyweight()
  const suggestion = latest && latest.source !== 'hevy' ? latest : null

  function setVal(key: MeasKey, val: string) {
    setValues(v => ({ ...v, [key]: sanitizeDecimal(val) }))
    setTouched(t => (t.has(key) ? t : new Set(t).add(key)))
  }

  async function handleSave() {
    const { payload, error } = buildMeasurementPayload(date, values, stored)
    if (error) { toast.error(error); return }
    try { await upsert.mutateAsync(payload); onClose() } catch { return }
  }

  const status = !storedReady && !storedQ.isError
    ? 'Loading what is stored for this date…'
    : storedQ.isError
      ? 'Couldn’t load what is stored for this date — only the values you type will change.'
      : stored ? 'Showing what is stored for this date. Clear a field to remove that value.' : 'Nothing stored for this date yet.'

  return (
    <ModalShell
      onClose={onClose}
      title={fixedDate ? 'Edit measurement' : 'Log measurement'}
      subtitle="Saved to Hevy"
      size="md"
      dismissible={!upsert.isPending}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button onClick={onClose} className="w-full sm:w-auto">Cancel</Button>
          <Button variant="primary" onClick={handleSave} loading={upsert.isPending} disabled={!date || (!storedReady && !storedQ.isError)} className="w-full sm:w-auto">
            Save measurement
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <label className="field-label">Date</label>
          {fixedDate
            ? <p className="text-body font-semibold text-fg-2">{fmtMeasDate(date)}</p>
            : <DateInput value={date} onChange={d => { setDate(d); setAppliedKey('') }} className="input w-full max-w-xs" />}
          <p className="mt-1 text-meta text-fg-muted">{status}</p>
        </div>

        {suggestion && (
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setVal('weight_kg', String(Math.round(suggestion.kg * 10) / 10))}
              className="pill-tab border border-accent-200 bg-accent-50 px-3 text-meta text-accent-700">
              <Scale className="h-3.5 w-3.5" aria-hidden />
              {Math.round(suggestion.kg * 10) / 10} kg <span className="text-fg-muted">({fmtMeasDate(suggestion.date)} · {BODYWEIGHT_SOURCE_LABEL[suggestion.source]})</span>
            </button>
            {suggestion.fatPct != null && (
              <button type="button" onClick={() => setVal('fat_percent', String(Math.round((suggestion.fatPct as number) * 10) / 10))}
                className="pill-tab border border-accent-200 bg-accent-50 px-3 text-meta text-accent-700">
                <Droplet className="h-3.5 w-3.5" aria-hidden />
                {Math.round(suggestion.fatPct * 10) / 10}% fat
              </button>
            )}
          </div>
        )}

        <MeasurementFieldGrid label="Main measurements" fields={HERO_FIELDS} values={values} onChange={setVal} withUnit />
        <MeasurementFieldGrid label="Body circumferences (cm)" fields={DETAIL_FIELDS} values={values} onChange={setVal} />
      </div>
    </ModalShell>
  )
}
