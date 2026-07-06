import { useState, useMemo } from 'react'
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import { useHevyBodyMeasurements, useUpsertBodyMeasurement } from '../hooks/useHevyBodyMeasurements'
import { todayStr } from '../../../shared/utils/dateUtils'
import type { HevyBodyMeasurement } from '../types.hevy'

// ─── Field definitions ────────────────────────────────────────────────────────

type MeasKey =
  | 'weight_kg' | 'fat_percent' | 'lean_mass_kg'
  | 'neck_cm' | 'shoulder_cm' | 'chest_cm'
  | 'left_bicep_cm' | 'right_bicep_cm' | 'left_forearm_cm' | 'right_forearm_cm'
  | 'abdomen_cm' | 'waist_cm' | 'hips_cm'
  | 'left_thigh_cm' | 'right_thigh_cm' | 'left_calf_cm' | 'right_calf_cm'

interface FieldDef { label: string; key: MeasKey; unit: string }

const HERO_FIELDS: FieldDef[] = [
  { label: 'Weight',    key: 'weight_kg',    unit: 'kg' },
  { label: 'Body fat',  key: 'fat_percent',  unit: '%'  },
  { label: 'Lean mass', key: 'lean_mass_kg', unit: 'kg' },
]

const ALL_FIELDS: FieldDef[] = [
  { label: 'Weight',    key: 'weight_kg',        unit: 'kg' },
  { label: 'Body fat',  key: 'fat_percent',       unit: '%'  },
  { label: 'Lean mass', key: 'lean_mass_kg',      unit: 'kg' },
  { label: 'Neck',      key: 'neck_cm',           unit: 'cm' },
  { label: 'Shoulder',  key: 'shoulder_cm',       unit: 'cm' },
  { label: 'Chest',     key: 'chest_cm',          unit: 'cm' },
  { label: 'L Bicep',   key: 'left_bicep_cm',     unit: 'cm' },
  { label: 'R Bicep',   key: 'right_bicep_cm',    unit: 'cm' },
  { label: 'L Forearm', key: 'left_forearm_cm',   unit: 'cm' },
  { label: 'R Forearm', key: 'right_forearm_cm',  unit: 'cm' },
  { label: 'Abdomen',   key: 'abdomen_cm',        unit: 'cm' },
  { label: 'Waist',     key: 'waist_cm',          unit: 'cm' },
  { label: 'Hips',      key: 'hips_cm',           unit: 'cm' },
  { label: 'L Thigh',   key: 'left_thigh_cm',     unit: 'cm' },
  { label: 'R Thigh',   key: 'right_thigh_cm',    unit: 'cm' },
  { label: 'L Calf',    key: 'left_calf_cm',      unit: 'cm' },
  { label: 'R Calf',    key: 'right_calf_cm',     unit: 'cm' },
]

const DETAIL_FIELDS = ALL_FIELDS.slice(3)

function fmtDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

// ─── Log/Edit Measurement Modal ───────────────────────────────────────────────

type FormValues = Record<MeasKey, string>

function blankForm(initial?: HevyBodyMeasurement): { date: string; values: FormValues } {
  const base: FormValues = {} as FormValues
  for (const f of ALL_FIELDS) {
    base[f.key] = initial && initial[f.key] != null ? String(initial[f.key]) : ''
  }
  return { date: initial ? initial.date : todayStr(), values: base }
}

interface MeasurementModalProps {
  isOpen:   boolean
  onClose:  () => void
  initial?: HevyBodyMeasurement
}

function MeasurementModal({ isOpen, onClose, initial }: MeasurementModalProps) {
  const upsert = useUpsertBodyMeasurement()
  const [form, setForm] = useState(() => blankForm(initial))

  // Reset form when initial changes (opening different row)
  function setVal(key: MeasKey, val: string) {
    setForm(f => ({ ...f, values: { ...f.values, [key]: val } }))
  }

  async function handleSave() {
    const payload: Record<string, unknown> = { date: form.date }
    for (const f of ALL_FIELDS) {
      payload[f.key] = form.values[f.key] !== '' ? Number(form.values[f.key]) : null
    }
    try {
      await upsert.mutateAsync(payload)
      onClose()
    } catch {
      // error toast handled by the mutation's onError callback
    }
  }

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-[60]">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-ink-900/30 transition duration-200 data-[closed]:opacity-0"
      />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel
          transition
          className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-lg bg-white border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-ink-100">
            <h2 className="text-base font-bold text-ink-900">
              {initial ? 'Edit Measurement' : 'Log Measurement'}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700 text-xl leading-none"
            >
              ×
            </button>
          </div>

          <div className="px-5 py-4 overflow-y-auto max-h-[calc(90vh-9rem)] flex flex-col gap-4">
            {/* Date */}
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">
                Date
              </label>
              <input
                type="date"
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="w-full min-h-[44px] bg-cream-50 border border-ink-200 rounded-xl px-3 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-400"
              />
            </div>

            {/* Hero fields (weight/fat/lean) */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-2">
                Main measurements
              </p>
              <div className="grid grid-cols-3 gap-3">
                {HERO_FIELDS.map(f => (
                  <div key={f.key}>
                    <label className="text-xs text-ink-600 mb-1 block">{f.label} ({f.unit})</label>
                    <input
                      type="number"
                      step="0.1"
                      value={form.values[f.key]}
                      onChange={e => setVal(f.key, e.target.value)}
                      placeholder="—"
                      className="w-full min-h-[44px] bg-cream-50 border border-ink-200 rounded-xl px-3 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-400"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Body measurements grid */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-2">
                Body circumferences (cm)
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {DETAIL_FIELDS.map(f => (
                  <div key={f.key}>
                    <label className="text-xs text-ink-600 mb-1 block">{f.label}</label>
                    <input
                      type="number"
                      step="0.1"
                      value={form.values[f.key]}
                      onChange={e => setVal(f.key, e.target.value)}
                      placeholder="—"
                      className="w-full min-h-[44px] bg-cream-50 border border-ink-200 rounded-xl px-3 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-400"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-ink-100 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 min-h-[44px] border border-ink-200 text-ink-700 rounded-xl text-sm font-medium hover:bg-cream-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={upsert.isPending || !form.date}
              className="flex-1 min-h-[44px] bg-accent-600 text-white rounded-xl text-sm font-semibold hover:bg-accent-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {upsert.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}

// ─── Weight Chart ─────────────────────────────────────────────────────────────

function WeightChart({ measurements }: { measurements: HevyBodyMeasurement[] }) {
  const chartData = useMemo(() => {
    return [...measurements]
      .filter(m => m.weight_kg != null)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30)
  }, [measurements])

  const fatData = useMemo(() => {
    return [...measurements]
      .filter(m => m.fat_percent != null)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30)
  }, [measurements])

  if (chartData.length < 2) return null

  const W = 400
  const H = 120
  const PAD = { top: 10, right: 10, bottom: 20, left: 36 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  const weights = chartData.map(m => m.weight_kg as number)
  const minW = Math.min(...weights)
  const maxW = Math.max(...weights)
  const rangeW = maxW - minW || 1
  const paddedMin = minW - rangeW * 0.1
  const paddedMax = maxW + rangeW * 0.1
  const paddedRange = paddedMax - paddedMin

  function xFrac(i: number, len: number): number {
    return len === 1 ? 0.5 : i / (len - 1)
  }
  function toX(frac: number): number { return PAD.left + frac * innerW }
  function toY(val: number, min: number, range: number): number {
    return PAD.top + innerH - ((val - min) / range) * innerH
  }

  const weightPath = chartData
    .map((m, i) => {
      const x = toX(xFrac(i, chartData.length))
      const y = toY(m.weight_kg as number, paddedMin, paddedRange)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  // Fat percent on secondary axis (only if enough data)
  let fatPath: string | null = null
  if (fatData.length >= 2) {
    const fats = fatData.map(m => m.fat_percent as number)
    const minF = Math.min(...fats)
    const maxF = Math.max(...fats)
    const rangeF = maxF - minF || 1
    const pMinF = minF - rangeF * 0.1
    const pMaxF = maxF + rangeF * 0.1
    const pRangeF = pMaxF - pMinF

    // Map fat data to same x positions as weight data (approx by index)
    fatPath = fatData
      .map((m, i) => {
        const x = toX(xFrac(i, fatData.length))
        const y = toY(m.fat_percent as number, pMinF, pRangeF)
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  }

  const firstLabel = chartData[0].date.slice(5).replace('-', '/')
  const lastLabel  = chartData[chartData.length - 1].date.slice(5).replace('-', '/')

  return (
    <div className="rounded-xl border border-ink-100 bg-white px-3 py-3 overflow-hidden">
      <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400 mb-2">Weight over time</p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: H }}
        aria-hidden="true"
      >
        {/* Y-axis labels */}
        <text x={PAD.left - 4} y={PAD.top + 4} textAnchor="end" fontSize={9} fill="#94a3b8">{paddedMax.toFixed(1)}</text>
        <text x={PAD.left - 4} y={PAD.top + innerH} textAnchor="end" fontSize={9} fill="#94a3b8">{paddedMin.toFixed(1)}</text>

        {/* Grid lines */}
        <line x1={PAD.left} y1={PAD.top} x2={PAD.left + innerW} y2={PAD.top} stroke="#f1f5f9" strokeWidth={1} />
        <line x1={PAD.left} y1={PAD.top + innerH / 2} x2={PAD.left + innerW} y2={PAD.top + innerH / 2} stroke="#f1f5f9" strokeWidth={1} />
        <line x1={PAD.left} y1={PAD.top + innerH} x2={PAD.left + innerW} y2={PAD.top + innerH} stroke="#f1f5f9" strokeWidth={1} />

        {/* Fat % line (dashed, secondary) */}
        {fatPath && (
          <path d={fatPath} fill="none" stroke="#cbd5e1" strokeWidth={1.5} strokeDasharray="4 3" />
        )}

        {/* Weight line */}
        <path d={weightPath} fill="none" stroke="#f59e0b" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {/* Dots */}
        {chartData.map((m, i) => {
          const x = toX(xFrac(i, chartData.length))
          const y = toY(m.weight_kg as number, paddedMin, paddedRange)
          return (
            <circle key={m.id} cx={x} cy={y} r={2.5} fill="#f59e0b" />
          )
        })}

        {/* X-axis labels */}
        <text x={toX(0)} y={H - 3} textAnchor="start" fontSize={9} fill="#94a3b8">{firstLabel}</text>
        <text x={toX(1)} y={H - 3} textAnchor="end" fontSize={9} fill="#94a3b8">{lastLabel}</text>
      </svg>

      {fatPath && (
        <div className="flex gap-4 text-[10px] text-ink-400 mt-1">
          <span className="flex items-center gap-1">
            <span className="inline-block w-4 h-0.5 bg-accent-500 rounded" />
            Weight (kg)
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-4 h-px bg-ink-300 rounded border-t border-dashed border-ink-300" style={{ borderTopStyle: 'dashed' }} />
            Body fat (%)
          </span>
        </div>
      )}
    </div>
  )
}

// ─── Latest Hero Card ─────────────────────────────────────────────────────────

function LatestHeroCard({
  m, onEdit,
}: { m: HevyBodyMeasurement; onEdit: () => void }) {
  const heroValues = HERO_FIELDS.filter(f => m[f.key] != null)

  return (
    <div className="rounded-xl bg-gradient-to-br from-accent-50 to-cream-50 border border-accent-200 px-4 py-3">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-accent-600">Latest</p>
          <p className="text-sm font-semibold text-ink-700 mt-0.5">{fmtDate(m.date)}</p>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-ink-500 hover:text-ink-800 hover:bg-white rounded-xl transition-colors text-sm border border-transparent hover:border-ink-200"
          title="Edit this measurement"
        >
          ✎
        </button>
      </div>

      {heroValues.length > 0 ? (
        <div className="flex flex-wrap gap-4">
          {heroValues.map(f => (
            <div key={f.key}>
              <p className="text-2xl font-black text-ink-900">{m[f.key]}</p>
              <p className="text-xs font-medium text-ink-500 mt-0.5">{f.unit} — {f.label}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-ink-400 italic">No main measurements recorded</p>
      )}
    </div>
  )
}

// ─── History Row ──────────────────────────────────────────────────────────────

function MeasurementRow({
  m, onEdit,
}: { m: HevyBodyMeasurement; onEdit: (m: HevyBodyMeasurement) => void }) {
  const [expanded, setExpanded] = useState(false)
  const hasDetails = DETAIL_FIELDS.some(f => m[f.key] != null)
  const mainValues = HERO_FIELDS.filter(f => m[f.key] != null)

  return (
    <div className="border-b border-ink-100 last:border-0">
      {/* Summary row */}
      <div className="flex items-center gap-2 px-3 py-2 min-h-[44px]">
        <button
          type="button"
          onClick={() => hasDetails && setExpanded(o => !o)}
          disabled={!hasDetails}
          className="flex-1 flex items-center gap-3 text-left min-w-0"
        >
          <span className="w-28 shrink-0 text-sm font-semibold text-ink-700">{fmtDate(m.date)}</span>
          <div className="flex flex-1 flex-wrap gap-x-4 gap-y-0.5 min-w-0">
            {mainValues.map(f => (
              <span key={f.key} className="text-sm text-ink-600">
                <span className="text-ink-400 text-xs">{f.label}:</span>{' '}
                <strong className="text-ink-800">{m[f.key]} {f.unit}</strong>
              </span>
            ))}
          </div>
          {hasDetails && (
            <span className="text-ink-400 text-xs shrink-0">{expanded ? '▲' : '▼'}</span>
          )}
        </button>

        <button
          type="button"
          onClick={() => onEdit(m)}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700 hover:bg-cream-50 rounded-lg transition-colors text-sm shrink-0"
          title="Edit"
        >
          ✎
        </button>
      </div>

      {/* Expanded detail grid */}
      {expanded && (
        <div className="px-4 pb-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {DETAIL_FIELDS.map(f => {
            const val = m[f.key]
            if (val == null) return null
            return (
              <div key={f.key} className="bg-cream-50 border border-ink-100 rounded-lg px-3 py-1.5">
                <p className="text-[10px] text-ink-400 uppercase tracking-wider">{f.label}</p>
                <p className="text-sm font-semibold text-ink-800">{val} {f.unit}</p>
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
  const [logOpen,      setLogOpen]      = useState(false)
  const [logKey,       setLogKey]       = useState(0)
  const [editTarget,   setEditTarget]   = useState<HevyBodyMeasurement | null>(null)

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-28 rounded-xl bg-cream-200 animate-pulse" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 rounded-xl bg-cream-200 animate-pulse" />
        ))}
      </div>
    )
  }

  const [latest, ...rest] = measurements

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-base font-bold text-ink-900">Body Measurements</h3>
          <p className="text-xs text-ink-400">{measurements.length} entries</p>
        </div>
        <button
          type="button"
          onClick={() => { setLogKey(k => k + 1); setLogOpen(true) }}
          className="min-h-[44px] px-4 bg-accent-600 text-white text-sm font-semibold rounded-xl hover:bg-accent-700 transition-colors flex items-center gap-1.5"
        >
          <span className="text-base leading-none">+</span>
          <span>Log Measurement</span>
        </button>
      </div>

      {measurements.length === 0 ? (
        <div className="text-center py-14 border border-dashed border-ink-200 rounded-xl">
          <p className="text-2xl mb-2">📏</p>
          <p className="text-ink-600 font-medium text-sm">No measurements yet</p>
          <p className="text-ink-400 text-xs mt-1">Sync from Hevy or log one now</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Latest (compact) + chart beside it on wider screens */}
          <div className="grid gap-3 sm:grid-cols-[15rem_1fr] items-start">
            <LatestHeroCard m={latest} onEdit={() => setEditTarget(latest)} />
            <WeightChart measurements={measurements} />
          </div>

          {/* History */}
          {rest.length > 0 && (
            <div className="border border-ink-200 rounded-xl overflow-hidden">
              <p className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-ink-400 bg-cream-50 border-b border-ink-100">
                History
              </p>
              <div>
                {rest.map(m => (
                  <MeasurementRow key={m.id} m={m} onEdit={setEditTarget} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Log new */}
      <MeasurementModal
        key={logKey}
        isOpen={logOpen}
        onClose={() => setLogOpen(false)}
      />

      {/* Edit existing */}
      {editTarget && (
        <MeasurementModal
          key={editTarget.id}
          isOpen={editTarget != null}
          onClose={() => setEditTarget(null)}
          initial={editTarget}
        />
      )}
    </>
  )
}
