import { useState, useMemo } from 'react'
import { flushSync } from 'react-dom'
import { Link } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { ChevronDown, ChevronRight, Maximize2, Minimize2, Pencil, Plus, Ruler } from 'lucide-react'
import { useHevyBodyMeasurements } from '../hooks/useHevyBodyMeasurements'
import { useBodyweightSeries } from '../../health/hooks/useBodyweight'
import { BODYWEIGHT_SOURCE_LABEL, type BodyweightPoint } from '../../health/bodyweight'
import { TOOLTIP_BOX, useAxisTick } from '../../../shared/components/charts/chartKit'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import { Button, Card, EmptyState, IconButton, SegmentedControl, Skeleton, useChartColors } from '../../../shared/ui'
import { daysAgoStr, todayStr } from '../../../shared/utils/dateUtils'
import { fmtDateEnGB } from '../../../shared/utils/enGBDate'
import { MeasurementModal } from './BodyMeasurementModal'
import { DETAIL_FIELDS, HERO_FIELDS, fmtMeasDate as fmtDate } from '../bodyMeasurementFields'
import type { HevyBodyMeasurement } from '../types.hevy'

// ─── Weight trend ─────────────────────────────────────────────────────────────
// The ONE bodyweight series (smart scale > its report > Hevy log), on a
// real time axis. It replaces a hand-drawn SVG that spaced readings by index
// (a three-week gap looked like a day), drew body fat by index onto the
// weight chart's positions (so fat % sat on the wrong dates) and read only
// the Hevy log — a different "current weight" than Health and Progress.

type Metric = 'weight' | 'fat'
const TREND_DAYS = 180

interface TrendRow { t: number; date: string; value: number; source: BodyweightPoint['source'] }

function TrendTooltip({ active, payload, unit }: { active?: boolean; payload?: { payload: TrendRow }[]; unit: string }) {
  const p = active ? payload?.[0]?.payload : undefined
  if (!p) return null
  return (
    <div className={TOOLTIP_BOX}>
      <p className="font-medium text-fg-muted">{fmtDate(p.date)}</p>
      <p className="font-semibold text-fg">{p.value.toFixed(1)} {unit}</p>
      <p className="text-fg-muted">{BODYWEIGHT_SOURCE_LABEL[p.source]}</p>
    </div>
  )
}

function WeightTrendCard({ expanded, onToggleExpand }: { expanded: boolean; onToggleExpand: () => void }) {
  const c = useChartColors()
  const tick = useAxisTick()
  const [metric, setMetric] = useState<Metric>('weight')
  const today = todayStr()
  const { data: points = [], isLoading } = useBodyweightSeries(daysAgoStr(TREND_DAYS), today)

  const rows: TrendRow[] = useMemo(() => points
    .map(p => ({ t: new Date(`${p.date}T12:00:00`).getTime(), date: p.date, value: (metric === 'weight' ? p.kg : p.fatPct) as number, source: metric === 'weight' ? p.source : (p.fatSource ?? p.source) }))
    .filter(r => r.value != null && Number.isFinite(r.value)), [points, metric])

  if (isLoading) return <Skeleton rounded="rounded-card" className="h-48" />
  const unit = metric === 'weight' ? 'kg' : '%'
  const latest = rows[rows.length - 1]
  const first = rows[0]
  const delta = latest && first && rows.length > 1 ? Math.round((latest.value - first.value) * 10) / 10 : null

  return (
    <Card className="@container flex flex-col gap-2" style={{ viewTransitionName: 'body-weight-card' }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="section-label flex items-center gap-1">
          {metric === 'weight' ? 'Weight' : 'Body fat'} · last 6 months
          <InfoBubble label="Where these readings come from">
            Your smart scale first (read from Apple Health, where its app writes every weigh-in), then a scale report
            imported from a photo; a weight typed into Hevy only fills a day with no scale reading. The same numbers
            Health and Progress use.
          </InfoBubble>
        </p>
        <div className="flex items-center gap-1">
          <SegmentedControl<Metric>
            size="sm"
            value={metric}
            onChange={setMetric}
            options={[{ value: 'weight', label: 'Weight' }, { value: 'fat', label: 'Body fat' }]}
          />
          <IconButton label={expanded ? 'Shrink chart' : 'Expand chart'} onClick={onToggleExpand} className="hidden @md:inline-flex">
            {expanded ? <Minimize2 /> : <Maximize2 />}
          </IconButton>
        </div>
      </div>

      {latest ? (
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-kpi font-bold tabular-nums text-fg">{latest.value.toFixed(1)}</span>
          <span className="text-meta text-fg-muted">{unit} · {fmtDate(latest.date)} · {BODYWEIGHT_SOURCE_LABEL[latest.source]}</span>
          {/* A change is a fact, not a verdict — no good/bad colour. */}
          {delta != null && (
            <span className="text-meta font-semibold tabular-nums text-fg-2">
              {delta > 0 ? '▲' : delta < 0 ? '▼' : '—'} {Math.abs(delta)} {unit} since {fmtDate(first.date)}
            </span>
          )}
        </div>
      ) : (
        <p className="text-body text-fg-muted">No {metric === 'weight' ? 'weight' : 'body-fat'} readings in the last 6 months.</p>
      )}

      {rows.length >= 2 && (
        <div className={expanded ? 'aspect-[3/1] w-full max-w-4xl' : 'h-40 w-full max-w-2xl'}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid stroke={c.grid} vertical={false} />
              <XAxis
                dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']}
                tickFormatter={v => fmtDateEnGB(new Date(v), { day: 'numeric', month: 'short' })}
                tick={tick} tickLine={false} axisLine={false} minTickGap={24}
              />
              {/* A trend line may zoom (THEME.md §2.5); the ticks are real values. */}
              <YAxis domain={['auto', 'auto']} tick={tick} tickLine={false} axisLine={false} width={44} tickFormatter={v => Number(v).toFixed(metric === 'weight' ? 0 : 1)} />
              <Tooltip cursor={false} content={<TrendTooltip unit={unit} />} wrapperStyle={{ pointerEvents: 'none' }} />
              <Line type="monotone" dataKey="value" stroke={c.series[0]} strokeWidth={2} dot={{ r: 2.5, fill: c.series[0] }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <Link to="/health" className="flex min-h-[44px] items-center gap-1 self-start text-meta font-semibold text-accent-600">
        Full trend in Health <ChevronRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </Card>
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
          <p className="section-label">Latest entry</p>
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
            <WeightTrendCard expanded={chartExpanded} onToggleExpand={toggleChart} />
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
