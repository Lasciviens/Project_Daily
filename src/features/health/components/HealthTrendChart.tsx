import type { ReactNode } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceArea, ReferenceLine,
} from 'recharts'
import { useChartColors } from '../../../shared/ui'
import { TOOLTIP_BOX } from '../../../shared/components/charts/chartKit'
import { compactAxisTick } from '../../../shared/components/charts/axisFormat'
import { ChartPin, type PinAction } from './ChartPin'
import { useChartDrilldown } from './useChartDrilldown'
import { fmtDayLong } from './healthFormat'

// The Health chart: bars and/or lines over daily or hourly points, where a
// null value is a GAP (a Watch-off day, a future hour) — never a zero bar or a
// line diving to 0 (H-03 / H-10) — with the shared drill-down pin (H-11) and
// optional reference band/lines (a personal baseline, a target).

export interface TrendPoint {
  label: string
  /** Set on daily points; enables "View this day" and names the pin. */
  date?: string
  [key: string]: string | number | null | undefined
}

export interface TrendSeries {
  key: string
  label: string
  color: string
  kind: 'bar' | 'line'
  stackId?: string
  /** Line: a thin dashed line with no dots (a rolling mean). */
  dashed?: boolean
  /** Line: bridge gaps (sparse readings such as weigh-ins). */
  connectNulls?: boolean
  /** Line: colour each dot from its point (e.g. by data source). */
  dotColor?: (p: TrendPoint) => string
  /** Line: draw the readings as dots only (the trend is another series). */
  dotsOnly?: boolean
}

interface Props {
  data: TrendPoint[]
  series: TrendSeries[]
  unit: string
  ariaLabel: string
  height?: number
  yDomain?: [number | 'auto' | 'dataMin', number | 'auto' | 'dataMax']
  band?: { y1: number; y2: number; label?: string; color?: string }
  refLines?: { y: number; label: string }[]
  formatValue?: (v: number) => string
  /** Drill-down to a day (Week/Month charts only). */
  onViewDay?: (date: string) => void
  extraActions?: (date: string) => PinAction[]
  /** Extra lines under the values (tooltip and pin), e.g. data sources. */
  describe?: (p: TrendPoint) => ReactNode
}

function valueRows(p: TrendPoint, series: TrendSeries[], unit: string, fmt: (v: number) => string) {
  return series
    .filter(s => typeof p[s.key] === 'number')
    .map(s => (
      <p key={s.key} className="font-semibold tabular-nums" style={{ color: s.color }}>
        {fmt(p[s.key] as number)}{unit ? ` ${unit}` : ''} <span className="font-normal text-fg-muted">{s.label}</span>
      </p>
    ))
}

export function HealthTrendChart({
  data, series, unit, ariaLabel, height = 160, yDomain, band, refLines, formatValue, onViewDay, extraActions, describe,
}: Props) {
  const c = useChartColors()
  const fmt = formatValue ?? ((v: number) => Math.round(v).toLocaleString('en-GB'))
  const drillable = !!(onViewDay || extraActions)
  const { pin, close, wrapRef, onChartClick } = useChartDrilldown(drillable)
  const hasBars = series.some(s => s.kind === 'bar')
  const domain = yDomain ?? (hasBars ? [0, 'auto'] : ['auto', 'auto'])
  const pinned = pin ? data[pin.index] : undefined

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts' TooltipProps generic is awkward to import cleanly; we only read a few fields.
  function TooltipContent({ active, payload }: any) {
    if (!active || !payload?.length) return null
    const p = payload[0]?.payload as TrendPoint | undefined
    if (!p) return null
    const rows = valueRows(p, series, unit, fmt)
    return (
      <div className={`${TOOLTIP_BOX} pointer-events-none`}>
        <p className="font-medium text-fg-muted">{p.date ? fmtDayLong(p.date) : p.label}</p>
        {rows.length ? rows : <p className="text-fg-muted">No data</p>}
        {describe?.(p)}
        {drillable && p.date && <p className="text-micro font-normal text-fg-faint">Click for actions</p>}
      </div>
    )
  }

  return (
    <div ref={wrapRef} className={`relative ${drillable ? 'cursor-pointer' : ''}`} role="img" aria-label={ariaLabel}>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 6, right: 6, left: -4, bottom: 0 }} onClick={onChartClick}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={c.grid} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: c.axis }} axisLine={false} tickLine={false}
              interval="preserveStartEnd" minTickGap={12} />
            <YAxis tick={{ fontSize: 10, fill: c.axis }} axisLine={false} tickLine={false} width={40}
              tickFormatter={compactAxisTick} domain={domain} />
            {band && (
              <ReferenceArea y1={band.y1} y2={band.y2} fill={band.color ?? c.series[0]} fillOpacity={0.12}
                stroke="none" ifOverflow="extendDomain"
                label={band.label ? { value: band.label, position: 'insideTopLeft', fontSize: 10, fill: c.axis } : undefined} />
            )}
            {refLines?.map(r => (
              <ReferenceLine key={r.label} y={r.y} stroke={c.axis} strokeDasharray="4 3" ifOverflow="extendDomain"
                label={{ value: r.label, position: 'insideTopRight', fontSize: 10, fill: c.axis }} />
            ))}
            {!pin && <Tooltip cursor={false} content={TooltipContent} />}
            {series.map(s => s.kind === 'bar' ? (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} stackId={s.stackId}
                fillOpacity={series.some(x => x.kind === 'line' && x.key === s.key) ? 0.3 : 1}
                radius={s.stackId ? 0 : [3, 3, 0, 0]} maxBarSize={28} activeBar={false} />
            ) : (
              <Line key={s.key} dataKey={s.key} name={s.label} stroke={s.dotsOnly ? 'none' : s.color} connectNulls={!!s.connectNulls}
                strokeWidth={s.dashed ? 1.5 : 2} strokeDasharray={s.dashed ? '5 4' : undefined}
                dot={s.dashed ? false : s.dotColor
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts dot render props
                  ? (props: any) => props.value == null ? <g key={props.key} /> : (
                      <circle key={props.key} cx={props.cx} cy={props.cy} r={3.5} fill={s.dotColor!(props.payload)} stroke="none" />
                    )
                  : { r: 2.5 }}
                activeDot={s.dashed ? false : { r: 5, fill: s.color }} isAnimationActive={false} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {pin && pinned && (
        <ChartPin
          pin={pin}
          onClose={close}
          title={pinned.date ? fmtDayLong(pinned.date) : pinned.label}
          actions={pinned.date
            ? [...(onViewDay ? [{ label: 'View this day →', onClick: () => onViewDay(pinned.date as string) }] : []),
               ...(extraActions?.(pinned.date) ?? [])]
            : []}
        >
          {valueRows(pinned, series, unit, fmt)}
          {describe?.(pinned)}
        </ChartPin>
      )}
    </div>
  )
}
