import { useState, useMemo } from 'react'
import { flushSync } from 'react-dom'
import { ChevronDown, Maximize2, Minimize2, Pencil, Plus, Ruler } from 'lucide-react'
import { useHevyBodyMeasurements } from '../hooks/useHevyBodyMeasurements'
import { Button, Card, EmptyState, IconButton, Skeleton, useChartColors } from '../../../shared/ui'
import { MeasurementModal } from './BodyMeasurementModal'
import { DETAIL_FIELDS, HERO_FIELDS, fmtMeasDate as fmtDate } from '../bodyMeasurementFields'
import type { HevyBodyMeasurement } from '../types.hevy'

// ─── Weight Chart ─────────────────────────────────────────────────────────────

function WeightChart({ measurements, expanded, onToggleExpand }: {
  measurements: HevyBodyMeasurement[]
  expanded: boolean
  onToggleExpand: () => void
}) {
  const c = useChartColors()
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
      className="card-interactive @container w-full cursor-pointer overflow-hidden p-4 text-left"
      aria-label={expanded ? 'Shrink weight chart' : 'Expand weight chart'}
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="section-label">Weight over time</p>
        {expanded
          ? <Minimize2 className="h-3.5 w-3.5 text-fg-faint" aria-hidden />
          : <Maximize2 className="h-3.5 w-3.5 text-fg-faint" aria-hidden />}
      </div>

      {/* Compact tier — shown only while the container is narrow */}
      <div className="flex items-baseline gap-2 @md:hidden">
        <span className="text-kpi font-bold tabular-nums text-fg">{lastW}</span>
        <span className="text-meta text-fg-muted">kg</span>
        {/* A change in weight is a fact, not a verdict — no good/bad colour. */}
        <span className="text-meta font-semibold tabular-nums text-fg-2">
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
        <text x={PAD.left - 4} y={PAD.top + 4} textAnchor="end" fontSize={9} fill={c.axis}>{paddedMax.toFixed(1)}</text>
        <text x={PAD.left - 4} y={PAD.top + innerH} textAnchor="end" fontSize={9} fill={c.axis}>{paddedMin.toFixed(1)}</text>

        {/* Grid lines */}
        <line x1={PAD.left} y1={PAD.top} x2={PAD.left + innerW} y2={PAD.top} stroke={c.grid} strokeWidth={1} />
        <line x1={PAD.left} y1={PAD.top + innerH / 2} x2={PAD.left + innerW} y2={PAD.top + innerH / 2} stroke={c.grid} strokeWidth={1} />
        <line x1={PAD.left} y1={PAD.top + innerH} x2={PAD.left + innerW} y2={PAD.top + innerH} stroke={c.grid} strokeWidth={1} />

        {/* Fat % line (dashed, secondary) */}
        {fatPath && (
          <path d={fatPath} fill="none" stroke={c.series[5]} strokeWidth={1.5} strokeDasharray="4 3" />
        )}

        {/* Weight line */}
        <path d={weightPath} fill="none" stroke={c.series[0]} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {/* Dots */}
        {chartData.map((m, i) => {
          const x = toX(xFrac(i, chartData.length))
          const y = toY(m.weight_kg as number, paddedMin, paddedRange)
          return (
            <circle key={m.id} cx={x} cy={y} r={2.5} fill={c.series[0]} />
          )
        })}

        {/* X-axis labels */}
        <text x={toX(0)} y={H - 3} textAnchor="start" fontSize={9} fill={c.axis}>{firstLabel}</text>
        <text x={toX(1)} y={H - 3} textAnchor="end" fontSize={9} fill={c.axis}>{lastLabel}</text>
      </svg>

      {fatPath && (
        <div className="mt-1 flex gap-4 text-micro text-fg-muted">
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: c.series[0] }} />
            Weight (kg)
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-4 border-t border-dashed" style={{ borderColor: c.series[5] }} />
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
    <Card>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <p className="section-label">Latest</p>
          <p className="mt-0.5 text-body font-semibold text-fg-2">{fmtDate(m.date)}</p>
        </div>
        <IconButton label="Edit this measurement" onClick={onEdit} className="-mr-2 -mt-2"><Pencil /></IconButton>
      </div>

      {heroValues.length > 0 ? (
        <div className="flex flex-wrap gap-4">
          {heroValues.map(f => (
            <div key={f.key}>
              <p className="text-kpi font-bold tabular-nums text-fg">{m[f.key]}<span className="ml-1 text-meta font-medium text-fg-muted">{f.unit}</span></p>
              <p className="mt-0.5 text-meta text-fg-muted">{f.label}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-body italic text-fg-muted">No main measurements recorded</p>
      )}
    </Card>
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
    <div className="border-b border-line last:border-0">
      <div className="flex min-h-[44px] items-center gap-2 py-1 pl-4 pr-1">
        <button
          type="button"
          onClick={() => hasDetails && setExpanded(o => !o)}
          disabled={!hasDetails}
          aria-expanded={hasDetails ? expanded : undefined}
          className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="w-28 shrink-0 text-body font-semibold tabular-nums text-fg-2">{fmtDate(m.date)}</span>
          <div className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-0.5">
            {mainValues.map(f => (
              <span key={f.key} className="text-body text-fg-2">
                <span className="text-meta text-fg-muted">{f.label}:</span>{' '}
                <strong className="tabular-nums text-fg">{m[f.key]} {f.unit}</strong>
              </span>
            ))}
          </div>
          {hasDetails && (
            <ChevronDown aria-hidden className={`h-4 w-4 shrink-0 text-fg-faint transition-transform ${expanded ? 'rotate-180' : ''}`} />
          )}
        </button>

        <IconButton label="Edit measurement" onClick={() => onEdit(m)} className="shrink-0"><Pencil /></IconButton>
      </div>

      {/* Expanded detail grid */}
      {expanded && (
        <div className="grid grid-cols-2 gap-2 px-4 pb-3 sm:grid-cols-3 md:grid-cols-4">
          {DETAIL_FIELDS.map(f => {
            const val = m[f.key]
            if (val == null) return null
            return (
              <div key={f.key} className="rounded-row border border-line bg-surface-2 px-3 py-1.5">
                <p className="section-label">{f.label}</p>
                <p className="text-body font-semibold tabular-nums text-fg">{val} {f.unit}</p>
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
        <Skeleton rounded="rounded-card" className="h-28" />
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} rounded="rounded-row" className="h-12" />)}
      </div>
    )
  }

  const [latest, ...rest] = measurements

  return (
    <>
      {/* Header */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-lead font-semibold text-fg">Body measurements</h3>
          <p className="text-meta tabular-nums text-fg-muted">{measurements.length} {measurements.length === 1 ? 'entry' : 'entries'}</p>
        </div>
        <Button variant="primary" icon={<Plus />} onClick={() => { setLogKey(k => k + 1); setLogOpen(true) }}>
          Log<span className="hidden sm:inline"> measurement</span>
        </Button>
      </div>

      {measurements.length === 0 ? (
        <EmptyState bordered icon={<Ruler />} title="No measurements yet" description="Sync from Hevy or log one now." />
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
            <Card padded={false} className="col-span-full max-w-5xl overflow-hidden">
              <p className="section-label border-b border-line px-4 py-2.5">History</p>
              <div>
                {rest.map(m => <MeasurementRow key={m.id} m={m} onEdit={setEditTarget} />)}
              </div>
            </Card>
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
