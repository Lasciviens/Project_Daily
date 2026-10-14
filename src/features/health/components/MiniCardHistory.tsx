import { useChartColors } from '../../../shared/ui'
import { useHealthDaily } from '../hooks/useHealthExport'
import { fillDays, type DayValue } from '../healthWindowStats'
import { HealthTrendChart } from './HealthTrendChart'
import { fmtAxisDate, fmtAxisDay } from './healthFormat'
import type { MiniMetricWindow } from './miniMetrics'

// A mini card's expanded history over the period picked in the range bar.
// Window metrics chart the page's own window (nulls = gaps); point-in-time
// metrics chart every reading in it, fetched only once the card is opened.

interface Props {
  metric: string
  title: string
  unit: string
  decimals: number
  window: MiniMetricWindow
  daily: readonly DayValue[]
  isLatest: boolean
  onViewDay?: (date: string) => void
}

export function MiniCardHistory({ metric, title, unit, decimals, window, daily, isLatest, onViewDay }: Props) {
  const c = useChartColors()
  const readings = useHealthDaily(metric, window.from, window.to, { enabled: isLatest })
  const fmt = (v: number) => v.toFixed(decimals)

  const data = isLatest
    ? (readings.data ?? []).map(d => ({ label: fmtAxisDate(d.date), date: d.date, value: d.value }))
    : fillDays(daily, window.from, window.to).map(d => ({ label: fmtAxisDay(d.date), date: d.date, value: d.value }))

  if (isLatest && readings.isLoading) return <p className="py-3 text-center text-meta text-fg-muted">Loading…</p>
  if (data.filter(d => d.value != null).length < 2) {
    return <p className="py-3 text-center text-meta text-fg-muted">Not enough readings for a trend yet.</p>
  }
  return (
    <HealthTrendChart
      data={data}
      series={[{ key: 'value', label: title, color: c.series[1], kind: 'line', connectNulls: isLatest }]}
      unit={unit}
      ariaLabel={`${title} history`}
      height={120}
      formatValue={fmt}
      onViewDay={onViewDay}
    />
  )
}
