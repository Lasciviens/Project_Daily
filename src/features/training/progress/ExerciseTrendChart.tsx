import { useMemo, useState } from 'react'
import { ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { SegmentedControl, useChartColors } from '../../../shared/ui'
import { TOOLTIP_BOX } from '../../../shared/components/charts/chartKit'
import { compactAxisTick } from '../../../shared/components/charts/axisFormat'
import { fmtDateEnGB } from '../../../shared/utils/enGBDate'
import { buildExerciseChartRows, type ExerciseChartRow } from '../progress-engine/chartSeries'
import { fmtDuration } from '../progress-engine/format'
import { isWeightBasedMetric } from '../progress-engine/metricStrategy'
import type { CanonicalExerciseSession, ProgressMetricKind } from '../progress-engine/types'

// One exercise's session-by-session trend, drawn from the progress engine's
// own points (the same numbers the decision table judges). A real, dated,
// time-proportional axis (a break looks like a break), hover/tap values,
// load changes marked and labelled, and the assistance axis flipped so "up"
// always means better. Used by the decision drill-down and the Exercise
// progress chart.

type View = 'primary' | 'total' | 'volume'

function unitOf(metricKind: ProgressMetricKind): { primaryLabel: string; unit: string; totalLabel: string } {
  switch (metricKind) {
    case 'est1rm':         return { primaryLabel: 'Working weight', unit: 'kg', totalLabel: 'Total reps' }
    case 'addedWeight':    return { primaryLabel: 'Added weight', unit: 'kg', totalLabel: 'Total reps' }
    case 'assistedWeight': return { primaryLabel: 'Assistance', unit: 'kg', totalLabel: 'Total reps' }
    case 'reps':           return { primaryLabel: 'Top-set reps', unit: 'reps', totalLabel: 'Total reps' }
    case 'duration':       return { primaryLabel: 'Top-set time', unit: 's', totalLabel: 'Total time' }
    case 'distance':       return { primaryLabel: 'Top-set distance', unit: 'm', totalLabel: 'Total distance' }
  }
}

function fmtValue(v: number, unit: string): string {
  if (unit === 's') return fmtDuration(v)
  return `${Math.round(v * 10) / 10} ${unit}`
}

interface DotProps { cx?: number; cy?: number; payload?: ExerciseChartRow }

// A load change gets a larger filled dot; every other session a hollow one.
// Keyed by workout id (two sessions can share a date).
function renderDot({ cx, cy, payload }: DotProps, markChanges: boolean, stroke: string, surface: string) {
  if (cx == null || cy == null || !payload) return <g />
  const changed = markChanges && payload.loadChanged
  return <circle key={payload.key} cx={cx} cy={cy} r={changed ? 5 : 3.5} fill={changed ? stroke : surface} stroke={stroke} strokeWidth={2} />
}

const fmtDay = (ts: number) => fmtDateEnGB(new Date(ts), { day: 'numeric', month: 'short' })

function makeTooltip(view: View, metricKind: ProgressMetricKind) {
  const { primaryLabel, unit, totalLabel } = unitOf(metricKind)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts' TooltipProps generic is awkward to import cleanly; only a few fields are read.
  return function TrendTooltip({ active, payload }: any) {
    if (!active || !payload?.length) return null
    const row = payload[0]?.payload as ExerciseChartRow | undefined
    if (!row) return null
    return (
      <div className={TOOLTIP_BOX}>
        <p className="font-medium text-fg-muted">{fmtDateEnGB(new Date(row.date + 'T00:00:00'), { day: 'numeric', month: 'short', year: 'numeric' })}{row.workoutTitle ? ` · ${row.workoutTitle}` : ''}</p>
        <p className="font-semibold tabular-nums text-fg">{row.setsLabel}</p>
        {view === 'primary' && row.primary != null && <p className="tabular-nums text-fg-2">{primaryLabel}: {fmtValue(row.primary, unit)}{row.loadChanged ? ' (changed)' : ''}</p>}
        {view === 'primary' && row.e1rm != null && <p className="tabular-nums text-fg-muted">Est. 1RM: {row.e1rm} kg</p>}
        {view === 'total' && row.total != null && <p className="tabular-nums text-fg-2">{totalLabel}: {fmtValue(row.total, unit === 'kg' ? 'reps' : unit)}</p>}
        {view === 'volume' && row.volume != null && <p className="tabular-nums text-fg-2">Volume: {row.volume.toLocaleString('en-GB')} kg</p>}
      </div>
    )
  }
}

export function ExerciseTrendChart({ sessions, metricKind, height = 180 }: { sessions: readonly CanonicalExerciseSession[]; metricKind: ProgressMetricKind; height?: number }) {
  const [view, setView] = useState<View>('primary')
  const c = useChartColors()
  const rows = useMemo(() => buildExerciseChartRows(sessions, metricKind), [sessions, metricKind])
  const meta = unitOf(metricKind)
  const weightBased = isWeightBasedMetric(metricKind)
  const assisted = metricKind === 'assistedWeight'
  const hasVolume = metricKind === 'est1rm' || metricKind === 'addedWeight'
  const tooltip = useMemo(() => makeTooltip(view, metricKind), [view, metricKind])

  const key: keyof ExerciseChartRow = view === 'primary' ? 'primary' : view === 'total' ? 'total' : 'volume'
  const shown = rows.filter(r => r[key] != null)
  const options = [
    { value: 'primary' as const, label: meta.primaryLabel },
    { value: 'total' as const, label: meta.totalLabel },
    ...(hasVolume ? [{ value: 'volume' as const, label: 'Volume' }] : []),
  ]

  const showE1rm = view === 'primary' && metricKind === 'est1rm' && shown.some(r => r.e1rm != null)
  const yUnit = view === 'volume' ? 'kg' : view === 'total' ? (meta.unit === 'kg' ? 'reps' : meta.unit) : meta.unit
  const yTick = (v: number) => (yUnit === 's' ? fmtDuration(v) : compactAxisTick(v))

  return (
    <div className="flex max-w-2xl flex-col gap-2">
      <SegmentedControl<View> size="sm" value={view} onChange={setView} options={options} />
      {shown.length < 2 ? (
        <p className="py-3 text-meta text-fg-muted">Not enough sessions yet for a chart.</p>
      ) : (
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={shown} margin={{ top: 8, right: 8, left: -4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={c.grid} />
              <XAxis
                dataKey="ts" type="number" scale="time" domain={['dataMin', 'dataMax']}
                tickFormatter={fmtDay} tick={{ fontSize: 9, fill: c.axis }} axisLine={false} tickLine={false} tickCount={6} minTickGap={24}
              />
              <YAxis
                tick={{ fontSize: 9, fill: c.axis }} axisLine={false} tickLine={false} width={40} tickFormatter={yTick}
                domain={view === 'primary' ? ['auto', 'auto'] : [0, 'auto']} reversed={view === 'primary' && assisted}
              />
              <Tooltip cursor={{ stroke: c.grid }} content={tooltip} />
              {showE1rm && <Legend verticalAlign="top" height={20} iconSize={8} wrapperStyle={{ fontSize: 11 }} />}
              <Line
                dataKey={key} name={view === 'primary' ? meta.primaryLabel : view === 'total' ? meta.totalLabel : 'Volume'}
                type={view === 'primary' && weightBased ? 'stepAfter' : 'linear'} stroke={c.series[0]} strokeWidth={2}
                dot={(props: DotProps) => renderDot(props, view === 'primary', c.series[0], c.tooltipBg)} activeDot={{ r: 6 }} isAnimationActive={false}
              />
              {showE1rm && (
                <Line dataKey="e1rm" name="Est. 1RM" type="linear" stroke={c.series[1]} strokeWidth={1.5} strokeDasharray="4 3" dot={false} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="text-meta text-fg-muted">
        {view === 'primary' && weightBased && 'Filled dots mark a load change. '}
        {view === 'primary' && assisted && 'Axis flipped: up means LESS assistance, which is the improvement. '}
        {view === 'primary' && metricKind === 'est1rm' && 'Est. 1RM (dashed) is an Epley estimate from sets of 12 reps or fewer — a rough direction, not a tested max. '}
        {view === 'total' && 'A drop right after a load increase is expected, not a regression. '}
        {view === 'volume' && 'Volume = weight × reps over every working set (warm-ups excluded) — total work done, not strength. '}
        Hover or tap a point for the sets.
      </p>
    </div>
  )
}
