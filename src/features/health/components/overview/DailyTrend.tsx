import { useChartColors } from '../../../../shared/ui'
import { fillDays, rollingMean, type DayValue } from '../../healthWindowStats'
import { HealthTrendChart } from '../HealthTrendChart'
import { fmtAxisDate, fmtAxisDay } from '../healthFormat'

// A daily series over [from, to] as bars (or dots) plus its 7-day average, with
// optional reference band / lines. Days without a reading are gaps.

interface Props {
  series: readonly DayValue[]
  from: string
  to: string
  /** 'line' = a plain connected line with no dot per point (the scale's
   *  weight, matching the Body window). */
  kind: 'bar' | 'dots' | 'line'
  label: string
  unit: string
  ariaLabel: string
  color?: string
  /** Add a 7-day average line (needs 3 readings in each 7 days). */
  rolling?: boolean
  band?: { y1: number; y2: number; label?: string; labelSide?: 'left' | 'right' }
  refLines?: { y: number; label: string }[]
  formatValue?: (v: number) => string
  yDomain?: [number | 'auto' | 'dataMin', number | 'auto' | 'dataMax']
  height?: number
  onViewDay?: (date: string) => void
}

export function DailyTrend({
  series, from, to, kind, label, unit, ariaLabel, color, rolling, band, refLines, formatValue, yDomain, height = 150, onViewDay,
}: Props) {
  const c = useChartColors()
  const col = color ?? c.series[0]
  const dense = fillDays(series, from, to)
  const mean7 = rolling ? rollingMean(dense, 7, kind === 'bar' ? 3 : 1) : null
  const long = dense.length > 45
  const data = dense.map((d, i) => ({
    label: long ? fmtAxisDate(d.date) : fmtAxisDay(d.date), date: d.date, value: d.value, mean7: mean7?.[i].value ?? null,
  }))
  if (!data.some(d => d.value != null)) return null
  return (
    <HealthTrendChart
      data={data}
      series={[
        kind === 'bar'
          ? { key: 'value', label, color: col, kind: 'bar' }
          : kind === 'line'
            ? { key: 'value', label, color: col, kind: 'line', plain: true, connectNulls: true }
            : { key: 'value', label, color: col, kind: 'line', dotsOnly: true },
        ...(rolling ? [{ key: 'mean7', label: '7-day average', color: col, kind: 'line' as const, dashed: true, connectNulls: kind !== 'bar' }] : []),
      ]}
      unit={unit}
      ariaLabel={ariaLabel}
      height={height}
      band={band ? { ...band, color: col } : undefined}
      refLines={refLines}
      formatValue={formatValue}
      yDomain={yDomain}
      onViewDay={onViewDay}
    />
  )
}
