import { useState } from 'react'
import { useHevyBodyMeasurements } from '../hooks/useHevyBodyMeasurements'
import type { HevyBodyMeasurement } from '../types.hevy'

function fmt(val: number | null, unit = 'kg'): string {
  if (val == null) return '—'
  return `${val} ${unit}`
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

// ─── Latest measurement hero ──────────────────────────────────────────────────

function LatestHero({ m }: { m: HevyBodyMeasurement }) {
  return (
    <div className="rounded-xl bg-accent-50 border border-accent-200 px-5 py-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-accent-600 mb-3">
        Latest — {fmtDate(m.date)}
      </p>
      <div className="flex flex-wrap gap-6">
        {m.weight_kg != null && (
          <div>
            <p className="text-3xl font-bold text-ink-900">{m.weight_kg}</p>
            <p className="text-xs text-ink-500">kg</p>
          </div>
        )}
        {m.fat_percent != null && (
          <div>
            <p className="text-3xl font-bold text-ink-900">{m.fat_percent}</p>
            <p className="text-xs text-ink-500">body fat %</p>
          </div>
        )}
        {m.lean_mass_kg != null && (
          <div>
            <p className="text-3xl font-bold text-ink-900">{m.lean_mass_kg}</p>
            <p className="text-xs text-ink-500">lean mass kg</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Measurement Row ──────────────────────────────────────────────────────────

type NumericMeasKey =
  | 'weight_kg' | 'fat_percent' | 'lean_mass_kg'
  | 'neck_cm' | 'shoulder_cm' | 'chest_cm'
  | 'left_bicep_cm' | 'right_bicep_cm' | 'left_forearm_cm' | 'right_forearm_cm'
  | 'abdomen_cm' | 'waist_cm' | 'hips_cm'
  | 'left_thigh_cm' | 'right_thigh_cm' | 'left_calf_cm' | 'right_calf_cm'

type MeasField = { label: string; key: NumericMeasKey; unit: string }

const MAIN_FIELDS: MeasField[] = [
  { label: 'Weight',    key: 'weight_kg',   unit: 'kg' },
  { label: 'Fat %',     key: 'fat_percent', unit: '%' },
  { label: 'Lean mass', key: 'lean_mass_kg', unit: 'kg' },
]

const DETAIL_FIELDS: MeasField[] = [
  { label: 'Neck',          key: 'neck_cm',          unit: 'cm' },
  { label: 'Shoulder',      key: 'shoulder_cm',      unit: 'cm' },
  { label: 'Chest',         key: 'chest_cm',         unit: 'cm' },
  { label: 'L Bicep',       key: 'left_bicep_cm',    unit: 'cm' },
  { label: 'R Bicep',       key: 'right_bicep_cm',   unit: 'cm' },
  { label: 'L Forearm',     key: 'left_forearm_cm',  unit: 'cm' },
  { label: 'R Forearm',     key: 'right_forearm_cm', unit: 'cm' },
  { label: 'Abdomen',       key: 'abdomen_cm',       unit: 'cm' },
  { label: 'Waist',         key: 'waist_cm',         unit: 'cm' },
  { label: 'Hips',          key: 'hips_cm',          unit: 'cm' },
  { label: 'L Thigh',       key: 'left_thigh_cm',    unit: 'cm' },
  { label: 'R Thigh',       key: 'right_thigh_cm',   unit: 'cm' },
  { label: 'L Calf',        key: 'left_calf_cm',     unit: 'cm' },
  { label: 'R Calf',        key: 'right_calf_cm',    unit: 'cm' },
]

function MeasurementRow({ m, first }: { m: HevyBodyMeasurement; first: boolean }) {
  const [expanded, setExpanded] = useState(false)

  const hasDetails = DETAIL_FIELDS.some(f => m[f.key] != null)

  return (
    <div className={`border-b border-ink-100 last:border-0 ${first ? 'bg-cream-50' : ''}`}>
      {/* Summary row */}
      <button
        type="button"
        onClick={() => hasDetails && setExpanded(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 min-h-[44px] text-left"
        disabled={!hasDetails}
      >
        <span className="w-24 shrink-0 text-sm font-medium text-ink-700">{fmtDate(m.date)}</span>
        <div className="flex flex-1 flex-wrap gap-x-6 gap-y-0.5">
          {MAIN_FIELDS.map(f => {
            const v = m[f.key]
            if (v == null) return null
            return (
              <span key={f.key} className="text-sm text-ink-800">
                {f.label}: <strong>{v} {f.unit}</strong>
              </span>
            )
          })}
        </div>
        {hasDetails && (
          <span className="text-ink-400 text-xs shrink-0">{expanded ? '▲' : '▼'}</span>
        )}
      </button>

      {/* Detail row */}
      {expanded && (
        <div className="px-4 pb-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {DETAIL_FIELDS.map(f => {
            const val = m[f.key]
            if (val == null) return null
            return (
              <div key={f.key} className="bg-white border border-ink-100 rounded-lg px-3 py-1.5">
                <p className="text-[10px] text-ink-400 uppercase tracking-wider">{f.label}</p>
                <p className="text-sm font-medium text-ink-800">{fmt(val, f.unit)}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── BodyMeasurementsTab ──────────────────────────────────────────────────────

export function BodyMeasurementsTab() {
  const { data: measurements = [], isLoading } = useHevyBodyMeasurements(100)

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 rounded-xl bg-cream-200 animate-pulse" />
        ))}
        <p className="text-sm text-ink-400 text-center pt-1">Loading measurements…</p>
      </div>
    )
  }

  if (measurements.length === 0) {
    return (
      <div className="text-center py-10 border border-dashed border-ink-200 rounded-xl">
        <p className="text-ink-400 text-sm">No measurements yet — sync your Hevy data first</p>
      </div>
    )
  }

  const [latest, ...rest] = measurements

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-ink-400 italic">Synced from Hevy — not editable here</p>

      <LatestHero m={latest} />

      {/* History list */}
      {rest.length > 0 && (
        <div className="border border-ink-200 rounded-xl overflow-hidden">
          <p className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-ink-400 bg-cream-50 border-b border-ink-100">
            History
          </p>
          <div>
            {rest.map((m, i) => (
              <MeasurementRow key={m.id} m={m} first={i === 0} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
