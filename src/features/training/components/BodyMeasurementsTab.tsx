import { useState, useMemo } from 'react'
import { flushSync } from 'react-dom'
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import { useHevyBodyMeasurements, useUpsertBodyMeasurement } from '../hooks/useHevyBodyMeasurements'
import { useHealthMetricSeries } from '../hooks/useHealthExport'
import { computeDailySeries } from '../healthAggregate'
import { todayStr, daysAgoStr } from '../../../shared/utils/dateUtils'
import { DateInput } from '../../../shared/components/DateInput'
import { formatTrainingDate } from '../dateFormat'
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
  return formatTrainingDate(new Date(dateStr + 'T00:00:00'))
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

function MeasurementModal({ isOpen, onClose, initial, existing = [] }: MeasurementModalProps) {
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

  // Reset form when initial changes (opening different row)
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
      // error toast handled by the mutation's onError callback
    }
  }

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-[60]">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-ink-950/30 backdrop-blur-sm transition duration-200 data-[closed]:opacity-0"
      />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel
          transition
          className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-lg bg-cream-50 border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95"
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
              <DateInput
                value={form.date}
                onChange={v => setForm(f => ({ ...f, date: v }))}
                className="w-full min-h-[44px] bg-cream-50 border border-ink-200 rounded-xl px-3 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-400"
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
                    className="text-xs px-3 min-h-[44px] rounded-full border border-accent-200 bg-accent-50 text-accent-700 hover:bg-accent-100 transition-colors press-feedback"
                  >
                    ⚖️ {suggestions.weight.value} kg <span className="opacity-60">({fmtDate(suggestions.weight.date)})</span>
                  </button>
                )}
                {suggestions.fat && (
                  <button
                    type="button"
                    onClick={() => setVal('fat_percent', String(suggestions.fat!.value))}
                    className="text-xs px-3 min-h-[44px] rounded-full border border-accent-200 bg-accent-50 text-accent-700 hover:bg-accent-100 transition-colors press-feedback"
                  >
                    💧 %{suggestions.fat.value} fat <span className="opacity-60">({fmtDate(suggestions.fat.date)})</span>
                  </button>
                )}
              </div>
            )}

            {/* Hero fields (weight/fat/lean) */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-2">
                Main measurements
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {HERO_FIELDS.map(f => (
                  <div key={f.key}>
                    <label className="text-xs text-ink-600 mb-1 block">{f.label} ({f.unit})</label>
                    <input
                      type="text"
                      inputMode="decimal"
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
                      type="text"
                      inputMode="decimal"
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

function WeightChart({ measurements, expanded, onToggleExpand }: {
  measurements: HevyBodyMeasurement[]
  expanded: boolean
  onToggleExpand: () => void
}) {
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

  // Headline numbers for the compact (narrow-container) presentation.
  const lastW  = chartData[chartData.length - 1].weight_kg as number
  const firstW = chartData[0].weight_kg as number
  const deltaW = Math.round((lastW - firstW) * 10) / 10

  // DENSITY PILOT (Body = all strategies): this card is itself a @container.
  // In a narrow grid cell it renders as a HEADLINE + sparkline (number-first,
  // Tufte-style); once its own box is ≥28rem it becomes the full chart with
  // axes and legend. Clicking the card zoom-morphs it to full-width via the
  // View Transitions API (see BodyMeasurementsTab).
  return (
    <button
      type="button"
      onClick={onToggleExpand}
      style={{ viewTransitionName: 'body-weight-card' }}
      className="@container w-full text-left rounded-xl border border-ink-100 bg-cream-50 px-3 py-3 overflow-hidden card-interactive cursor-pointer"
      title={expanded ? 'Shrink chart' : 'Expand chart'}
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">Weight over time</p>
        <span className="text-[10px] text-ink-300">{expanded ? '⤡' : '⤢'}</span>
      </div>

      {/* Compact tier — shown only while the container is narrow */}
      <div className="@md:hidden flex items-baseline gap-2">
        <span className="text-2xl font-black text-ink-900 tabular-nums">{lastW}</span>
        <span className="text-xs text-ink-400">kg</span>
        <span className={`text-xs font-semibold ${deltaW > 0 ? 'text-red-500' : deltaW < 0 ? 'text-green-600' : 'text-ink-400'}`}>
          {deltaW > 0 ? '▲' : deltaW < 0 ? '▼' : '—'} {Math.abs(deltaW)} kg
        </span>
      </div>

      <div className={expanded ? '' : '@md:block hidden'}>
      {/* Expanded keeps the chart's own aspect ratio (viewBox scaling) and
          caps at max-w-4xl — bigger, never stretched into a wall-to-wall
          smear. Compact keeps the original fixed-height fit. */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={expanded ? 'w-full max-w-4xl h-auto' : 'w-full'}
        style={expanded ? undefined : { height: H }}
        aria-hidden="true"
      >
        {/* Y-axis labels */}
        <text x={PAD.left - 4} y={PAD.top + 4} textAnchor="end" fontSize={9} fill="rgb(var(--ink-400))">{paddedMax.toFixed(1)}</text>
        <text x={PAD.left - 4} y={PAD.top + innerH} textAnchor="end" fontSize={9} fill="rgb(var(--ink-400))">{paddedMin.toFixed(1)}</text>

        {/* Grid lines */}
        <line x1={PAD.left} y1={PAD.top} x2={PAD.left + innerW} y2={PAD.top} stroke="rgb(var(--ink-200))" strokeWidth={1} />
        <line x1={PAD.left} y1={PAD.top + innerH / 2} x2={PAD.left + innerW} y2={PAD.top + innerH / 2} stroke="rgb(var(--ink-200))" strokeWidth={1} />
        <line x1={PAD.left} y1={PAD.top + innerH} x2={PAD.left + innerW} y2={PAD.top + innerH} stroke="rgb(var(--ink-200))" strokeWidth={1} />

        {/* Fat % line (dashed, secondary) */}
        {fatPath && (
          <path d={fatPath} fill="none" stroke="rgb(var(--ink-300))" strokeWidth={1.5} strokeDasharray="4 3" />
        )}

        {/* Weight line */}
        <path d={weightPath} fill="none" stroke="rgb(var(--accent-500))" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {/* Dots */}
        {chartData.map((m, i) => {
          const x = toX(xFrac(i, chartData.length))
          const y = toY(m.weight_kg as number, paddedMin, paddedRange)
          return (
            <circle key={m.id} cx={x} cy={y} r={2.5} fill="rgb(var(--accent-500))" />
          )
        })}

        {/* X-axis labels */}
        <text x={toX(0)} y={H - 3} textAnchor="start" fontSize={9} fill="rgb(var(--ink-400))">{firstLabel}</text>
        <text x={toX(1)} y={H - 3} textAnchor="end" fontSize={9} fill="rgb(var(--ink-400))">{lastLabel}</text>
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
    </button>
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
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-ink-500 hover:text-ink-800 hover:bg-cream-50 rounded-xl transition-colors text-sm border border-transparent hover:border-ink-200"
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

  // Bento + container-query chart + view-transition zoom (the horizontal
  // space-efficiency pilot; the density-token toggle was tried and rejected
  // — the complaint was WIDTH, not vertical spacing).
  const [chartExpanded, setChartExpanded] = useState(false)
  function toggleChart() {
    if (typeof document.startViewTransition === 'function') {
      // flushSync inside the callback so the "after" snapshot sees the new
      // layout — the card then MORPHS between its grid cell and full width.
      document.startViewTransition(() => flushSync(() => setChartExpanded(v => !v)))
    } else {
      setChartExpanded(v => !v)
    }
  }

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
      <div className="flex items-center justify-between mb-2 sm:mb-3">
        <div>
          <h3 className="text-base font-bold text-ink-900">Body Measurements</h3>
          <p className="text-xs text-ink-400">{measurements.length} {measurements.length === 1 ? 'entry' : 'entries'}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { setLogKey(k => k + 1); setLogOpen(true) }}
            className="min-h-[44px] px-4 bg-accent-600 text-white text-sm font-semibold rounded-xl hover:bg-accent-700 transition-colors flex items-center gap-1.5"
          >
            <span className="text-base leading-none">+</span>
            {/* The full label ate ~200px of a 361px row and crammed the
                heading against it — shorten to "+ Log" below sm. */}
            <span>Log<span className="hidden sm:inline"> Measurement</span></span>
          </button>
        </div>
      </div>

      {measurements.length === 0 ? (
        <div className="text-center py-14 border border-dashed border-ink-200 rounded-xl">
          <p className="text-2xl mb-2">📏</p>
          <p className="text-ink-600 font-medium text-sm">No measurements yet</p>
          <p className="text-ink-400 text-xs mt-1">Sync from Hevy or log one now</p>
        </div>
      ) : (
        // Bento: auto-fill derives the column count from available width
        // (monitor 3-4 cells, laptop 2, phone 1 — no breakpoints). The chart
        // spans the leftover row space; expanded it takes the full row via
        // the view-transition morph. History always spans full width.
        <div className="@container">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3 items-start">
          <LatestHeroCard m={latest} onEdit={() => setEditTarget(latest)} />
          <div className={chartExpanded ? 'col-span-full' : '@3xl:col-span-2'}>
            <WeightChart measurements={measurements} expanded={chartExpanded} onToggleExpand={toggleChart} />
          </div>

          {/* History */}
          {rest.length > 0 && (
            <div className="col-span-full border border-ink-200 rounded-xl overflow-hidden">
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
        </div>
      )}

      {/* Log new */}
      <MeasurementModal
        key={logKey}
        isOpen={logOpen}
        onClose={() => setLogOpen(false)}
        existing={measurements}
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
