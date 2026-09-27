import { InfoBubble } from '../../../shared/components/InfoBubble'
import { shiftDateStr } from '../../../shared/utils/dateUtils'
import { fillDays, rollingMean, type DayValue } from '../healthWindowStats'
import { usualRange } from '../healthTrendStats'
import { useHealthDaily } from '../hooks/useHealthExport'
import { HealthTrendChart } from './HealthTrendChart'
import { fmtAxisDay, fmtDayMonth } from './healthFormat'

// A recovery marker or overnight vital (resting HR, HRV, respiratory rate,
// SpO₂, wrist temperature, walking HR) as a daily trend against YOUR usual
// range — population norms fit Apple's short overnight readings poorly, so the
// band is personal: mean ± 1 SD of the last 60 days by default, or the median
// ± a fixed width (respiratory rate). Always at least 30 days of context, even
// in Day mode, because one day of a recovery marker says nothing on its own.
// Reads the page's long window (`fetchFrom`), so it shares that download.

interface Props {
  metric: string
  title: string
  unit: string
  color: string
  from: string
  to: string
  /** Start of the page's shared download (covers the 60-day history). */
  fetchFrom?: string
  decimals?: number
  /** Add a dashed moving-average line. */
  rolling?: boolean
  /** Days in that moving average (default 7). */
  rollingDays?: number
  /** Usual-range rule; default mean ± 1 SD. */
  range?: { mode: 'sd'; k: number; minHalfWidth?: number } | { mode: 'median'; halfWidth: number }
  rangeText?: string
  /** Plot the difference from the usual-range centre (wrist temperature). */
  deviation?: boolean
  /** Map raw daily values (e.g. SpO₂ fraction → %); null drops a day. */
  transform?: (v: number) => number | null
  refLines?: { y: number; label: string }[]
  onViewDay?: (date: string) => void
}

export function RecoveryTrend({
  metric, title, unit, color, from, to, fetchFrom, decimals = 0, rolling, rollingDays = 7, range, rangeText, deviation, transform, refLines, onViewDay,
}: Props) {
  const histFrom = shiftDateStr(to, -59)
  const contextFrom = shiftDateStr(to, -29)
  const chartFrom = from < contextFrom ? from : contextFrom
  const readFrom = fetchFrom && fetchFrom < histFrom ? fetchFrom : histFrom
  const { data: raw = [], isLoading } = useHealthDaily(metric, readFrom, to)

  const data: DayValue[] = transform
    ? raw.map(d => ({ date: d.date, value: transform(d.value) })).filter((d): d is DayValue => d.value != null)
    : raw
  const hist = data.filter(d => d.date >= histFrom && d.date <= to).map(d => d.value)
  const usual = usualRange(hist, range ?? { mode: 'sd', k: 1 }, 14)
  const shift = deviation && usual ? usual.center : 0
  const dense = fillDays(data.map(d => ({ date: d.date, value: d.value - shift })), chartFrom, to)
  const mean7 = rolling ? rollingMean(dense, rollingDays, 3) : null
  const chart = dense.map((d, i) => ({ label: fmtAxisDay(d.date), date: d.date, value: d.value, mean7: mean7?.[i].value ?? null }))
  const band = usual ? { y1: usual.low - shift, y2: usual.high - shift, label: 'your usual range', color } : undefined
  const latest = [...data].reverse().find(d => d.date >= chartFrom && d.date <= to)
  const fmt = (v: number) => v.toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  const sign = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${fmt(Math.abs(v))}`

  if (isLoading) return <div className="h-[140px] rounded-row skeleton" aria-hidden />
  if (!chart.some(d => d.value != null)) return null

  return (
    <div className="flex flex-col gap-1 border-t border-line pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="section-label flex items-center gap-1">
          {title}
          <InfoBubble label={`About ${title}`}>
            The shaded band is your own usual range: {rangeText ?? 'the average of the last 60 days, ± one standard deviation'}
            {usual ? ` (${usual.n} days)` : ''}. A reading outside it is unusual for you, not necessarily a
            problem.{rolling ? ` The dashed line is the ${rollingDays}-day average, which is steadier than single days.` : ''}
            {deviation ? ' Shown as the difference from your usual night, the way Apple shows wrist temperature.' : ''}
          </InfoBubble>
        </p>
        <p className="text-meta text-fg-muted">
          {latest && (
            <><span className="font-semibold tabular-nums text-fg">{deviation && usual ? sign(latest.value - shift) : fmt(latest.value)} {unit}</span>
              {' '}{latest.date === to ? 'latest' : fmtDayMonth(latest.date)} · </>
          )}
          {usual
            ? deviation ? <>usual ± {fmt((usual.high - usual.low) / 2)} {unit}</> : <>usual {fmt(usual.low)}–{fmt(usual.high)} {unit}</>
            : 'too few days for a usual range yet'}
        </p>
      </div>
      <HealthTrendChart
        data={chart}
        series={[
          { key: 'value', label: title, color, kind: 'line' },
          ...(rolling ? [{ key: 'mean7', label: `${rollingDays}-day average`, color, kind: 'line' as const, dashed: true }] : []),
        ]}
        unit={unit}
        ariaLabel={`${title} per day with your usual range`}
        height={130}
        band={band}
        refLines={refLines}
        formatValue={deviation ? sign : fmt}
        onViewDay={onViewDay}
      />
    </div>
  )
}
